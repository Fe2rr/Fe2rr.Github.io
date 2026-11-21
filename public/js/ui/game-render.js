/*
 * NAPL — GAME DETAIL RENDERER
 *
 * Renders game summary, port cards, multi-game app lists and ratings.
 * All rating styles live in assets/css/game.css (no CSS injected in JS).
 */

import {
    createSlug,
    restoreDescriptionLineBreaks,
    normalizeText,
    normalizeDeveloperName,
    normalizeYearValue,
    extractGameGenres,
    getDeveloperGameCounts,
} from "../lib/helpers.js";
import { loadCoverImage } from "../lib/cover-fallback.js";
import {
    isMultiGameApp,
    isNonUniqueProjectName,
    findGamesUsingApp,
    createGamesUsingAppSection,
} from "./multi-game-apps.js";
import {
    COMPAT_STATUSES,
    getCompatStatusMeta,
    normalizeCompatSummary,
    loadDevices,
    searchDevices,
    getStoredUserDevice,
    setStoredUserDevice,
    parseDeviceDisplayParts,
    groupIdenticalCompatReports,
} from "../lib/compatibility-api.js";


let ratingPopoverEventsInitialized = false;

function parseLastUpdate(value) {
    const raw = String(value || "").trim();
    if (!raw) return 0;

    // D1 stores timestamps as Montevideo local time without a timezone suffix.
    const localMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
    if (localMatch) {
        const time = localMatch[2].length === 5 ? `${localMatch[2]}:00` : localMatch[2];
        const timestamp = Date.parse(`${localMatch[1]}T${time}-03:00`);
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    const timestamp = Date.parse(raw);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

const POPOVER_GROUPS = [
    {
        container: ".port-rating",
        popover: ".port-rating-popover",
        button: ".port-rating-button",
        trigger: ".port-rating-trigger",
    },
    {
        container: ".port-compat",
        popover: ".port-compat-popover",
        button: ".port-compat-button",
        trigger: ".port-compat-trigger",
    },
    {
        container: ".port-report-link-trigger",
        popover: ".port-report-link-popover",
        button: ".port-report-link-button",
    },
    {
        container: ".game-share-trigger",
        popover: ".game-share-popover",
        button: ".game-share-button",
    },
];

function closePopoverGroup(container, group = null) {
    if (!container) return;
    const def =
        group ||
        POPOVER_GROUPS.find((entry) => container.matches?.(entry.container));
    if (!def) return;

    const popover = container.querySelector(def.popover);
    const button = container.querySelector(def.button);
    const trigger = def.trigger ? container.querySelector(def.trigger) : container;

    if (popover) popover.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
    if (trigger) trigger.classList.remove("is-open");
}

function closeAllPopovers(exceptTarget = null) {
    for (const group of POPOVER_GROUPS) {
        const keep = exceptTarget?.closest
            ? exceptTarget.closest(group.container)
            : exceptTarget;
        document.querySelectorAll(group.container).forEach((container) => {
            if (container !== keep) {
                closePopoverGroup(container, group);
            }
        });
    }
}

function initializeRatingPopoverEvents() {
    if (ratingPopoverEventsInitialized) return;
    ratingPopoverEventsInitialized = true;

    document.addEventListener("click", (event) => {
        closeAllPopovers(event.target);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeAllPopovers();
        }
    });
}

function triggerStarBurst(element) {
    if (!element) return;
    element.classList.remove("is-animating");
    void element.offsetWidth;
    element.classList.add("is-animating");
}

function createRatingStars(average, animate = false) {
    const stars = document.createElement("span");
    stars.className = "port-rating-stars";
    stars.setAttribute("aria-label", `${average.toFixed(1)} out of 5`);

    for (let i = 1; i <= 5; i++) {
        const star = document.createElement("span");
        star.className = "port-rating-star";
        star.style.setProperty("--star-index", String(i - 1));
        star.textContent = "★";

        const fill = document.createElement("span");
        fill.className = "port-rating-star-fill";
        fill.textContent = "★";

        const percentage = Math.max(
            0,
            Math.min(100, (average - i + 1) * 100)
        );
        fill.style.width = `${percentage}%`;

        star.appendChild(fill);
        stars.appendChild(star);
    }

    if (animate) {
        triggerStarBurst(stars);
    }

    return stars;
}

function createPortRating(port, ratings, ratingActions, onRatingUpdated = null) {
    if (!port.portId) return null;

    const container = document.createElement("div");
    container.className = "port-rating";

    const summaryElement = document.createElement("div");
    summaryElement.className = "port-rating-summary";
    summaryElement.setAttribute("role", "button");
    summaryElement.tabIndex = 0;
    summaryElement.title = "Rate this port";
    summaryElement.setAttribute("aria-label", "Open port rating");

    let currentRating = ratings?.[port.portId] || {};
    let starsElement = createRatingStars(Number(currentRating.avg) || 0);
    summaryElement.appendChild(starsElement);

    const averageElement = document.createElement("span");
    averageElement.className = "port-rating-average";

    const countElement = document.createElement("span");
    countElement.className = "port-rating-count";

    function updateRatingDisplay(rating, animate = false) {
        currentRating = rating || {};
        const average = Number(currentRating.avg) || 0;
        const votes = Number(currentRating.votes) || 0;

        const newStars = createRatingStars(votes > 0 ? average : 0, animate);
        starsElement.replaceWith(newStars);
        starsElement = newStars;

        averageElement.textContent = votes > 0 ? average.toFixed(1) : "—";
        countElement.textContent = `(${votes})`;
        countElement.title = `${votes} ${votes === 1 ? "vote" : "votes"}`;
    }

    updateRatingDisplay(currentRating);
    summaryElement.append(averageElement, countElement);
    container.appendChild(summaryElement);

    const rateButton = document.createElement("button");
    rateButton.type = "button";
    rateButton.className = "port-rating-button";
    rateButton.textContent = "Rate";
    rateButton.setAttribute("aria-expanded", "false");

    const popover = document.createElement("div");
    popover.className = "port-rating-popover";
    popover.hidden = true;

    const heading = document.createElement("h4");
    heading.className = "port-rating-popover-title";
    heading.textContent = "Rate this port";

    const description = document.createElement("p");
    description.className = "port-rating-popover-description";
    description.textContent = "Choose your rating";

    popover.append(heading, description);

    const options = [
        "AI Slop",
        "Just emulate it bro",
        "Decent",
        "Good Port",
        "Gem",
    ];

    let selectedRating = 0;
    let previousRating = 0;
    let loadingVote = false;
    let submitting = false;

    const optionButtons = [];
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "port-rating-submit";
    submit.textContent = "Submit vote";
    submit.disabled = true;

    const feedback = document.createElement("p");
    feedback.className = "port-rating-feedback";
    feedback.textContent = "Select one of the five options.";

    function setFeedback(message, type = "") {
        feedback.className = "port-rating-feedback";
        if (type) feedback.classList.add(type);
        feedback.textContent = message;
    }

    function updateSubmitButton() {
        submit.disabled = !selectedRating || loadingVote || submitting;
        submit.textContent =
            previousRating > 0 ? "Update vote" : "Submit vote";
    }

    function selectRating(score, animate = true) {
        selectedRating = score;
        optionButtons.forEach((button, idx) => {
            const isMatch = idx + 1 === score;
            button.classList.toggle("selected", isMatch);
            if (!isMatch) {
                button.classList.remove("is-animating");
            } else if (animate) {
                triggerStarBurst(button);
            }
        });
        updateSubmitButton();
        setFeedback(`Selected: ${options[score - 1]}`);
    }

    options.forEach((label, index) => {
        const score = index + 1;
        const option = document.createElement("button");
        option.type = "button";
        option.className = "port-rating-option";

        const optionLabel = document.createElement("span");
        optionLabel.textContent = label;

        const optionStars = document.createElement("span");
        optionStars.className = "port-rating-option-stars";
        optionStars.setAttribute("aria-hidden", "true");
        for (let s = 0; s < score; s++) {
            const starSpan = document.createElement("span");
            starSpan.className = "port-rating-option-star";
            starSpan.style.setProperty("--star-index", String(s));
            starSpan.textContent = "★";
            optionStars.appendChild(starSpan);
        }

        option.append(optionLabel, optionStars);
        option.addEventListener("click", () => {
            if (loadingVote || submitting) return;
            selectRating(score, true);
        });

        optionButtons.push(option);
        popover.appendChild(option);
    });

    async function loadPreviousVote() {
        if (!ratingActions?.getMyVote) {
            setFeedback("Rating service is unavailable.", "error");
            return;
        }

        loadingVote = true;
        selectedRating = 0;
        optionButtons.forEach((btn) => {
            btn.classList.remove("selected");
            btn.disabled = true;
        });
        updateSubmitButton();
        setFeedback("Loading your previous vote...");

        try {
            const vote = await ratingActions.getMyVote(port.portId);
            previousRating = Number(vote) || 0;

            if (
                Number.isInteger(previousRating) &&
                previousRating >= 1 &&
                previousRating <= 5
            ) {
                selectedRating = previousRating;
                optionButtons[previousRating - 1].classList.add("selected");
                setFeedback(
                    `Your current rating: ${options[previousRating - 1]}`
                );
            } else {
                previousRating = 0;
                selectedRating = 0;
                setFeedback("Select one of the five options.");
            }
        } catch (error) {
            console.error("Could not load previous vote:", error);
            previousRating = 0;
            selectedRating = 0;
            setFeedback(
                error.message || "Could not load your previous vote.",
                "error"
            );
        } finally {
            loadingVote = false;
            optionButtons.forEach((btn) => {
                btn.disabled = false;
            });
            updateSubmitButton();
        }
    }

    submit.addEventListener("click", async () => {
        if (
            !selectedRating ||
            submitting ||
            loadingVote ||
            !ratingActions?.submitVote
        ) {
            return;
        }

        submitting = true;
        optionButtons.forEach((btn) => {
            btn.disabled = true;
        });
        updateSubmitButton();
        setFeedback("Sending your rating...");

        try {
            const result = await ratingActions.submitVote(
                port.portId,
                selectedRating
            );
            previousRating = selectedRating;

            if (result?.rating) {
                updateRatingDisplay(result.rating, true);
                onRatingUpdated?.(port.portId, result.rating);
            }

            setFeedback("Your rating has been saved!", "success");
            rateButton.textContent = "Rated";
            submit.textContent = "Saved";

            setTimeout(() => {
                closePopoverGroup(container);
                rateButton.textContent = "Rate";
            }, 900);
        } catch (error) {
            console.error("Vote submission failed:", error);
            setFeedback(
                error.message || "Could not submit your rating.",
                "error"
            );
        } finally {
            submitting = false;
            optionButtons.forEach((btn) => {
                btn.disabled = false;
            });
            updateSubmitButton();
        }
    });

    popover.append(submit, feedback);

    const trigger = document.createElement("div");
    trigger.className = "port-rating-trigger";
    trigger.append(rateButton, popover);

    async function toggleRatingPopover(event) {
        event.stopPropagation();

        if (!popover.hidden) {
            closePopoverGroup(container);
            return;
        }

        closeAllPopovers(container);

        popover.hidden = false;
        trigger.classList.add("is-open");
        rateButton.setAttribute("aria-expanded", "true");
        await loadPreviousVote();
    }

    summaryElement.addEventListener("click", (event) => {
        triggerStarBurst(starsElement);
        toggleRatingPopover(event);
    });

    summaryElement.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        triggerStarBurst(starsElement);
        toggleRatingPopover(event);
    });

    rateButton.addEventListener("click", toggleRatingPopover);

    container.appendChild(trigger);
    return container;
}

