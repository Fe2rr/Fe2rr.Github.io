/*
 * NAPL — CHECK COMPATIBILITY PAGE CONTROLLER
 *
 * Allows searching by Android device model or commercial SoC,
 * filtering/sorting results, and browsing grouped Game -> Port -> Report cards.
 */

import { normalizeText } from "../core/helpers.js";
import { loadCatalog } from "../core/data.js";
import {
    COMPAT_STATUSES,
    getCompatStatusMeta,
    loadDevices,
    buildHardwareIndex,
    searchHardwareCatalog,
    searchCompatibilityByHardware,
    groupIdenticalCompatReports,
} from "../services/compatibility.js";
import { initNavigation } from "../components/navigation.js?v=17";
import { initSearch } from "../components/search.js";
import { initThemeToggle } from "../components/theme.js";

initThemeToggle();
const headerSearch = initSearch();
const navController = initNavigation({
    mode: "compatibility",
    onBeforeOpenMenu: () => headerSearch.closeSearch(false),
});

const QUICK_HARDWARE_PRESETS = [
    { type: "soc", value: "Snapdragon 8 Gen 2" },
    { type: "soc", value: "Snapdragon 8 Elite" },
    { type: "soc", value: "Snapdragon 865" },
    { type: "soc", value: "MediaTek Helio G99" },
    { type: "soc", value: "Unisoc T820" },
    { type: "device", value: "AYN Odin 2" },
    { type: "device", value: "Retroid Pocket 5" },
    { type: "device", value: "Logitech G Cloud" },
];

const hardwareForm = document.getElementById("hardware-search-form");
const hardwareInput = document.getElementById("hardware-search-input");
const suggestionsBox = document.getElementById("hardware-suggestions");
const activeBar = document.getElementById("hardware-active-bar");
const activeLabel = document.getElementById("hardware-active-label");
const activeMeta = document.getElementById("hardware-active-meta");
const clearHardwareBtn = document.getElementById("hardware-clear-button");

const resultsToolbar = document.getElementById("results-toolbar");
const filterInput = document.getElementById("results-filter-input");
const sortOptions = document.querySelectorAll(".compat-sort-option");
const sortDirectionBtn = document.getElementById("compat-sort-direction");
const statusFilterBtns = document.querySelectorAll(".compat-status-filter");

const statusLine = document.getElementById("compat-status");
const emptyPrompt = document.getElementById("compat-empty-prompt");
const quickPresetsBox = document.getElementById("compat-quick-presets");
const resultsContainer = document.getElementById("compat-results");

const state = {
    catalog: null,
    portMap: new Map(),
    hardwareIndex: null,
    selection: null, // { type: 'soc'|'device'|'query', device?: object, soc?: string, query?: string }
    rawReports: [],
    filterQuery: "",
    statusFilter: "all",
    sortBy: "best",
    sortDescending: false,
    loadingReports: false,
};

function setStatusMessage(message) {
    if (statusLine) {
        statusLine.textContent = message;
    }
}

function updateSortDirectionUI() {
    if (!sortDirectionBtn) return;
    sortDirectionBtn.textContent = state.sortDescending ? "↑" : "↓";
}

function formatReportDate(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
}

function buildPortLookup(catalog) {
    const map = new Map();
    if (!catalog || !Array.isArray(catalog.games)) return map;

    for (const game of catalog.games) {
        for (const port of game.ports || []) {
            if (!port?.portId) continue;
            if (!map.has(port.portId)) {
                map.set(port.portId, { game, port });
            }
        }
    }
    return map;
}

function syncUrlWithSelection() {
    const url = new URL(window.location.href);
    url.searchParams.delete("device");
    url.searchParams.delete("soc");
    url.searchParams.delete("q");
    url.searchParams.delete("same_soc");

    if (state.selection) {
        if (state.selection.type === "device" && state.selection.device) {
            url.searchParams.set("device", state.selection.device.id);
        } else if (state.selection.type === "soc" && state.selection.soc) {
            url.searchParams.set("soc", state.selection.soc);
        } else if (state.selection.type === "query" && state.selection.query) {
            url.searchParams.set("q", state.selection.query);
        }
    }

    window.history.replaceState({}, "", url.toString());
}

