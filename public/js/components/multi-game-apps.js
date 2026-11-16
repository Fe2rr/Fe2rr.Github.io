/*
 * NAPL — MULTI-GAME APPS & DUAL SCREEN COMPONENT
 *
 * Unifies game-apps.js and multi-game-apps.js into a single module.
 */

import {
    normalizeText,
    createSlug,
    parseLastUpdate,
} from "../core/helpers.js";
import { getAllTimeVisits } from "../services/popularity.js";

export function isDualScreen(game) {
    if (!game || !Array.isArray(game.ports)) {
        return false;
    }

    // Keep the same rule as the working V3 implementation:
    // Dual Screen is identified by the PROJECT column.
    return game.ports.some((port) =>
        normalizeText(port?.project).includes("dual screen")
    );
}

export function isMultiGameApp(game) {
    if (!game || !Array.isArray(game.ports)) {
        return false;
    }

    return game.ports.some(
        (port) => normalizeText(port?.platform) === "multi-game apps"
    );
}

export function isMultiGameAppPort(port, allRows) {
    if (!port || !port.project || !Array.isArray(allRows)) {
        return false;
    }

    const projectName = normalizeText(port.project);

    return allRows.some((row) => {
        if (!row) return false;

        return (
            normalizeText(row.platform) === "multi-game apps" &&
            normalizeText(row.game) === projectName
        );
    });
}