function createPortCompatibility(
    port,
    compatibility,
    compatibilityActions,
    onCompatibilityUpdated = null
) {
    if (!port.portId) return null;

    const container = document.createElement("div");
    container.className = "port-compat";

    let summary = normalizeCompatSummary(compatibility?.[port.portId]);

    const bar = document.createElement("div");
    bar.className = "port-compat-bar";

    const mainGroup = document.createElement("div");
    mainGroup.className = "port-compat-main";

    const summaryGroup = document.createElement("div");
    summaryGroup.className = "port-compat-summary-group";

    const summaryTitle = document.createElement("span");
    summaryTitle.className = "port-compat-title";
    summaryTitle.textContent = "Compatibility";

    const summaryText = document.createElement("span");
    summaryText.className = "port-compat-summary";

    summaryGroup.append(summaryTitle, summaryText);

    const actionsGroup = document.createElement("div");
    actionsGroup.className = "port-compat-actions";

    const toggleListButton = document.createElement("button");
    toggleListButton.type = "button";
    toggleListButton.className = "port-compat-toggle";
    toggleListButton.setAttribute("aria-expanded", "false");

    const meter = document.createElement("div");
    meter.className = "port-compat-meter";
    meter.setAttribute("role", "img");

    const meter60 = document.createElement("div");
    meter60.className = "port-compat-meter-segment is-playable-60";

    const meter30 = document.createElement("div");
    meter30.className = "port-compat-meter-segment is-playable-30";

    const meterLow = document.createElement("div");
    meterLow.className = "port-compat-meter-segment is-low-fps";

    const meterCrash = document.createElement("div");
    meterCrash.className = "port-compat-meter-segment is-crash";

    meter.append(meter60, meter30, meterLow, meterCrash);

    const listElement = document.createElement("div");
    listElement.className = "port-compat-list";
    listElement.hidden = true;

    function renderCompatibilitySummary(nextSummary) {
        summary = normalizeCompatSummary(nextSummary);
        const { counts, total, reports } = summary;

        if (total === 0) {
            summaryText.textContent = "No reports yet";
            summaryText.classList.add("is-empty");
            meter.classList.add("is-empty");
            meter60.style.width = "0%";
            meter30.style.width = "0%";
            meterLow.style.width = "0%";
            meterCrash.style.width = "0%";
            meter.setAttribute("aria-label", "No compatibility reports yet");
        } else {
            const playablePct = Math.round(
                ((counts.playable_60 + counts.playable_30) / total) * 100
            );
            const parts = COMPAT_STATUSES.filter((tier) => counts[tier.id] > 0).map(
                (tier) => `${counts[tier.id]} ${tier.shortLabel}`
            );

            summaryText.textContent = `${playablePct}% playable (${parts.join(" · ")})`;
            summaryText.classList.remove("is-empty");
            meter.classList.remove("is-empty");
            meter60.style.width = `${(counts.playable_60 / total) * 100}%`;
            meter30.style.width = `${(counts.playable_30 / total) * 100}%`;
            meterLow.style.width = `${(counts.low_fps / total) * 100}%`;
            meterCrash.style.width = `${(counts.crash / total) * 100}%`;
            meter.setAttribute(
                "aria-label",
                `${playablePct}% playable (${parts.join(", ")})`
            );
        }

        if (reports.length === 0) {
            toggleListButton.hidden = true;
            listElement.hidden = true;
            toggleListButton.setAttribute("aria-expanded", "false");
            listElement.replaceChildren();
        } else {
            toggleListButton.hidden = false;
            toggleListButton.textContent = `Devices (${reports.length})`;
            listElement.replaceChildren();

            const groupedReports = groupIdenticalCompatReports(reports);
            for (const item of groupedReports.slice(0, 15)) {
                const row = document.createElement("div");
                row.className = "port-compat-row";

                const nameWrap = document.createElement("div");
                nameWrap.className = "port-compat-device-wrap";

                const name = document.createElement("span");
                name.className = "port-compat-device";
                name.textContent =
                    item.count > 1
                        ? `${item.model} (${item.count})`
                        : item.model;
                nameWrap.appendChild(name);

                if (item.soc) {
                    const socLabel = document.createElement("span");
                    socLabel.className = "port-compat-soc";
                    socLabel.textContent = ` · ${item.soc}`;
                    nameWrap.appendChild(socLabel);
                }

                const tier = getCompatStatusMeta(item.status, item.works);
                const status = document.createElement("span");
                status.className = `port-compat-status is-${tier.id.replace(/_/g, "-")}`;
                status.textContent = tier.label;

                row.append(nameWrap, status);
                listElement.appendChild(row);
            }
        }
    }

    toggleListButton.addEventListener("click", () => {
        const nextHidden = !listElement.hidden;
        listElement.hidden = nextHidden;
        toggleListButton.setAttribute(
            "aria-expanded",
            nextHidden ? "false" : "true"
        );
    });

    const reportButton = document.createElement("button");
    reportButton.type = "button";
    reportButton.className = "port-compat-button";
    reportButton.textContent = "Works?";
    reportButton.setAttribute("aria-expanded", "false");

    const popover = document.createElement("div");
    popover.className = "port-compat-popover";
    popover.hidden = true;

    const title = document.createElement("h4");
    title.className = "port-rating-popover-title";
    title.textContent = "Device compatibility";

    const subtitle = document.createElement("p");
    subtitle.className = "port-rating-popover-description";
    subtitle.textContent = "How does this port run on your Android device?";

    const tiersGroup = document.createElement("div");
    tiersGroup.className = "port-compat-tiers";

    let selectedStatus = "";
    const statusButtons = new Map();

    for (const tier of COMPAT_STATUSES) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `port-compat-choice is-${tier.id.replace(/_/g, "-")}`;
        btn.textContent = tier.label;
        btn.addEventListener("click", () => {
            if (submitting) return;
            selectedStatus = tier.id;
            for (const [id, otherBtn] of statusButtons.entries()) {
                otherBtn.classList.toggle("selected", id === tier.id);
            }
            updateCompatSubmitState();
        });
        statusButtons.set(tier.id, btn);
        tiersGroup.appendChild(btn);
    }

    const deviceField = document.createElement("div");
    deviceField.className = "port-device-field";

    const deviceLabel = document.createElement("label");
    deviceLabel.className = "port-device-label";
    deviceLabel.textContent = "Device model / SoC (select from list)";

    const deviceInput = document.createElement("input");
    deviceInput.type = "text";
    deviceInput.className = "port-device-input";
    deviceInput.placeholder = "Search model or SoC (e.g. Poco F5, Odin 2, Snapdragon 8 Gen 2)";
    deviceInput.autocomplete = "off";

    const resultsBox = document.createElement("div");
    resultsBox.className = "port-device-results";
    resultsBox.hidden = true;

    const selectedNote = document.createElement("div");
    selectedNote.className = "port-device-selected";
    selectedNote.hidden = true;

    deviceField.append(deviceLabel, deviceInput, resultsBox, selectedNote);

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "port-rating-submit";
    submitBtn.textContent = "Submit report";
    submitBtn.disabled = true;

    const feedback = document.createElement("p");
    feedback.className = "port-rating-feedback";
    feedback.textContent = "Choose a performance level and select an exact device.";

    popover.append(
        title,
        subtitle,
        tiersGroup,
        deviceField,
        submitBtn,
        feedback
    );

    let selectedDevice = getStoredUserDevice();
    let devicesList = null;
    let loadingDevices = false;
    let submitting = false;

    function setCompatFeedback(message, type = "") {
        feedback.className = "port-rating-feedback";
        if (type) feedback.classList.add(type);
        feedback.textContent = message;
    }

    function updateSelectedDeviceUI() {
        if (selectedDevice) {
            const parts = parseDeviceDisplayParts(
                selectedDevice.model || selectedDevice.name,
                selectedDevice.soc || ""
            );
            const displayModel = selectedDevice.model || parts.model || selectedDevice.name;
            const displaySoc = selectedDevice.soc || parts.soc;
            selectedNote.hidden = false;
            selectedNote.textContent = displaySoc
                ? `Selected: ${displayModel} · ${displaySoc}`
                : `Selected: ${displayModel}`;
            if (deviceInput.value !== displayModel) {
                deviceInput.value = displayModel;
            }
        } else {
            selectedNote.hidden = true;
            selectedNote.textContent = "";
        }
    }

    function updateCompatSubmitState() {
        submitBtn.disabled =
            submitting ||
            !selectedStatus ||
            !selectedDevice ||
            !selectedDevice.id;
    }

    updateSelectedDeviceUI();
    updateCompatSubmitState();

    async function ensureDevicesLoaded() {
        if (devicesList) return devicesList;
        if (loadingDevices) return null;
        loadingDevices = true;
        setCompatFeedback("Loading Android device database...");
        try {
            devicesList = await loadDevices();
            setCompatFeedback("Choose a performance level and select an exact device.");
            return devicesList;
        } catch (error) {
            setCompatFeedback(
                error.message || "Could not load device list.",
                "error"
            );
            return null;
        } finally {
            loadingDevices = false;
        }
    }

    function renderDeviceResults(matches) {
        resultsBox.replaceChildren();
        if (!matches || matches.length === 0) {
            resultsBox.hidden = true;
            return;
        }

        for (const device of matches) {
            const option = document.createElement("button");
            option.type = "button";
            option.className = "port-device-option";

            const modelSpan = document.createElement("span");
            modelSpan.className = "port-device-name";
            modelSpan.textContent = device.model || device.name;
            option.appendChild(modelSpan);

            if (device.soc) {
                const socSpan = document.createElement("span");
                socSpan.className = "port-device-soc";
                socSpan.textContent = device.soc;
                option.appendChild(socSpan);
            }

            option.addEventListener("click", () => {
                selectedDevice = {
                    id: device.id,
                    name: device.name,
                    model: device.model || device.name,
                    soc: device.soc || "",
                };
                setStoredUserDevice(selectedDevice);
                resultsBox.hidden = true;
                updateSelectedDeviceUI();
                updateCompatSubmitState();
                setCompatFeedback("Ready to submit.");
            });
            resultsBox.appendChild(option);
        }
        resultsBox.hidden = false;
    }

    deviceInput.addEventListener("input", async () => {
        // Strict rule: typing invalidates any previous selection until clicked from list
        selectedDevice = null;
        updateSelectedDeviceUI();
        updateCompatSubmitState();

        const query = deviceInput.value.trim();
        if (query.length < 2) {
            resultsBox.hidden = true;
            resultsBox.replaceChildren();
            return;
        }

        const list = await ensureDevicesLoaded();
        if (!list) return;

        const matches = searchDevices(list, query, 25);
        if (matches.length === 0) {
            resultsBox.replaceChildren();
            const empty = document.createElement("div");
            empty.className = "port-device-empty";
            empty.textContent = "No matching Android device found.";
            resultsBox.appendChild(empty);
            resultsBox.hidden = false;
            return;
        }

        renderDeviceResults(matches);
    });

    submitBtn.addEventListener("click", async () => {
        if (
            submitting ||
            !selectedStatus ||
            !selectedDevice ||
            !compatibilityActions?.submitReport
        ) {
            return;
        }

        submitting = true;
        updateCompatSubmitState();
        setCompatFeedback("Saving compatibility report...");

        try {
            const result = await compatibilityActions.submitReport({
                portId: port.portId,
                deviceId: selectedDevice.id,
                status: selectedStatus,
            });

            if (result?.summary) {
                renderCompatibilitySummary(result.summary);
                onCompatibilityUpdated?.(port.portId, result.summary);
            }

            setCompatFeedback("Report saved!", "success");
            setTimeout(() => {
                closePopoverGroup(container);
            }, 800);
        } catch (error) {
            setCompatFeedback(
                error.message || "Could not save your report.",
                "error"
            );
        } finally {
            submitting = false;
            updateCompatSubmitState();
        }
    });

    const trigger = document.createElement("div");
    trigger.className = "port-compat-trigger";
    trigger.append(reportButton, popover);

    reportButton.addEventListener("click", async (event) => {
        event.stopPropagation();

        if (!popover.hidden) {
            closePopoverGroup(container);
            return;
        }

        closeAllPopovers(container);

        popover.hidden = false;
        trigger.classList.add("is-open");
        reportButton.setAttribute("aria-expanded", "true");

        // Load public compatibility data only when the user opens this panel.
        if (compatibilityActions?.loadSummary) {
            setCompatFeedback("Loading compatibility results...");
            try {
                const latestSummary = await compatibilityActions.loadSummary(port.portId);
                if (latestSummary) renderCompatibilitySummary(latestSummary);
                setCompatFeedback("Choose a performance level and select an exact device.");
            } catch (error) {
                setCompatFeedback(error.message || "Could not load compatibility results.", "error");
            }
        }
        await ensureDevicesLoaded();
    });

    mainGroup.append(summaryGroup, meter);
    actionsGroup.append(toggleListButton, trigger);
    bar.append(mainGroup, actionsGroup);
    container.append(bar, listElement);

    renderCompatibilitySummary(summary);
    return container;
}