function renderActiveSelectionBar() {
    if (!activeBar || !activeLabel || !activeMeta) return;

    if (!state.selection) {
        activeBar.hidden = true;
        return;
    }

    activeBar.hidden = false;

    if (state.selection.type === "device" && state.selection.device) {
        const device = state.selection.device;
        activeLabel.textContent = device.model || device.name;
        activeMeta.textContent = [device.soc, device.deviceType]
            .filter(Boolean)
            .join(" · ");
    } else if (state.selection.type === "soc") {
        activeLabel.textContent = `SoC: ${state.selection.soc}`;
        activeMeta.textContent = "SoC chipset filter";
    } else {
        activeLabel.textContent = `Search: "${state.selection.query}"`;
        activeMeta.textContent = "Matching device model or SoC text";
    }
}

function closeSuggestions() {
    if (!suggestionsBox) return;
    suggestionsBox.hidden = true;
    suggestionsBox.replaceChildren();
}

function renderHardwareSuggestions() {
    if (!suggestionsBox || !hardwareInput || !state.hardwareIndex) return;

    const query = hardwareInput.value.trim();
    suggestionsBox.replaceChildren();

    if (query.length < 2) {
        suggestionsBox.hidden = true;
        return;
    }

    const { socs, devices } = searchHardwareCatalog(state.hardwareIndex, query, {
        socLimit: 6,
        deviceLimit: 18,
    });

    if (socs.length === 0 && devices.length === 0) {
        const empty = document.createElement("div");
        empty.className = "compat-suggestion-empty";
        empty.textContent =
            "No exact catalog match. Press Search to query community reports by text.";
        suggestionsBox.appendChild(empty);
        suggestionsBox.hidden = false;
        return;
    }

    if (socs.length > 0) {
        const header = document.createElement("div");
        header.className = "compat-suggestion-group-title";
        header.textContent = "Processors (SoC)";
        suggestionsBox.appendChild(header);

        for (const item of socs) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "compat-suggestion-item";

            const primary = document.createElement("span");
            primary.className = "compat-suggestion-primary";
            primary.textContent = item.soc;

            const meta = document.createElement("span");
            meta.className = "compat-suggestion-meta";
            meta.textContent = `${item.count} device${item.count === 1 ? "" : "s"}`;

            btn.append(primary, meta);
            btn.addEventListener("click", () => {
                selectHardware({ type: "soc", soc: item.soc });
            });
            suggestionsBox.appendChild(btn);
        }
    }

    if (devices.length > 0) {
        const header = document.createElement("div");
        header.className = "compat-suggestion-group-title";
        header.textContent = "Devices";
        suggestionsBox.appendChild(header);

        for (const device of devices) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "compat-suggestion-item";

            const primary = document.createElement("span");
            primary.className = "compat-suggestion-primary";
            primary.textContent = device.model || device.name;

            const meta = document.createElement("span");
            meta.className = "compat-suggestion-meta";
            meta.textContent = [device.soc, device.deviceType]
                .filter(Boolean)
                .join(" · ");

            btn.append(primary, meta);
            btn.addEventListener("click", () => {
                selectHardware({ type: "device", device });
            });
            suggestionsBox.appendChild(btn);
        }
    }

    suggestionsBox.hidden = false;
}

function renderLoadingSkeletons() {
    if (!resultsContainer) return;
    resultsContainer.hidden = false;
    resultsContainer.replaceChildren();
    const list = document.createElement("div");
    list.className = "compat-skeleton-list";
    for (let i = 0; i < 4; i++) {
        const card = document.createElement("div");
        card.className = "compat-skeleton-card skeleton-shimmer";
        list.appendChild(card);
    }
    resultsContainer.appendChild(list);
}