export function findGamesUsingApp(appName, allRows) {
    const appNameNormalized = normalizeText(appName);

    if (!appNameNormalized || !Array.isArray(allRows)) {
        return [];
    }

    const gamesUsingApp = new Map();

    for (const row of allRows) {
        if (!row || !row.game || !row.project) {
            continue;
        }

        const gameName = String(row.game).trim();
        const projectName = normalizeText(row.project);
        const normalizedGameName = normalizeText(gameName);

        if (normalizedGameName === appNameNormalized) continue;
        if (projectName !== appNameNormalized) continue;

        if (!gamesUsingApp.has(normalizedGameName)) {
            gamesUsingApp.set(normalizedGameName, {
                name: gameName,
                year: String(row.year ?? "").trim(),
            });
        }
    }

    return Array.from(gamesUsingApp.values()).sort((a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    );
}

export function getMultiGameApps(games) {
    if (!Array.isArray(games)) {
        return [];
    }

    const projects = new Map();

    for (const game of games) {
        if (!game || !Array.isArray(game.ports)) continue;

        for (const port of game.ports) {
            if (!port) continue;

            const projectName = String(port.project ?? "").trim();
            const normalizedProject = normalizeText(projectName);

            const isMarkedAsApp = [
                "multi-game apps",
                "multi game apps",
            ].includes(normalizeText(port.platform));

            if (
                normalizedProject === "unofficial port" ||
                normalizedProject === "android port"
            ) {
                continue;
            }

            const appName = isMarkedAsApp
                ? String(game.name ?? "").trim()
                : projectName;

            if (!appName) continue;

            const key = normalizeText(appName);

            if (!projects.has(key)) {
                projects.set(key, {
                    name: appName,
                    games: new Map(),
                    latestUpdate: null,
                    visits: 0,
                    explicitlyMarked: false,
                });
            }

            const app = projects.get(key);

            if (isMarkedAsApp) {
                app.explicitlyMarked = true;
            } else if (projectName && game.name) {
                const gameKey = normalizeText(game.name);
                if (!app.games.has(gameKey)) {
                    app.games.set(gameKey, {
                        name: game.name,
                        year: game.year || "",
                    });
                }
            }

            if (port.lastUpdate) {
                const updateDate = parseLastUpdate(port.lastUpdate);
                if (
                    updateDate &&
                    (!app.latestUpdate || updateDate > app.latestUpdate)
                ) {
                    app.latestUpdate = updateDate;
                }
            }
        }
    }

    const result = [];

    for (const app of projects.values()) {
        if (app.games.size <= 1 && !app.explicitlyMarked) {
            continue;
        }

        app.games = Array.from(app.games.values()).sort((a, b) =>
            a.name.localeCompare(b.name, "en", { sensitivity: "base" })
        );

        app.slug = createSlug(app.name);
        app.gameCount = app.games.length;

        let totalVisits = 0;
        for (const compatibleGame of app.games) {
            totalVisits += Number(
                getAllTimeVisits(createSlug(compatibleGame.name))
            );
        }
        app.visits = totalVisits;

        delete app.explicitlyMarked;
        result.push(app);
    }

    return result;
}

export function sortMultiGameApps(list, sortBy, descending) {
    const sorted = Array.isArray(list) ? [...list] : [];

    switch (sortBy) {
        case "updated":
            sorted.sort((a, b) => {
                if (!a.latestUpdate && !b.latestUpdate) return 0;
                if (!a.latestUpdate) return 1;
                if (!b.latestUpdate) return -1;
                const res = b.latestUpdate - a.latestUpdate;
                return descending ? -res : res;
            });
            break;

        case "name":
            sorted.sort((a, b) => {
                const res = a.name.localeCompare(b.name, "en", {
                    sensitivity: "base",
                });
                return descending ? -res : res;
            });
            break;

        case "popular":
            sorted.sort((a, b) => {
                const res =
                    (Number(b.visits) || 0) - (Number(a.visits) || 0);
                if (res !== 0) return descending ? -res : res;
                return a.name.localeCompare(b.name, "en", {
                    sensitivity: "base",
                });
            });
            break;
    }

    return sorted;
}

export function createGamesUsingAppSection(
    titleText,
    gamesList,
    options = {}
) {
    const {
        icon = null,
        showCount = true,
        searchable = false,
    } = options;

    const section = document.createElement("section");
    section.className = "games-using-app";

    const items = Array.isArray(gamesList) ? gamesList : [];

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "games-using-app-toggle";
    toggle.setAttribute("aria-expanded", "false");

    const toggleLeft = document.createElement("span");
    toggleLeft.className = "games-using-app-toggle-left";

    if (icon === "gamepad") {
        const iconSpan = document.createElement("span");
        iconSpan.className = "games-using-app-toggle-icon";
        iconSpan.setAttribute("aria-hidden", "true");
        iconSpan.innerHTML =
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>';
        toggleLeft.appendChild(iconSpan);
    }

    const title = document.createElement("span");
    title.className = "games-using-app-toggle-title";
    title.textContent = titleText;
    toggleLeft.appendChild(title);

    const toggleMeta = document.createElement("span");
    toggleMeta.className = "games-using-app-toggle-meta";

    if (showCount) {
        const countBadge = document.createElement("span");
        countBadge.className = "games-using-app-toggle-count";
        countBadge.textContent = String(items.length);
        toggleMeta.appendChild(countBadge);
    }

    const arrow = document.createElement("span");
    arrow.className = "games-using-app-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

    toggleMeta.appendChild(arrow);
    toggle.append(toggleLeft, toggleMeta);

    const drawer = document.createElement("div");
    drawer.className = "games-using-app-drawer";
    drawer.hidden = true;

    let filterInput = null;
    if (searchable && items.length >= 8) {
        const filterWrap = document.createElement("div");
        filterWrap.className = "games-using-app-filter";

        filterInput = document.createElement("input");
        filterInput.type = "search";
        filterInput.className = "games-using-app-filter-input";
        filterInput.placeholder = `Filter ${items.length} games...`;
        filterInput.setAttribute("aria-label", `Filter ${titleText}`);
        filterInput.autocomplete = "off";

        filterWrap.appendChild(filterInput);
        drawer.appendChild(filterWrap);
    }

    const viewport = document.createElement("div");
    viewport.className = "games-using-app-viewport";

    const list = document.createElement("div");
    list.className = "games-using-app-list";

    const rowRecords = [];
    for (const game of items) {
        const link = document.createElement("a");
        link.className = "games-using-app-item";
        link.href = `game.html?game=${encodeURIComponent(
            createSlug(game.name)
        )}`;

        const nameSpan = document.createElement("span");
        nameSpan.className = "games-using-app-item-name";
        nameSpan.textContent = game.name;
        link.appendChild(nameSpan);

        const itemMeta = document.createElement("span");
        itemMeta.className = "games-using-app-item-meta";

        if (game.year) {
            const year = document.createElement("span");
            year.className = "games-using-app-item-year";
            year.textContent = String(game.year);
            itemMeta.appendChild(year);
        }

        const itemArrow = document.createElement("span");
        itemArrow.className = "games-using-app-item-arrow";
        itemArrow.setAttribute("aria-hidden", "true");
        itemArrow.textContent = "→";
        itemMeta.appendChild(itemArrow);

        link.appendChild(itemMeta);
        list.appendChild(link);
        rowRecords.push({
            element: link,
            normalizedName: normalizeText(game.name),
        });
    }

    const emptyFilterMsg = document.createElement("div");
    emptyFilterMsg.className = "games-using-app-empty";
    emptyFilterMsg.textContent = "No matching games in this app.";
    emptyFilterMsg.hidden = true;
    list.appendChild(emptyFilterMsg);

    function updateScrollState() {
        if (drawer.hidden) return;
        const overflow = list.scrollHeight - list.clientHeight;
        const isScrollable = overflow > 4;
        const canScrollUp = isScrollable && list.scrollTop > 4;
        const canScrollDown =
            isScrollable &&
            list.scrollTop + list.clientHeight < list.scrollHeight - 4;

        viewport.classList.toggle("is-scrollable", isScrollable);
        viewport.classList.toggle("has-top-fade", canScrollUp);
        viewport.classList.toggle("has-bottom-fade", canScrollDown);
    }

    if (filterInput) {
        filterInput.addEventListener("input", () => {
            const query = normalizeText(filterInput.value);
            let visibleCount = 0;
            for (const row of rowRecords) {
                const match = !query || row.normalizedName.includes(query);
                row.element.hidden = !match;
                if (match) visibleCount++;
            }
            emptyFilterMsg.hidden = visibleCount > 0;
            list.scrollTop = 0;
            requestAnimationFrame(updateScrollState);
        });
    }

    list.addEventListener("scroll", updateScrollState, { passive: true });

    toggle.addEventListener("click", () => {
        const isOpen = toggle.getAttribute("aria-expanded") === "true";
        const nextOpen = !isOpen;
        toggle.setAttribute("aria-expanded", String(nextOpen));
        section.classList.toggle("is-open", nextOpen);
        drawer.hidden = !nextOpen;
        if (nextOpen) {
            requestAnimationFrame(updateScrollState);
        }
    });

    viewport.appendChild(list);
    drawer.appendChild(viewport);
    section.append(toggle, drawer);
    return section;
}