function createInputSvg(kind) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.9");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    if (kind === "controller") {
        const lines = [
            { x1: "6", y1: "11", x2: "10", y2: "11" },
            { x1: "8", y1: "9", x2: "8", y2: "13" },
            { x1: "15", y1: "12", x2: "15.01", y2: "12" },
            { x1: "18", y1: "10", x2: "18.01", y2: "10" },
        ];
        for (const attrs of lines) {
            const line = document.createElementNS(svgNS, "line");
            for (const [k, v] of Object.entries(attrs)) line.setAttribute(k, v);
            svg.appendChild(line);
        }
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute(
            "d",
            "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"
        );
        svg.appendChild(path);
        return svg;
    }

    const touchPaths = [
        "M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2",
        "M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1",
        "M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10",
        "M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
    ];
    for (const d of touchPaths) {
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

function createSupportedInputsValue(rawValue) {
    const text = String(rawValue || "").trim();
    if (!text || text === "-") return "-";

    const normalized = text.toLowerCase();
    const hasController = normalized.includes("controller") || normalized.includes("gamepad");
    const hasTouch = normalized.includes("touch");

    if (!hasController && !hasTouch) {
        return text;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "port-detail-value port-inputs-icons";
    wrapper.setAttribute("aria-label", text);
    wrapper.title = text;

    if (hasController) {
        const item = document.createElement("span");
        item.className = "port-input-icon";
        item.title = "Controller";
        item.appendChild(createInputSvg("controller"));
        wrapper.appendChild(item);
    }

    if (hasTouch) {
        const item = document.createElement("span");
        item.className = "port-input-icon";
        item.title = "Touch controls";
        item.appendChild(createInputSvg("touch"));
        wrapper.appendChild(item);
    }

    return wrapper;
}

function createPortDetail(label, value, url = "", linkOptions = null) {
    const detail = document.createElement("div");
    detail.className = "port-detail";

    const labelElement = document.createElement("span");
    labelElement.className = "port-detail-label";
    labelElement.textContent = label;

    if (typeof Node !== "undefined" && value instanceof Node) {
        detail.append(labelElement, value);
        return detail;
    }

    const textValue = String(value ?? "").trim() || "-";
    const trimmedUrl = String(url || "").trim();
    const isExternalUrl = /^https?:\/\/\S+$/i.test(trimmedUrl);
    const isInternalHref = Boolean(linkOptions?.internal && trimmedUrl);
    const hasUrl = textValue !== "-" && (isExternalUrl || isInternalHref);
    const valueElement = hasUrl
        ? document.createElement("a")
        : document.createElement("div");

    valueElement.className = "port-detail-value";
    if (linkOptions?.className && hasUrl) {
        valueElement.classList.add(linkOptions.className);
    }
    valueElement.textContent = textValue;

    if (hasUrl) {
        valueElement.href = trimmedUrl;
        if (isExternalUrl && !linkOptions?.internal) {
            valueElement.target = "_blank";
            valueElement.rel = "noopener noreferrer";
        }
        if (linkOptions?.title) {
            valueElement.title = linkOptions.title;
        }
        if (linkOptions?.ariaLabel) {
            valueElement.setAttribute("aria-label", linkOptions.ariaLabel);
        }
    }

    detail.append(labelElement, valueElement);
    return detail;
}

function createExpandableDescription(description) {
    const container = document.createElement("div");
    container.className = "game-summary-description-container";

    const text = document.createElement("p");
    text.className = "game-summary-description";
    text.textContent = restoreDescriptionLineBreaks(description);

    const collapsedStyles = {
        display: "-webkit-box",
        overflow: "hidden",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: "4",
    };

    Object.assign(text.style, collapsedStyles);
    container.appendChild(text);

    requestAnimationFrame(() => {
        if (!text.isConnected) return;

        const isLong = text.scrollHeight > text.clientHeight + 1;
        if (!isLong) {
            text.style.display = "block";
            text.style.overflow = "visible";
            text.style.webkitLineClamp = "unset";
            return;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "game-description-toggle";
        button.textContent = "Show more";
        button.setAttribute("aria-expanded", "false");

        button.addEventListener("click", () => {
            const expanded = button.getAttribute("aria-expanded") === "true";

            if (expanded) {
                Object.assign(text.style, collapsedStyles);
                button.textContent = "Show more";
                button.setAttribute("aria-expanded", "false");
            } else {
                text.style.display = "block";
                text.style.overflow = "visible";
                text.style.webkitLineClamp = "unset";
                text.style.webkitBoxOrient = "initial";
                button.textContent = "Show less";
                button.setAttribute("aria-expanded", "true");
            }
        });

        container.appendChild(button);
    });

    return container;
}

function formatShortDateDisplay(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.replace(/^(\d{4}-\d{2}-\d{2})[ T].*$/, "$1");
}

function createCoverFallback(gameName) {
    const fallback = document.createElement("div");
    fallback.className = "game-cover-fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.innerHTML =
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>';

    const caption = document.createElement("span");
    caption.className = "game-cover-fallback-title";
    caption.textContent = gameName;
    fallback.appendChild(caption);
    return fallback;
}

function createShareSvg(kind) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");

    if (kind === "share") {
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");

        const circles = [
            { cx: "18", cy: "5", r: "3" },
            { cx: "6", cy: "12", r: "3" },
            { cx: "18", cy: "19", r: "3" },
        ];
        for (const attrs of circles) {
            const circle = document.createElementNS(svgNS, "circle");
            for (const [k, v] of Object.entries(attrs)) circle.setAttribute(k, v);
            svg.appendChild(circle);
        }

        const lines = [
            { x1: "8.59", y1: "13.51", x2: "15.42", y2: "17.49" },
            { x1: "15.41", y1: "6.51", x2: "8.59", y2: "10.49" },
        ];
        for (const attrs of lines) {
            const line = document.createElementNS(svgNS, "line");
            for (const [k, v] of Object.entries(attrs)) line.setAttribute(k, v);
            svg.appendChild(line);
        }
        return svg;
    }

    if (kind === "close") {
        svg.setAttribute("width", "14");
        svg.setAttribute("height", "14");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.2");
        svg.setAttribute("stroke-linecap", "round");
        const lines = [
            { x1: "18", y1: "6", x2: "6", y2: "18" },
            { x1: "6", y1: "6", x2: "18", y2: "18" },
        ];
        for (const attrs of lines) {
            const line = document.createElementNS(svgNS, "line");
            for (const [k, v] of Object.entries(attrs)) line.setAttribute(k, v);
            svg.appendChild(line);
        }
        return svg;
    }

    if (kind === "check") {
        svg.setAttribute("width", "14");
        svg.setAttribute("height", "14");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.4");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");

        const polyline = document.createElementNS(svgNS, "polyline");
        polyline.setAttribute("points", "20 6 9 17 4 12");
        svg.appendChild(polyline);
        return svg;
    }

    if (kind === "whatsapp") {
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        svg.setAttribute("fill", "currentColor");
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("fill-rule", "evenodd");
        path.setAttribute("clip-rule", "evenodd");
        path.setAttribute(
            "d",
            "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
        );
        svg.appendChild(path);
        return svg;
    }

    if (kind === "reddit") {
        svg.setAttribute("width", "28");
        svg.setAttribute("height", "28");

        const stem = document.createElementNS(svgNS, "path");
        stem.setAttribute("d", "M12 9.2L13.4 4.3L16.7 5.0");
        stem.setAttribute("fill", "none");
        stem.setAttribute("stroke", "#ffffff");
        stem.setAttribute("stroke-width", "1.6");
        stem.setAttribute("stroke-linecap", "round");
        stem.setAttribute("stroke-linejoin", "round");

        const tip = document.createElementNS(svgNS, "circle");
        tip.setAttribute("cx", "18.2");
        tip.setAttribute("cy", "5.2");
        tip.setAttribute("r", "1.7");
        tip.setAttribute("fill", "#ffffff");

        const leftEar = document.createElementNS(svgNS, "circle");
        leftEar.setAttribute("cx", "4.8");
        leftEar.setAttribute("cy", "12.6");
        leftEar.setAttribute("r", "2.1");
        leftEar.setAttribute("fill", "#ffffff");

        const rightEar = document.createElementNS(svgNS, "circle");
        rightEar.setAttribute("cx", "19.2");
        rightEar.setAttribute("cy", "12.6");
        rightEar.setAttribute("r", "2.1");
        rightEar.setAttribute("fill", "#ffffff");

        const head = document.createElementNS(svgNS, "ellipse");
        head.setAttribute("cx", "12");
        head.setAttribute("cy", "14.2");
        head.setAttribute("rx", "7.6");
        head.setAttribute("ry", "5.6");
        head.setAttribute("fill", "#ffffff");

        const leftEye = document.createElementNS(svgNS, "circle");
        leftEye.setAttribute("cx", "9.1");
        leftEye.setAttribute("cy", "13.5");
        leftEye.setAttribute("r", "1.25");
        leftEye.setAttribute("fill", "#ff4500");

        const rightEye = document.createElementNS(svgNS, "circle");
        rightEye.setAttribute("cx", "14.9");
        rightEye.setAttribute("cy", "13.5");
        rightEye.setAttribute("r", "1.25");
        rightEye.setAttribute("fill", "#ff4500");

        const smile = document.createElementNS(svgNS, "path");
        smile.setAttribute("d", "M8.8 16.3c1.4 1.3 5.0 1.3 6.4 0");
        smile.setAttribute("fill", "none");
        smile.setAttribute("stroke", "#ff4500");
        smile.setAttribute("stroke-width", "1.35");
        smile.setAttribute("stroke-linecap", "round");

        svg.append(stem, tip, leftEar, rightEar, head, leftEye, rightEye, smile);
        return svg;
    }

    if (kind === "x") {
        svg.setAttribute("width", "20");
        svg.setAttribute("height", "20");
        svg.setAttribute("fill", "currentColor");
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute(
            "d",
            "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        );
        svg.appendChild(path);
        return svg;
    }

    // Facebook official flush-bottom white 'f' mark inside #1877F2 circle
    svg.setAttribute("width", "44");
    svg.setAttribute("height", "44");
    svg.setAttribute("fill", "currentColor");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute(
        "d",
        "M13.5 24v-9.4h3.15l.47-3.65H13.5V8.62c0-1.06.29-1.78 1.81-1.78h1.93V3.57c-.33-.04-1.48-.14-2.81-.14-2.78 0-4.68 1.7-4.68 4.81v2.71H6.6v3.65h3.15V24h3.75z"
    );
    svg.appendChild(path);
    return svg;
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to execCommand fallback
        }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    } finally {
        textarea.remove();
    }
    return copied;
}