function computeGroupedGames() {
    const query = normalizeText(state.filterQuery);
    const statusFilter = state.statusFilter;

    // Group reports by portId first, filtering by statusFilter if active
    const portGroupsMap = new Map();

    for (const report of state.rawReports) {
        if (!report.portId) continue;

        const lookup = state.portMap.get(report.portId);
        const game = lookup?.game || {
            name: `Port ${report.portId}`,
            slug: "",
            year: "",
            genre: "",
            coverUrl: "",
        };
        const port = lookup?.port || {
            portId: report.portId,
            project: report.portId,
            platform: "",
            version: "",
            developer: "",
        };

        if (statusFilter !== "all" && report.status !== statusFilter) {
            continue;
        }

        if (query) {
            const searchable = normalizeText(
                [
                    game.name,
                    game.genre,
                    port.project,
                    port.platform,
                    port.developer,
                    port.version,
                    report.deviceName,
                    report.deviceSoc,
                ]
                    .filter(Boolean)
                    .join(" ")
            );
            if (!searchable.includes(query)) continue;
        }

        if (!portGroupsMap.has(report.portId)) {
            portGroupsMap.set(report.portId, {
                game,
                port,
                reports: [],
                counts: { playable_60: 0, playable_30: 0, low_fps: 0, crash: 0 },
                bestScore: 0,
                avgScore: 0,
                latestTimestamp: 0,
            });
        }

        const pGroup = portGroupsMap.get(report.portId);
        pGroup.reports.push(report);
        if (pGroup.counts[report.status] !== undefined) {
            pGroup.counts[report.status] += 1;
        }
        const score = getCompatStatusMeta(report.status, report.works).score;
        if (score > pGroup.bestScore) pGroup.bestScore = score;
        const ts = Date.parse(report.updatedAt || "") || 0;
        if (ts > pGroup.latestTimestamp) pGroup.latestTimestamp = ts;
    }

    // Group portGroups under their parent Game
    const gameGroupsMap = new Map();

    for (const pGroup of portGroupsMap.values()) {
        const totalReports = pGroup.reports.length;
        const weighted =
            pGroup.counts.playable_60 * 4 +
            pGroup.counts.playable_30 * 3 +
            pGroup.counts.low_fps * 2 +
            pGroup.counts.crash * 1;
        pGroup.avgScore = totalReports > 0 ? weighted / totalReports : 0;
        pGroup.reports.sort((a, b) =>
            String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
        );

        const gameKey = pGroup.game.slug
            ? `slug:${pGroup.game.slug}`
            : `name:${normalizeText(pGroup.game.name)}`;

        if (!gameGroupsMap.has(gameKey)) {
            gameGroupsMap.set(gameKey, {
                game: pGroup.game,
                ports: [],
                totalReports: 0,
                bestAvgScore: 0,
                maxScore: 0,
                latestTimestamp: 0,
            });
        }

        const gGroup = gameGroupsMap.get(gameKey);
        gGroup.ports.push(pGroup);
        gGroup.totalReports += totalReports;
        if (pGroup.avgScore > gGroup.bestAvgScore) {
            gGroup.bestAvgScore = pGroup.avgScore;
        }
        if (pGroup.bestScore > gGroup.maxScore) {
            gGroup.maxScore = pGroup.bestScore;
        }
        if (pGroup.latestTimestamp > gGroup.latestTimestamp) {
            gGroup.latestTimestamp = pGroup.latestTimestamp;
        }
    }

    const games = Array.from(gameGroupsMap.values());

    // Sort ports inside each game by playability then report count
    for (const gGroup of games) {
        gGroup.ports.sort(
            (a, b) =>
                b.avgScore - a.avgScore ||
                b.reports.length - a.reports.length ||
                String(a.port.project || "").localeCompare(
                    String(b.port.project || ""),
                    "en"
                )
        );
    }

    const dir = state.sortDescending ? -1 : 1;
    games.sort((a, b) => {
        let diff = 0;
        switch (state.sortBy) {
            case "reports":
                diff = b.totalReports - a.totalReports;
                break;
            case "recent":
                diff = b.latestTimestamp - a.latestTimestamp;
                break;
            case "name":
                diff = a.game.name.localeCompare(b.game.name, "en", {
                    sensitivity: "base",
                });
                break;
            case "best":
            default:
                diff =
                    b.bestAvgScore - a.bestAvgScore ||
                    b.totalReports - a.totalReports;
                break;
        }
        if (diff !== 0) return diff * dir;
        return a.game.name.localeCompare(b.game.name, "en", {
            sensitivity: "base",
        });
    });

    return games;
}

