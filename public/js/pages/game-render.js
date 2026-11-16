/*
 * NAPL — GAME DETAIL RENDERER
 *
 * Renders game summary, port cards, multi-game app lists and ratings.
 * All rating styles live in assets/css/game.css (no CSS injected in JS).
 */

import { restoreDescriptionLineBreaks } from "../core/helpers.js";
import {
    isMultiGameApp,
    isMultiGameAppPort,
    findGamesUsingApp,
    createGamesUsingAppSection,
} from "../components/multi-game-apps.js";
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
} from "../services/compatibility.js";


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

function closeRatingPopover(container) {
    if (!container) return;

    const popover = container.querySelector(".port-rating-popover");
    const button = container.querySelector(".port-rating-button");
    const trigger = container.querySelector(".port-rating-trigger");

    if (popover) popover.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
    if (trigger) trigger.classList.remove("is-open");
}

function closeCompatibilityPopover(container) {
    if (!container) return;

    const popover = container.querySelector(".port-compat-popover");
    const button = container.querySelector(".port-compat-button");
    const trigger = container.querySelector(".port-compat-trigger");

    if (popover) popover.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
    if (trigger) trigger.classList.remove("is-open");
}

function closeReportLinkPopover(container) {
    if (!container) return;

    const popover = container.querySelector(".port-report-link-popover");
    const button = container.querySelector(".port-report-link-button");

    if (popover) popover.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
    container.classList.remove("is-open");
}

function initializeRatingPopoverEvents() {
    if (ratingPopoverEventsInitialized) return;
    ratingPopoverEventsInitialized = true;

    document.addEventListener("click", (event) => {
        const clickedRating = event.target.closest(".port-rating");
        document.querySelectorAll(".port-rating").forEach((container) => {
            if (container !== clickedRating) {
                closeRatingPopover(container);
            }
        });

        const clickedCompat = event.target.closest(".port-compat");
        document.querySelectorAll(".port-compat").forEach((container) => {
            if (container !== clickedCompat) {
                closeCompatibilityPopover(container);
            }
        });

        const clickedReportLink = event.target.closest(
            ".port-report-link-trigger"
        );
        document
            .querySelectorAll(".port-report-link-trigger")
            .forEach((container) => {
                if (container !== clickedReportLink) {
                    closeReportLinkPopover(container);
                }
            });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        document.querySelectorAll(".port-rating").forEach((container) => {
            closeRatingPopover(container);
        });
        document.querySelectorAll(".port-compat").forEach((container) => {
            closeCompatibilityPopover(container);
        });
        document
            .querySelectorAll(".port-report-link-trigger")
            .forEach((container) => {
                closeReportLinkPopover(container);
            });
    });
}