let activeShareToastTimer = null;
let activeShareToastRemoveTimer = null;

function showShareToast(message) {
    let toast = document.getElementById("napl-share-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "napl-share-toast";
        toast.className = "game-share-toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        document.body.appendChild(toast);
    }

    if (activeShareToastTimer) clearTimeout(activeShareToastTimer);
    if (activeShareToastRemoveTimer) clearTimeout(activeShareToastRemoveTimer);

    toast.replaceChildren(createShareSvg("check"));
    const label = document.createElement("span");
    label.textContent = message;
    toast.appendChild(label);

    toast.classList.remove("is-visible");
    void toast.offsetWidth;
    toast.classList.add("is-visible");

    activeShareToastTimer = setTimeout(() => {
        toast.classList.remove("is-visible");
        activeShareToastTimer = null;
        activeShareToastRemoveTimer = setTimeout(() => {
            toast.remove();
            activeShareToastRemoveTimer = null;
        }, 220);
    }, 2200);
}

function createGameShareControl(game) {
    initializeRatingPopoverEvents();

    const shareUrl = new URL("./", window.location.href);
    if (game?.slug) {
        shareUrl.searchParams.set("game", game.slug);
    } else {
        const currentSlug = new URLSearchParams(window.location.search).get("game");
        if (currentSlug) shareUrl.searchParams.set("game", currentSlug);
    }

    const canonicalUrl = shareUrl.href;
    const shareTitle = `${game.name} — NAPL`;
    const shareText = `Check out ${game.name} native Android ports on NAPL`;

    const trigger = document.createElement("div");
    trigger.className = "game-share-trigger";

    const shareButton = document.createElement("button");
    shareButton.type = "button";
    shareButton.className = "game-share-button";
    shareButton.title = "Share";
    shareButton.setAttribute("aria-label", `Share ${game.name}`);
    shareButton.setAttribute("aria-expanded", "false");
    shareButton.setAttribute("aria-haspopup", "dialog");
    shareButton.appendChild(createShareSvg("share"));

    const popover = document.createElement("div");
    popover.className = "game-share-popover";
    popover.hidden = true;
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", `Share ${game.name}`);

    const popHead = document.createElement("div");
    popHead.className = "game-share-popover-head";

    const popTitle = document.createElement("h4");
    popTitle.className = "game-share-popover-title";
    popTitle.textContent = "Share";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "game-share-close";
    closeButton.setAttribute("aria-label", "Close share menu");
    closeButton.appendChild(createShareSvg("close"));
    closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        closePopoverGroup(trigger);
        shareButton.focus();
    });

    popHead.append(popTitle, closeButton);

    const platformsGrid = document.createElement("div");
    platformsGrid.className = "game-share-platforms";

    const platforms = [
        {
            id: "whatsapp",
            label: "WhatsApp",
            href: `https://api.whatsapp.com/send?text=${encodeURIComponent(`${shareText} ${canonicalUrl}`)}`,
        },
        {
            id: "reddit",
            label: "Reddit",
            href: `https://www.reddit.com/submit?url=${encodeURIComponent(canonicalUrl)}&title=${encodeURIComponent(shareTitle)}`,
        },
        {
            id: "x",
            label: "X",
            href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(canonicalUrl)}`,
        },
        {
            id: "facebook",
            label: "Facebook",
            href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonicalUrl)}`,
        },
    ];

    for (const platform of platforms) {
        const anchor = document.createElement("a");
        anchor.className = `game-share-platform is-${platform.id}`;
        anchor.href = platform.href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.setAttribute("aria-label", `Share on ${platform.label}`);

        const iconBox = document.createElement("span");
        iconBox.className = "game-share-platform-icon";
        iconBox.appendChild(createShareSvg(platform.id));

        const label = document.createElement("span");
        label.className = "game-share-platform-label";
        label.textContent = platform.label;

        anchor.append(iconBox, label);
        platformsGrid.appendChild(anchor);
    }

    const copyBox = document.createElement("div");
    copyBox.className = "game-share-copy-box";

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.readOnly = true;
    urlInput.className = "game-share-url-input";
    urlInput.value = canonicalUrl;
    urlInput.setAttribute("aria-label", "Direct game link");
    urlInput.addEventListener("click", () => {
        urlInput.select();
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "game-share-copy-btn";
    copyButton.textContent = "Copy Link";

    let resetTimer = null;
    copyButton.addEventListener("click", async () => {
        const copied = await copyTextToClipboard(canonicalUrl);
        if (!copied) {
            urlInput.select();
            return;
        }

        if (resetTimer) clearTimeout(resetTimer);
        copyBox.classList.add("is-copied");
        copyButton.classList.add("is-copied");
        const copiedLabel = document.createElement("span");
        copiedLabel.textContent = "Copied!";
        copyButton.replaceChildren(createShareSvg("check"), copiedLabel);
        showShareToast("Link Copied!");

        resetTimer = setTimeout(() => {
            copyBox.classList.remove("is-copied");
            copyButton.classList.remove("is-copied");
            copyButton.textContent = "Copy Link";
            resetTimer = null;
        }, 1800);
    });

    copyBox.append(urlInput, copyButton);
    popover.append(popHead, platformsGrid, copyBox);
    trigger.append(shareButton, popover);

    shareButton.addEventListener("click", (event) => {
        event.stopPropagation();

        if (!popover.hidden) {
            closePopoverGroup(trigger);
            return;
        }

        closeAllPopovers(trigger);

        popover.hidden = false;
        trigger.classList.add("is-open");
        shareButton.setAttribute("aria-expanded", "true");
    });

    popover.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    return trigger;
}

function displayGameSummary(game, parentElement) {
    parentElement.replaceChildren();
    parentElement.className = "game-header game-summary-card game-hero";

    const backdropLayer = document.createElement("div");
    backdropLayer.className = "game-hero-backdrop-layer";
    backdropLayer.setAttribute("aria-hidden", "true");

    const backdropImg = document.createElement("img");
    backdropImg.className = "game-hero-backdrop";
    backdropImg.alt = "";
    backdropImg.decoding = "async";
    backdropImg.referrerPolicy = "no-referrer";
    backdropLayer.appendChild(backdropImg);

    const syncBackdrop = (src) => {
        if (src) {
            backdropImg.src = src;
            backdropImg.classList.add("is-loaded");
        } else {
            backdropImg.classList.remove("is-loaded");
            backdropImg.removeAttribute("src");
        }
    };

    const heroGrid = document.createElement("div");
    heroGrid.className = "game-summary-top";

    const media = document.createElement("div");
    media.className = "game-hero-media";

    const coverUrl = String(game.coverUrl || "").trim();
    if (/^https?:\/\/\S+$/i.test(coverUrl)) {
        const cover = document.createElement("img");
        cover.className = "game-summary-cover";
        cover.alt = `${game.name} cover`;
        cover.loading = "eager";
        cover.decoding = "async";
        cover.referrerPolicy = "no-referrer";
        cover.addEventListener(
            "load",
            () => {
                syncBackdrop(cover.currentSrc || cover.src);
            },
            { once: true }
        );
        media.appendChild(cover);
        loadCoverImage(cover, coverUrl, () => {
            syncBackdrop("");
            cover.replaceWith(createCoverFallback(game.name));
        });
        if (cover.complete && cover.naturalWidth > 0) {
            syncBackdrop(cover.currentSrc || cover.src);
        }
    } else {
        media.appendChild(createCoverFallback(game.name));
    }

    const headerInfo = document.createElement("div");
    headerInfo.className = "game-summary-info";

    const headerTop = document.createElement("div");
    headerTop.className = "game-summary-head";

    const title = document.createElement("h1");
    title.id = "game-title";
    title.className = "game-summary-title";
    title.textContent = game.name;

    headerTop.append(title, createGameShareControl(game));
    headerInfo.appendChild(headerTop);

    const metadata = document.createElement("div");
    metadata.className = "game-summary-metadata";

    const metaNodes = [];

    if (game.year) {
        const cleanYear = normalizeYearValue(game.year);
        if (cleanYear) {
            const yearLink = document.createElement("a");
            yearLink.className = "game-summary-year game-summary-meta-link";
            yearLink.href = `./?year=${encodeURIComponent(cleanYear)}`;
            yearLink.textContent = cleanYear;
            yearLink.title = `View all games from ${cleanYear}`;
            yearLink.setAttribute(
                "aria-label",
                `Filter games released in ${cleanYear}`
            );
            metaNodes.push(yearLink);
        } else {
            const yearSpan = document.createElement("span");
            yearSpan.className = "game-summary-year";
            yearSpan.textContent = String(game.year);
            metaNodes.push(yearSpan);
        }
    }

    if (game.genre) {
        const genres = extractGameGenres(game.genre);
        const genreWrap = document.createElement("span");
        genreWrap.className = "game-summary-genre";

        if (genres.length > 0) {
            genres.forEach((genreLabel, idx) => {
                if (idx > 0) {
                    genreWrap.appendChild(document.createTextNode(", "));
                }
                const genreLink = document.createElement("a");
                genreLink.className = "game-summary-meta-link";
                genreLink.href = `./?genre=${encodeURIComponent(
                    genreLabel
                )}`;
                genreLink.textContent = genreLabel;
                genreLink.title = `View all ${genreLabel} games`;
                genreLink.setAttribute(
                    "aria-label",
                    `Filter games by genre ${genreLabel}`
                );
                genreWrap.appendChild(genreLink);
            });
        } else {
            genreWrap.textContent = String(game.genre);
        }

        metaNodes.push(genreWrap);
    }

    metaNodes.forEach((node, idx) => {
        if (idx > 0) {
            const sep = document.createElement("span");
            sep.className = "game-summary-meta-sep";
            sep.setAttribute("aria-hidden", "true");
            sep.textContent = "·";
            metadata.appendChild(sep);
        }
        metadata.appendChild(node);
    });

    if (metadata.children.length > 0) {
        headerInfo.appendChild(metadata);
    }

    const heroBody = document.createElement("div");
    heroBody.className = "game-hero-body";
    if (game.description) {
        heroBody.appendChild(createExpandableDescription(game.description));
    } else {
        const emptyDesc = document.createElement("p");
        emptyDesc.className = "game-summary-description is-muted";
        emptyDesc.textContent =
            "Compare available native Android ports, community ratings, and device compatibility reports below.";
        heroBody.appendChild(emptyDesc);
    }

    heroGrid.append(media, headerInfo, heroBody);
    parentElement.classList.add("is-entering");
    parentElement.addEventListener(
        "animationend",
        () => parentElement.classList.remove("is-entering"),
        { once: true }
    );
    parentElement.append(backdropLayer, heroGrid);
}

function displayPortCard(
    port,
    index,
    allRows,
    ratings,
    ratingActions,
    compatibility,
    compatibilityActions,
    options = {}
) {
    const {
        isSpotlight = false,
        spotlightLabel = "",
        onRatingUpdated = null,
        onCompatibilityUpdated = null,
        developerCounts = null,
        currentGameName = "",
    } = options;

    const card = document.createElement("article");
    card.className = "port port-card";
    if (isSpotlight) {
        card.classList.add("is-spotlight");
    }

    const top = document.createElement("div");
    top.className = "port-top";

    if (spotlightLabel) {
        const kicker = document.createElement("div");
        kicker.className = "port-spotlight-kicker";
        if (spotlightLabel.startsWith("Top Rated")) {
            kicker.classList.add("is-gold");
        }
        kicker.textContent = spotlightLabel;
        top.appendChild(kicker);
    }

    const topRow = document.createElement("div");
    topRow.className = "port-top-row";

    const title = document.createElement("h3");
    title.className = "port-title";
    title.textContent = port.project || `Port ${index + 1}`;
    topRow.appendChild(title);

    const rating = createPortRating(
        port,
        ratings,
        ratingActions,
        onRatingUpdated
    );
    if (rating) topRow.appendChild(rating);
    top.appendChild(topRow);
    card.appendChild(top);

    const details = document.createElement("div");
    details.className = "port-details";

    const lastUpdateDisplay = formatShortDateDisplay(port.lastUpdate);
    const supportedInputsValue = createSupportedInputsValue(port.controller);
    const devDisplay = String(port.developer || "").trim();
    const devKey = normalizeDeveloperName(devDisplay);
    const devGameCount =
        devKey && developerCounts ? developerCounts.get(devKey) || 0 : 0;
    const devUrl =
        devGameCount > 1
            ? `./?dev=${encodeURIComponent(devDisplay)}`
            : "";
    const devLinkOptions =
        devGameCount > 1
            ? {
                  internal: true,
                  className: "port-detail-dev-link",
                  title: `View all ${devGameCount} games by ${devDisplay}`,
                  ariaLabel: `View all ${devGameCount} games by ${devDisplay}`,
              }
            : null;

    const fields = [
        ["Port type", port.platform, "", null],
        ["Developer", port.developer, devUrl, devLinkOptions],
        ["Version", port.version, "", null],
        ["Last update", lastUpdateDisplay, "", null],
        ["Supported inputs", supportedInputsValue, "", null],
        ["Need game files?", port.files, port.dataUrl, null],
    ];

    for (const [label, value, url, linkOptions] of fields) {
        const detail = createPortDetail(label, value, url, linkOptions);
        if (detail) details.appendChild(detail);
    }

    if (details.childElementCount > 0) {
        card.appendChild(details);
    }

    if (port.notes) {
        const notes = document.createElement("div");
        notes.className = "port-notes";

        const label = document.createElement("div");
        label.className = "port-notes-label";
        label.textContent = "NOTES";

        const text = document.createElement("p");
        text.className = "port-notes-text";
        text.textContent = port.notes;

        notes.append(label, text);
        card.appendChild(notes);
    }

    const compatSection = createPortCompatibility(
        port,
        compatibility,
        compatibilityActions,
        onCompatibilityUpdated
    );
    if (compatSection) {
        const separator = document.createElement("div");
        separator.className = "port-compat-separator";
        separator.setAttribute("aria-hidden", "true");
        card.appendChild(separator);
        card.appendChild(compatSection);
    }

    const portUrl = String(port.url || "").trim();
    if (/^https?:\/\/\S+$/i.test(portUrl)) {
        const linkRow = document.createElement("div");
        linkRow.className = "port-link-row";

        const link = document.createElement("a");
        link.className = "port-link";
        link.href = portUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = port.link || "Download / View Port";

        const arrow = document.createElement("span");
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "↗";
        link.appendChild(arrow);
        linkRow.appendChild(link);

        const reportTrigger = document.createElement("div");
        reportTrigger.className = "port-report-link-trigger";

        const reportBtn = document.createElement("button");
        reportBtn.type = "button";
        reportBtn.className = "port-report-link-button";
        reportBtn.textContent = "Report link";
        reportBtn.setAttribute("aria-expanded", "false");

        const reportPopover = document.createElement("div");
        reportPopover.className = "port-report-link-popover";
        reportPopover.hidden = true;

        const rTitle = document.createElement("h4");
        rTitle.className = "port-rating-popover-title";
        rTitle.textContent = "Report broken link";

        const rDesc = document.createElement("p");
        rDesc.className = "port-rating-popover-description";
        rDesc.textContent = "Select the issue with this link";

        const reasons = [
            "Dead / 404 link",
            "Wrong game or version",
            "Requires account / paywall",
            "Suspicious / broken file",
        ];

        const MAX_REPORT_NOTE_LENGTH = 80;
        let selectedReason = "";
        let sendingReport = false;
        const reasonButtons = [];

        const noteField = document.createElement("div");
        noteField.className = "port-report-note-field";

        const noteHeader = document.createElement("div");
        noteHeader.className = "port-report-note-header";

        const noteLabel = document.createElement("label");
        noteLabel.className = "port-report-note-label";
        const noteId = `port-report-note-${createSlug(
            port.portId || port.project || port.game || "link"
        )}-${Math.random().toString(36).slice(2, 7)}`;
        noteLabel.htmlFor = noteId;
        noteLabel.textContent = "Short note (optional)";

        const noteCounter = document.createElement("span");
        noteCounter.className = "port-report-note-count";
        noteCounter.textContent = `0/${MAX_REPORT_NOTE_LENGTH}`;

        noteHeader.append(noteLabel, noteCounter);

        const noteInput = document.createElement("textarea");
        noteInput.id = noteId;
        noteInput.className = "port-report-note-input";
        noteInput.rows = 2;
        noteInput.maxLength = MAX_REPORT_NOTE_LENGTH;
        noteInput.placeholder = "Brief detail, e.g. leads to v1.0 APK";
        noteInput.setAttribute(
            "aria-label",
            `Short note (optional, max ${MAX_REPORT_NOTE_LENGTH} characters)`
        );

        noteField.append(noteHeader, noteInput);

        const submitReportBtn = document.createElement("button");
        submitReportBtn.type = "button";
        submitReportBtn.className = "port-rating-submit";
        submitReportBtn.textContent = "Submit report";
        submitReportBtn.disabled = true;

        const reportFeedback = document.createElement("p");
        reportFeedback.className = "port-rating-feedback";
        reportFeedback.textContent = "Choose a reason or add a short note.";

        const updateReportFormState = (preserveFeedback = false) => {
            const rawLen = noteInput.value.length;
            const trimmedNote = noteInput.value
                .replace(/\s+/g, " ")
                .trim();

            noteCounter.textContent = `${rawLen}/${MAX_REPORT_NOTE_LENGTH}`;
            noteCounter.classList.toggle(
                "is-near-limit",
                rawLen >= 65 && rawLen < MAX_REPORT_NOTE_LENGTH
            );
            noteCounter.classList.toggle(
                "is-at-limit",
                rawLen >= MAX_REPORT_NOTE_LENGTH
            );

            const canSubmit =
                !sendingReport &&
                (Boolean(selectedReason) || trimmedNote.length >= 3);
            submitReportBtn.disabled = !canSubmit;

            if (!preserveFeedback) {
                reportFeedback.className = "port-rating-feedback";
                if (selectedReason && trimmedNote) {
                    reportFeedback.textContent = `Selected: ${selectedReason} + note`;
                } else if (selectedReason) {
                    reportFeedback.textContent = `Selected: ${selectedReason}`;
                } else if (trimmedNote.length >= 3) {
                    reportFeedback.textContent = "Ready to send your note.";
                } else if (trimmedNote.length > 0) {
                    reportFeedback.textContent =
                        "Select a reason or write at least 3 chars.";
                } else {
                    reportFeedback.textContent =
                        "Choose a reason or add a short note.";
                }
            }
        };

        reportPopover.append(rTitle, rDesc);

        reasons.forEach((reason) => {
            const opt = document.createElement("button");
            opt.type = "button";
            opt.className = "port-rating-option";
            opt.textContent = reason;
            opt.addEventListener("click", () => {
                if (sendingReport) return;
                selectedReason = selectedReason === reason ? "" : reason;
                reasonButtons.forEach((b) =>
                    b.classList.toggle(
                        "selected",
                        Boolean(selectedReason) && b.textContent === selectedReason
                    )
                );
                updateReportFormState();
            });
            reasonButtons.push(opt);
            reportPopover.appendChild(opt);
        });

        noteInput.addEventListener("input", () => {
            if (/[\r\n]/.test(noteInput.value)) {
                const start = noteInput.selectionStart;
                noteInput.value = noteInput.value.replace(/[\r\n]+/g, " ");
                if (typeof start === "number") {
                    noteInput.setSelectionRange(start, start);
                }
            }
            if (noteInput.value.length > MAX_REPORT_NOTE_LENGTH) {
                noteInput.value = noteInput.value.slice(0, MAX_REPORT_NOTE_LENGTH);
            }
            updateReportFormState();
        });

        noteInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!submitReportBtn.disabled) {
                    submitReportBtn.click();
                }
            }
        });

        submitReportBtn.addEventListener("click", async () => {
            const noteText = noteInput.value
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, MAX_REPORT_NOTE_LENGTH);
            if (sendingReport || (!selectedReason && noteText.length < 3)) return;
            sendingReport = true;
            submitReportBtn.disabled = true;
            noteInput.disabled = true;
            reportFeedback.className = "port-rating-feedback";
            reportFeedback.textContent = "Sending report...";

            try {
                if (!compatibilityActions?.reportBrokenLink) {
                    throw new Error("Report service is unavailable.");
                }
                await compatibilityActions.reportBrokenLink({
                    portId: port.portId || port.project || port.game,
                    reason: selectedReason,
                    note: noteText,
                    url: portUrl,
                });
                reportFeedback.className = "port-rating-feedback success";
                reportFeedback.textContent = "Link reported, thanks!";
                reportBtn.textContent = "Reported";
                setTimeout(() => {
                    closePopoverGroup(reportTrigger);
                }, 900);
            } catch (err) {
                reportFeedback.className = "port-rating-feedback error";
                reportFeedback.textContent =
                    err.message || "Could not send report.";
                noteInput.disabled = false;
                sendingReport = false;
                updateReportFormState(true);
                return;
            }
            noteInput.disabled = false;
            sendingReport = false;
        });

        reportPopover.append(noteField, submitReportBtn, reportFeedback);

        reportBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            const willOpen = reportPopover.hidden;
            closeAllPopovers(reportTrigger);

            reportPopover.hidden = !willOpen;
            reportTrigger.classList.toggle("is-open", willOpen);
            reportBtn.setAttribute("aria-expanded", String(willOpen));
        });

        reportTrigger.append(reportBtn, reportPopover);
        linkRow.appendChild(reportTrigger);
        card.appendChild(linkRow);
    }

    const gamesList = !isNonUniqueProjectName(port.project)
        ? findGamesUsingApp(port.project, allRows).filter(
              (game) =>
                  normalizeText(game.name) !== normalizeText(currentGameName)
          )
        : [];
    if (gamesList.length > 0) {
        card.appendChild(
            createGamesUsingAppSection(
                "With this port you can also play:",
                gamesList
            )
        );
    }

    return card;
}