function renderGroupedResults() {
    if (!resultsContainer) return;

    if (!state.selection) {
        resultsContainer.hidden = true;
        resultsContainer.replaceChildren();
        if (resultsToolbar) resultsToolbar.hidden = true;
        if (emptyPrompt) emptyPrompt.hidden = false;
        setStatusMessage("");
        return;
    }

    if (emptyPrompt) emptyPrompt.hidden = true;
    if (resultsToolbar) resultsToolbar.hidden = false;

    if (state.loadingReports) {
        renderLoadingSkeletons();
        return;
    }

    const groupedGames = computeGroupedGames();
    const totalVisiblePorts = groupedGames.reduce(
        (sum, g) => sum + g.ports.length,
        0
    );
    const totalVisibleReports = groupedGames.reduce(
        (sum, g) => sum + g.totalReports,
        0
    );

    resultsContainer.hidden = false;
    resultsContainer.replaceChildren();

    if (state.rawReports.length === 0) {
        setStatusMessage("0 reports found for this hardware.");
        const empty = document.createElement("div");
        empty.className = "no-results";
        empty.textContent =
            "No community compatibility reports found for this device or SoC yet. Open any game port page and submit the first report!";
        resultsContainer.appendChild(empty);
        return;
    }

    if (groupedGames.length === 0) {
        setStatusMessage("0 matching games after current filters.");
        const empty = document.createElement("div");
        empty.className = "no-results";
        empty.textContent =
            "No tested ports match your active filter text or FPS tier filter.";
        resultsContainer.appendChild(empty);
        return;
    }

    setStatusMessage(
        `${groupedGames.length} game${groupedGames.length === 1 ? "" : "s"} · ${totalVisiblePorts} port${totalVisiblePorts === 1 ? "" : "s"} · ${totalVisibleReports} report${totalVisibleReports === 1 ? "" : "s"}`
    );

    const fragment = document.createDocumentFragment();

    for (const group of groupedGames) {
        const { game, ports } = group;
        const card = document.createElement("article");
        card.className = "compat-game-card";

        const header = document.createElement("div");
        header.className = "compat-game-header";

        const lead = document.createElement("div");
        lead.className = "compat-game-lead";

        const coverWrap = document.createElement("div");
        coverWrap.className = "compat-game-cover-wrap";
        if (game.coverUrl && /^https?:\/\/\S+$/i.test(game.coverUrl)) {
            const img = document.createElement("img");
            img.className = "compat-game-cover";
            img.src = game.coverUrl;
            img.alt = `${game.name} cover`;
            img.loading = "lazy";
            img.decoding = "async";
            img.referrerPolicy = "no-referrer";
            img.addEventListener(
                "error",
                () => {
                    img.remove();
                    coverWrap.classList.add("cover-unavailable");
                },
                { once: true }
            );
            coverWrap.appendChild(img);
        } else {
            coverWrap.classList.add("cover-unavailable");
        }

        const info = document.createElement("div");
        info.className = "compat-game-info";

        const gameHref = game.slug
            ? `game.html?game=${encodeURIComponent(game.slug)}`
            : "";

        const titleEl = gameHref
            ? document.createElement("a")
            : document.createElement("span");
        titleEl.className = "compat-game-title";
        titleEl.textContent = game.name;
        if (gameHref) titleEl.href = gameHref;

        const metaEl = document.createElement("div");
        metaEl.className = "compat-game-meta";
        const metaParts = [
            game.year,
            game.genre,
            `${ports.length} tested port${ports.length === 1 ? "" : "s"}`,
        ].filter(Boolean);
        metaEl.textContent = metaParts.join(" · ");

        info.append(titleEl, metaEl);
        lead.append(coverWrap, info);
        header.appendChild(lead);

        card.appendChild(header);

        const portListEl = document.createElement("div");
        portListEl.className = "compat-port-list";

        for (const pGroup of ports) {
            const { port, reports, counts } = pGroup;
            const total = reports.length;

            const portSection = document.createElement("div");
            portSection.className = "compat-port-section";

            const portTop = document.createElement("div");
            portTop.className = "compat-port-top";

            const portIdentity = document.createElement("div");
            portIdentity.className = "compat-port-identity";

            const portTitle = gameHref
                ? document.createElement("a")
                : document.createElement("span");
            portTitle.className = "compat-port-project";
            portTitle.textContent =
                port.project || port.platform || "Native Port";
            if (gameHref) portTitle.href = gameHref;

            const portMeta = document.createElement("span");
            portMeta.className = "compat-port-meta";
            portMeta.textContent = [
                port.platform,
                port.version ? `v${port.version.replace(/^v/i, "")}` : "",
                port.developer,
            ]
                .filter(Boolean)
                .join(" · ");

            portIdentity.append(portTitle);
            if (portMeta.textContent) {
                portIdentity.append(portMeta);
            }

            const portRight = document.createElement("div");
            portRight.className = "compat-port-right";

            const portUrl = String(port.url || "").trim();
            if (/^https?:\/\/\S+$/i.test(portUrl)) {
                const downloadLink = document.createElement("a");
                downloadLink.className = "compat-port-download";
                downloadLink.href = portUrl;
                downloadLink.target = "_blank";
                downloadLink.rel = "noopener noreferrer";
                downloadLink.textContent = port.link || "Download";

                const arrow = document.createElement("span");
                arrow.setAttribute("aria-hidden", "true");
                arrow.textContent = "↗";
                downloadLink.appendChild(arrow);
                portRight.appendChild(downloadLink);
            }

            portTop.append(portIdentity, portRight);

            const playablePct =
                total > 0
                    ? Math.round(
                          ((counts.playable_60 + counts.playable_30) / total) *
                              100
                      )
                    : 0;
            const summaryParts = COMPAT_STATUSES.filter(
                (t) => counts[t.id] > 0
            ).map((t) => `${counts[t.id]} ${t.shortLabel}`);

            const meter = document.createElement("div");
            meter.className = "compat-meter";
            meter.setAttribute("role", "img");
            meter.setAttribute(
                "aria-label",
                `${playablePct}% playable (${summaryParts.join(", ")})`
            );

            for (const tier of COMPAT_STATUSES) {
                const count = counts[tier.id] || 0;
                if (count <= 0) continue;
                const seg = document.createElement("div");
                seg.className = `compat-meter-segment is-${tier.id.replace(/_/g, "-")}`;
                seg.style.width = `${(count / total) * 100}%`;
                meter.appendChild(seg);
            }

            const portFooter = document.createElement("div");
            portFooter.className = "compat-port-footer";

            const portSummary = document.createElement("span");
            portSummary.className = "compat-port-summary";
            portSummary.textContent = `${playablePct}% playable (${summaryParts.join(" · ")})`;

            const reportsTrigger = document.createElement("div");
            reportsTrigger.className = "compat-reports-trigger";

            const toggleReportsBtn = document.createElement("button");
            toggleReportsBtn.type = "button";
            toggleReportsBtn.className = "compat-reports-toggle";
            toggleReportsBtn.setAttribute("aria-expanded", "false");

            const toggleLabel = document.createElement("span");
            toggleLabel.textContent = `Devices (${total})`;

            const toggleChevron = document.createElement("span");
            toggleChevron.className = "compat-reports-chevron";
            toggleChevron.setAttribute("aria-hidden", "true");
            toggleChevron.textContent = "▾";

            toggleReportsBtn.append(toggleLabel, toggleChevron);

            const reportsPopover = document.createElement("div");
            reportsPopover.className = "compat-reports-popover";
            reportsPopover.hidden = true;

            const popoverHeader = document.createElement("div");
            popoverHeader.className = "compat-reports-popover-title";
            popoverHeader.textContent = `Reported devices (${total})`;

            const reportsEl = document.createElement("div");
            reportsEl.className = "compat-report-rows";

            reportsPopover.append(popoverHeader, reportsEl);
            reportsTrigger.append(toggleReportsBtn, reportsPopover);

            toggleReportsBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                const willOpen = reportsPopover.hidden;
                closeAllReportPopovers(willOpen ? reportsTrigger : null);
                reportsPopover.hidden = !willOpen;
                reportsTrigger.classList.toggle("is-open", willOpen);
                toggleReportsBtn.setAttribute(
                    "aria-expanded",
                    willOpen ? "true" : "false"
                );
            });

            const groupedReports = groupIdenticalCompatReports(reports);
            for (const item of groupedReports) {
                const row = document.createElement("div");
                row.className = "compat-report-row";

                const devWrap = document.createElement("div");
                devWrap.className = "compat-report-device-wrap";

                const devName = document.createElement("span");
                devName.className = "compat-report-device";
                devName.textContent =
                    item.count > 1
                        ? `${item.model} (${item.count})`
                        : item.model;
                devWrap.appendChild(devName);

                if (item.soc) {
                    const devSoc = document.createElement("span");
                    devSoc.className = "compat-report-soc";
                    devSoc.textContent = ` · ${item.soc}`;
                    devWrap.appendChild(devSoc);
                }

                const right = document.createElement("div");
                right.className = "compat-report-right";

                const dateText = formatReportDate(item.updatedAt);
                if (dateText) {
                    const dateEl = document.createElement("span");
                    dateEl.className = "compat-report-date";
                    dateEl.textContent = dateText;
                    right.appendChild(dateEl);
                }

                const tier = getCompatStatusMeta(item.status, item.works);
                const statusEl = document.createElement("span");
                statusEl.className = `compat-report-status is-${tier.id.replace(/_/g, "-")}`;
                statusEl.textContent = tier.label;
                right.appendChild(statusEl);

                row.append(devWrap, right);
                reportsEl.appendChild(row);
            }

            portFooter.append(portSummary, reportsTrigger);
            portSection.append(portTop, meter, portFooter);
            portListEl.appendChild(portSection);
        }

        card.appendChild(portListEl);
        fragment.appendChild(card);
    }

    resultsContainer.appendChild(fragment);
}