function createRatingStars(average) {
    const stars = document.createElement("span");
    stars.className = "port-rating-stars";
    stars.setAttribute("aria-label", `${average.toFixed(1)} out of 5`);

    for (let i = 1; i <= 5; i++) {
        const star = document.createElement("span");
        star.className = "port-rating-star";
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

    return stars;
}

function createPortRating(port, ratings, ratingActions, onRatingUpdated = null) {
    if (!port.portId) return null;

    const container = document.createElement("div");
    container.className = "port-rating";

    const summaryElement = document.createElement("div");
    summaryElement.className = "port-rating-summary";

    let currentRating = ratings?.[port.portId] || {};
    let starsElement = createRatingStars(Number(currentRating.avg) || 0);
    summaryElement.appendChild(starsElement);

    const averageElement = document.createElement("span");
    averageElement.className = "port-rating-average";

    const countElement = document.createElement("span");
    countElement.className = "port-rating-count";

    function updateRatingDisplay(rating) {
        currentRating = rating || {};
        const average = Number(currentRating.avg) || 0;
        const votes = Number(currentRating.votes) || 0;

        const newStars = createRatingStars(votes > 0 ? average : 0);
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

    function selectRating(score) {
        selectedRating = score;
        optionButtons.forEach((button, idx) => {
            button.classList.toggle("selected", idx + 1 === score);
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
        optionStars.textContent = "★".repeat(score);

        option.append(optionLabel, optionStars);
        option.addEventListener("click", () => {
            if (loadingVote || submitting) return;
            selectRating(score);
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
                updateRatingDisplay(result.rating);
                onRatingUpdated?.(port.portId, result.rating);
            }

            setFeedback("Your rating has been saved!", "success");
            rateButton.textContent = "Rated";
            submit.textContent = "Saved";

            setTimeout(() => {
                closeRatingPopover(container);
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

    rateButton.addEventListener("click", async (event) => {
        event.stopPropagation();

        if (!popover.hidden) {
            closeRatingPopover(container);
            return;
        }

        document.querySelectorAll(".port-rating").forEach((other) => {
            if (other !== container) {
                closeRatingPopover(other);
            }
        });

        popover.hidden = false;
        trigger.classList.add("is-open");
        rateButton.setAttribute("aria-expanded", "true");
        await loadPreviousVote();
    });

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
                closeCompatibilityPopover(container);
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
            closeCompatibilityPopover(container);
            return;
        }

        document.querySelectorAll(".port-compat").forEach((other) => {
            if (other !== container) closeCompatibilityPopover(other);
        });
        document.querySelectorAll(".port-rating").forEach((other) => {
            closeRatingPopover(other);
        });

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

    actionsGroup.append(toggleListButton, trigger);
    bar.append(summaryGroup, actionsGroup);
    container.append(bar, meter, listElement);

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

function createPortDetail(label, value, url = "") {
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
    const hasUrl =
        textValue !== "-" &&
        /^https?:\/\/\S+$/i.test(String(url || "").trim());
    const valueElement = hasUrl
        ? document.createElement("a")
        : document.createElement("div");

    valueElement.className = "port-detail-value";
    valueElement.textContent = textValue;

    if (hasUrl) {
        valueElement.href = url;
        valueElement.target = "_blank";
        valueElement.rel = "noopener noreferrer";
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

function displayGameSummary(game, parentElement) {
    parentElement.replaceChildren();
    parentElement.className = "game-header game-summary-card game-hero";

    const heroGrid = document.createElement("div");
    heroGrid.className = "game-summary-top";

    const media = document.createElement("div");
    media.className = "game-hero-media";

    const coverUrl = String(game.coverUrl || "").trim();
    if (/^https?:\/\/\S+$/i.test(coverUrl)) {
        const cover = document.createElement("img");
        cover.className = "game-summary-cover";
        cover.src = coverUrl;
        cover.alt = `${game.name} cover`;
        cover.loading = "eager";
        cover.decoding = "async";
        cover.referrerPolicy = "no-referrer";
        cover.addEventListener(
            "error",
            () => {
                cover.replaceWith(createCoverFallback(game.name));
            },
            { once: true }
        );
        media.appendChild(cover);
    } else {
        media.appendChild(createCoverFallback(game.name));
    }

    const headerInfo = document.createElement("div");
    headerInfo.className = "game-summary-info";

    const title = document.createElement("h1");
    title.id = "game-title";
    title.className = "game-summary-title";
    title.textContent = game.name;
    headerInfo.appendChild(title);

    const metadata = document.createElement("div");
    metadata.className = "game-summary-metadata";

    const metaParts = [];
    if (game.year) metaParts.push({ className: "game-summary-year", text: String(game.year) });
    if (game.genre) metaParts.push({ className: "game-summary-genre", text: String(game.genre) });

    metaParts.forEach((part, idx) => {
        if (idx > 0) {
            const sep = document.createElement("span");
            sep.className = "game-summary-meta-sep";
            sep.setAttribute("aria-hidden", "true");
            sep.textContent = "·";
            metadata.appendChild(sep);
        }
        const span = document.createElement("span");
        span.className = part.className;
        span.textContent = part.text;
        metadata.appendChild(span);
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
    parentElement.appendChild(heroGrid);
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
    const fields = [
        ["Port type", port.platform, ""],
        ["Developer", port.developer, ""],
        ["Version", port.version, ""],
        ["Last update", lastUpdateDisplay, ""],
        ["Supported inputs", supportedInputsValue, ""],
        ["Need game files?", port.files, port.dataUrl],
    ];

    for (const [label, value, url] of fields) {
        const detail = createPortDetail(label, value, url);
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

        let selectedReason = "";
        let sendingReport = false;
        const reasonButtons = [];

        const submitReportBtn = document.createElement("button");
        submitReportBtn.type = "button";
        submitReportBtn.className = "port-rating-submit";
        submitReportBtn.textContent = "Submit report";
        submitReportBtn.disabled = true;

        const reportFeedback = document.createElement("p");
        reportFeedback.className = "port-rating-feedback";
        reportFeedback.textContent = "Choose a reason above.";

        reportPopover.append(rTitle, rDesc);

        reasons.forEach((reason) => {
            const opt = document.createElement("button");
            opt.type = "button";
            opt.className = "port-rating-option";
            opt.textContent = reason;
            opt.addEventListener("click", () => {
                if (sendingReport) return;
                selectedReason = reason;
                reasonButtons.forEach((b) =>
                    b.classList.toggle("selected", b === opt)
                );
                submitReportBtn.disabled = false;
                reportFeedback.className = "port-rating-feedback";
                reportFeedback.textContent = `Selected: ${reason}`;
            });
            reasonButtons.push(opt);
            reportPopover.appendChild(opt);
        });

        submitReportBtn.addEventListener("click", async () => {
            if (!selectedReason || sendingReport) return;
            sendingReport = true;
            submitReportBtn.disabled = true;
            reportFeedback.className = "port-rating-feedback";
            reportFeedback.textContent = "Sending report...";

            try {
                if (!compatibilityActions?.reportBrokenLink) {
                    throw new Error("Report service is unavailable.");
                }
                await compatibilityActions.reportBrokenLink({
                    portId: port.portId || port.project || port.game,
                    reason: selectedReason,
                    url: portUrl,
                });
                reportFeedback.className = "port-rating-feedback success";
                reportFeedback.textContent = "Link reported, thanks!";
                reportBtn.textContent = "Reported";
                setTimeout(() => {
                    closeReportLinkPopover(reportTrigger);
                }, 900);
            } catch (err) {
                reportFeedback.className = "port-rating-feedback error";
                reportFeedback.textContent =
                    err.message || "Could not send report.";
                submitReportBtn.disabled = false;
            } finally {
                sendingReport = false;
            }
        });

        reportPopover.append(submitReportBtn, reportFeedback);

        reportBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            const willOpen = reportPopover.hidden;
            document
                .querySelectorAll(".port-report-link-trigger")
                .forEach((other) => {
                    if (other !== reportTrigger) closeReportLinkPopover(other);
                });
            document.querySelectorAll(".port-rating").forEach((other) => {
                closeRatingPopover(other);
            });
            document.querySelectorAll(".port-compat").forEach((other) => {
                closeCompatibilityPopover(other);
            });

            reportPopover.hidden = !willOpen;
            reportTrigger.classList.toggle("is-open", willOpen);
            reportBtn.setAttribute("aria-expanded", String(willOpen));
        });

        reportTrigger.append(reportBtn, reportPopover);
        linkRow.appendChild(reportTrigger);
        card.appendChild(linkRow);
    }

    if (isMultiGameAppPort(port, allRows)) {
        const gamesList = findGamesUsingApp(port.project, allRows);
        if (gamesList.length > 0) {
            card.appendChild(
                createGamesUsingAppSection(
                    "With this port you can also play:",
                    gamesList
                )
            );
        }
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
    const statusElement = document.getElementById("status");

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

        sortedPorts.forEach(({ port, rating }, index) => {
            const isTopPort = index === 0 && sortedPorts.length > 1;
            const hasRating = (Number(rating?.votes) || 0) > 0;
            const spotlightLabel = isTopPort
                ? hasRating
                    ? "★ Top Rated Port"
                    : "Latest Port"
                : "";

            portList.appendChild(
                displayPortCard(
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
                    }
                )
            );
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