export function displayGame(
    game,
    allRows,
    ratings = {},
    ratingActions = null,
    compatibility = {},
    compatibilityActions = null
) {
    const gameHeader = document.getElementById("game-header");
    const portsHeader = document.getElementById("ports-header");
    const portList = document.getElementById("port-list");
    const statusElement = document.getElementById("game-status");

    if (!gameHeader || !portList || !statusElement) {
        console.error("Game page is missing a required element.");
        return;
    }

    initializeRatingPopoverEvents();

    const ratingsState = { ...(ratings || {}) };
    const compatibilityState = { ...(compatibility || {}) };

    displayGameSummary(game, gameHeader);

    const portCount = game.ports.length;
    statusElement.textContent = `${portCount} ${
        portCount === 1 ? "port" : "ports"
    }`;
    statusElement.classList.add("sr-only");

    if (portsHeader) {
        portsHeader.replaceChildren();
        portsHeader.hidden = false;

        const headingGroup = document.createElement("div");
        headingGroup.className = "ports-section-heading";

        const heading = document.createElement("h2");
        heading.className = "ports-section-title";
        heading.textContent =
            portCount === 1 ? "Available Port" : "Available Ports";

        const subtitle = document.createElement("p");
        subtitle.className = "ports-section-description";
        subtitle.textContent =
            portCount > 1
                ? `${portCount} native builds sorted by community score & recency`
                : portCount === 1
                ? "1 native Android build listed"
                : "No native Android ports listed yet";

        headingGroup.append(heading, subtitle);
        portsHeader.appendChild(headingGroup);
    }

    portList.replaceChildren();
    portList.classList.remove("has-spotlight-full");

    if (portCount === 0) {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "port-empty";
        emptyMessage.textContent =
            "No ports are currently listed for this game.";
        portList.appendChild(emptyMessage);
    } else {
        const sortedPorts = game.ports
            .map((port, originalIndex) => ({
                port,
                originalIndex,
                rating: ratingsState?.[port.portId] || {},
            }))
            .sort((a, b) => {
                const aVotes = Number(a.rating.votes) || 0;
                const bVotes = Number(b.rating.votes) || 0;
                const aHasVotes = aVotes > 0;
                const bHasVotes = bVotes > 0;

                if (aHasVotes !== bHasVotes) {
                    return aHasVotes ? -1 : 1;
                }

                if (aHasVotes && bHasVotes) {
                    const avgDiff =
                        (Number(b.rating.avg) || 0) -
                        (Number(a.rating.avg) || 0);
                    if (avgDiff !== 0) return avgDiff;
                }

                const aUpdated = parseLastUpdate(a.port.lastUpdate);
                const bUpdated = parseLastUpdate(b.port.lastUpdate);
                if (aUpdated !== bUpdated) return bUpdated - aUpdated;

                return a.originalIndex - b.originalIndex;
            });

        portList.classList.toggle(
            "has-spotlight-full",
            sortedPorts.length === 1 || sortedPorts.length >= 3
        );

        const developerCounts = getDeveloperGameCounts(allRows);

        sortedPorts.forEach(({ port, rating }, index) => {
            const isTopPort = index === 0 && sortedPorts.length > 1;
            const hasRating = (Number(rating?.votes) || 0) > 0;
            const spotlightLabel = isTopPort
                ? hasRating
                    ? "★ Top Rated Port"
                    : "Latest Port"
                : "";

            const portCard = displayPortCard(
                port,
                index,
                allRows,
                ratingsState,
                ratingActions,
                compatibilityState,
                compatibilityActions,
                {
                    isSpotlight: isTopPort,
                    spotlightLabel,
                    developerCounts,
                    currentGameName: game.name,
                }
            );
            portCard.style.setProperty(
                "--enter-index",
                String(Math.min(index, 8))
            );
            portCard.classList.add("is-entering");
            portCard.addEventListener(
                "animationend",
                () => portCard.classList.remove("is-entering"),
                { once: true }
            );
            portList.appendChild(portCard);
        });
    }

    if (isMultiGameApp(game)) {
        const gamesList = findGamesUsingApp(game.name, allRows);
        if (gamesList.length > 0) {
            const appSection = createGamesUsingAppSection(
                "Games using this app",
                gamesList
            );
            appSection.classList.add("games-using-app-full");
            portList.appendChild(appSection);
        }
    }
}