async function fetchReportsForSelection() {
    if (!state.selection) {
        state.rawReports = [];
        renderGroupedResults();
        return;
    }

    state.loadingReports = true;
    setStatusMessage("Searching community compatibility reports...");
    renderGroupedResults();

    try {
        let searchArgs = {};
        if (state.selection.type === "device" && state.selection.device) {
            searchArgs = { deviceId: state.selection.device.id };
        } else if (state.selection.type === "soc") {
            searchArgs = { soc: state.selection.soc };
        } else if (state.selection.type === "query") {
            searchArgs = { query: state.selection.query };
        }

        state.rawReports = await searchCompatibilityByHardware({
            ...searchArgs,
            limit: 600,
        });
    } catch (error) {
        state.loadingReports = false;
        setStatusMessage("");
        if (resultsContainer) {
            resultsContainer.hidden = false;
            resultsContainer.replaceChildren();
            const errBox = document.createElement("div");
            errBox.className = "error";
            const strong = document.createElement("strong");
            strong.textContent = "Could not search compatibility reports.";
            const p = document.createElement("p");
            p.textContent =
                error instanceof Error
                    ? error.message
                    : "An unexpected error occurred.";
            const retry = document.createElement("button");
            retry.type = "button";
            retry.className = "retry-button";
            retry.textContent = "Try again";
            retry.addEventListener("click", fetchReportsForSelection);
            errBox.append(strong, p, retry);
            resultsContainer.appendChild(errBox);
        }
        return;
    }

    state.loadingReports = false;
    renderGroupedResults();
}

function selectHardware(selection) {
    state.selection = selection;
    closeSuggestions();

    if (hardwareInput) {
        if (selection?.type === "device" && selection.device) {
            hardwareInput.value = selection.device.model || selection.device.name;
        } else if (selection?.type === "soc") {
            hardwareInput.value = selection.soc;
        } else if (selection?.type === "query") {
            hardwareInput.value = selection.query;
        } else {
            hardwareInput.value = "";
        }
    }

    renderActiveSelectionBar();
    syncUrlWithSelection();
    fetchReportsForSelection();
}

function renderQuickPresets() {
    if (!quickPresetsBox) return;
    quickPresetsBox.replaceChildren();

    for (const preset of QUICK_HARDWARE_PRESETS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "compat-preset-button";
        btn.textContent = preset.value;
        btn.addEventListener("click", () => {
            if (!state.hardwareIndex) {
                selectHardware(
                    preset.type === "soc"
                        ? { type: "soc", soc: preset.value }
                        : { type: "query", query: preset.value }
                );
                return;
            }

            if (preset.type === "soc") {
                const match = state.hardwareIndex.socs.find(
                    (s) => s.soc.toLowerCase() === preset.value.toLowerCase()
                );
                selectHardware({
                    type: "soc",
                    soc: match ? match.soc : preset.value,
                });
            } else {
                const matches = searchHardwareCatalog(
                    state.hardwareIndex,
                    preset.value,
                    { socLimit: 0, deviceLimit: 1 }
                ).devices;
                if (matches.length > 0) {
                    selectHardware({ type: "device", device: matches[0] });
                } else {
                    selectHardware({ type: "query", query: preset.value });
                }
            }
        });
        quickPresetsBox.appendChild(btn);
    }
}

hardwareInput?.addEventListener("input", renderHardwareSuggestions);

hardwareForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const rawQuery = hardwareInput?.value.trim() || "";
    if (!rawQuery) return;

    if (state.hardwareIndex) {
        const exactSoc = state.hardwareIndex.socs.find(
            (s) => s.soc.toLowerCase() === rawQuery.toLowerCase()
        );
        if (exactSoc) {
            selectHardware({ type: "soc", soc: exactSoc.soc });
            return;
        }
        const { socs, devices } = searchHardwareCatalog(
            state.hardwareIndex,
            rawQuery,
            { socLimit: 1, deviceLimit: 1 }
        );
        if (devices.length === 1 && socs.length === 0) {
            selectHardware({ type: "device", device: devices[0] });
            return;
        }
    }

    selectHardware({ type: "query", query: rawQuery });
});

clearHardwareBtn?.addEventListener("click", () => {
    state.filterQuery = "";
    if (filterInput) filterInput.value = "";
    selectHardware(null);
});

filterInput?.addEventListener("input", () => {
    state.filterQuery = filterInput.value;
    renderGroupedResults();
});

sortOptions.forEach((btn) => {
    btn.addEventListener("click", () => {
        const nextSort = btn.dataset.sort;
        if (!nextSort || state.sortBy === nextSort) return;
        state.sortBy = nextSort;
        state.sortDescending = false;
        sortOptions.forEach((other) => {
            other.classList.toggle("active", other.dataset.sort === nextSort);
        });
        updateSortDirectionUI();
        renderGroupedResults();
    });
});

sortDirectionBtn?.addEventListener("click", () => {
    state.sortDescending = !state.sortDescending;
    updateSortDirectionUI();
    renderGroupedResults();
});

statusFilterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
        const nextStatus = btn.dataset.status || "all";
        state.statusFilter = nextStatus;
        statusFilterBtns.forEach((other) => {
            other.classList.toggle(
                "active",
                (other.dataset.status || "all") === nextStatus
            );
        });
        renderGroupedResults();
    });
});

function closeAllReportPopovers(exceptTrigger = null) {
    document.querySelectorAll(".compat-reports-trigger").forEach((trigger) => {
        if (trigger === exceptTrigger) return;
        const pop = trigger.querySelector(".compat-reports-popover");
        const btn = trigger.querySelector(".compat-reports-toggle");
        if (pop) pop.hidden = true;
        if (btn) btn.setAttribute("aria-expanded", "false");
        trigger.classList.remove("is-open");
    });
}

document.addEventListener("click", (event) => {
    if (
        suggestionsBox &&
        !suggestionsBox.hidden &&
        !suggestionsBox.contains(event.target) &&
        event.target !== hardwareInput
    ) {
        closeSuggestions();
    }

    const clickedTrigger = event.target.closest(".compat-reports-trigger");
    if (!clickedTrigger) {
        closeAllReportPopovers();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (suggestionsBox && !suggestionsBox.hidden) {
        closeSuggestions();
    }
    closeAllReportPopovers();
});

async function initPage() {
    updateSortDirectionUI();
    renderQuickPresets();
    setStatusMessage("Loading device catalog and games...");

    const [catalogResult, devicesResult] = await Promise.allSettled([
        loadCatalog(),
        loadDevices(),
    ]);

    if (catalogResult.status === "fulfilled") {
        state.catalog = catalogResult.value;
        state.portMap = buildPortLookup(catalogResult.value);
        headerSearch.setGames(catalogResult.value.games);
        navController.renderPlatforms(
            catalogResult.value.platformOrder,
            catalogResult.value.games
        );
    } else {
        navController.setPlatformError(
            "Could not load platforms. Please try again later."
        );
    }

    if (devicesResult.status === "fulfilled") {
        state.hardwareIndex = buildHardwareIndex(devicesResult.value);
    }

    setStatusMessage("");

    // Check URL params for pre-selected device/SoC/query
    const params = new URLSearchParams(window.location.search);
    const paramDevice = params.get("device")?.trim();
    const paramSoc = params.get("soc")?.trim();
    const paramQuery = params.get("q")?.trim();

    if (paramDevice && state.hardwareIndex) {
        const matched = state.hardwareIndex.devices.find(
            (d) => d.id === paramDevice
        );
        if (matched) {
            selectHardware({ type: "device", device: matched });
            return;
        }
    }

    if (paramSoc) {
        selectHardware({ type: "soc", soc: paramSoc });
        return;
    }

    if (paramQuery) {
        selectHardware({ type: "query", query: paramQuery });
    }
}

initPage();
