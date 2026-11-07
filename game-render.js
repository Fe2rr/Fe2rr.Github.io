
/*
 * NAPL — GAME RENDER
 *
 * Renders game information and Android port cards.
 * Displays real ratings loaded from the Cloudflare Worker.
 *
 * Preserves existing navigation, links, notes,
 * expandable descriptions and Multi-Game App support.
 */


/* ==================================================
   IMPORTS
   ================================================== */

import {
    isMultiGameApp,
    isMultiGameAppPort,
    findGamesUsingApp
} from "./game-apps.js";


/* ==================================================
   TEXT HELPERS
   ================================================== */

function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


function createSlug(name) {
    return normalizeText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


function restoreDescriptionLineBreaks(description) {
    return String(description || "")
        .replace(/\s*\|\|\|\s*/g, "\n")
        .trim();
}


/* ==================================================
   RATING STYLES
   ================================================== */

function injectRatingStyles() {
    if (document.getElementById("napl-rating-styles")) {
        return;
    }

    const style = document.createElement("style");

    style.id = "napl-rating-styles";

    style.textContent = `
        .port-rating {
            position: relative;
            display: flex;
            align-items: center;
            gap: 7px;
            margin-left: auto;
            flex-shrink: 0;
        }

        .port-rating-stars {
            display: inline-flex;
            color: #e5ad42;
            font-size: 17px;
            letter-spacing: 0;
            white-space: nowrap;
        }

        .port-rating-star {
            position: relative;
            display: inline-block;
            color: #53665f;
        }

        .port-rating-star-fill {
            position: absolute;
            inset: 0 auto 0 0;
            overflow: hidden;
            color: #e5ad42;
            white-space: nowrap;
        }

        .port-rating-average {
            font-size: 13px;
            font-weight: 700;
            white-space: nowrap;
        }

        .port-rating-count {
            color: #9eb7ad;
            font-size: 11px;
            white-space: nowrap;
        }

        .port-rating-button {
            border: 1px solid #438372;
            background: #17483f;
            color: #effaf5;
            border-radius: 7px;
            padding: 6px 10px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
        }

        .port-rating-button:hover {
            background: #216052;
        }

        .port-rating-popover {
            position: absolute;
            z-index: 20;
            top: calc(100% + 10px);
            right: 0;
            width: 260px;
            max-width: min(260px, calc(100vw - 40px));
            padding: 13px;
            background: #12352f;
            border: 1px solid #438372;
            border-radius: 10px;
            box-shadow: 0 12px 30px #0009;
        }

        .port-rating-popover[hidden] {
            display: none;
        }

        .port-rating-popover::before {
            content: "";
            position: absolute;
            top: -6px;
            right: 25px;
            width: 10px;
            height: 10px;
            transform: rotate(45deg);
            background: #12352f;
            border-left: 1px solid #438372;
            border-top: 1px solid #438372;
        }

        .port-rating-popover-title {
            margin: 0 0 4px;
            color: #edf5f0;
            font-size: 14px;
            font-weight: 700;
        }

        .port-rating-popover-description {
            margin: 0 0 10px;
            color: #a8c0b6;
            font-size: 11px;
        }

        .port-rating-option {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            margin-top: 6px;
            padding: 9px 10px;
            border: 1px solid #2c6255;
            border-radius: 7px;
            background: #194239;
            color: #edf5f0;
            font-size: 12px;
            text-align: left;
            cursor: pointer;
        }

        .port-rating-option:hover,
        .port-rating-option.selected {
            border-color: #e5ad42;
            background: #285044;
        }

        .port-rating-option-stars {
            color: #e5ad42;
            letter-spacing: 1px;
        }

        .port-rating-submit {
            display: block;
            width: 100%;
            margin-top: 11px;
            padding: 9px;
            border: 1px solid #438f78;
            border-radius: 7px;
            background: #286b59;
            color: white;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
        }

        .port-rating-submit:disabled {
            opacity: .5;
            cursor: not-allowed;
        }

        .port-rating-feedback {
            margin: 9px 0 0;
            color: #a8c0b6;
            font-size: 11px;
        }

        @media (max-width: 480px) {
            .port-rating {
                gap: 5px;
            }

            .port-rating-stars {
                font-size: 14px;
            }

            .port-rating-average {
                font-size: 12px;
            }

            .port-rating-count {
                font-size: 10px;
            }

            .port-rating-button {
                padding: 5px 8px;
            }

            .port-rating-popover {
                right: 0;
                width: 250px;
            }
        }
    `;

    document.head.appendChild(style);
}


/* ==================================================
   RATING STARS
   ================================================== */

function createRatingStars(average) {
    const stars = document.createElement("span");

    stars.className = "port-rating-stars";

    stars.setAttribute(
        "aria-label",
        `${average.toFixed(1)} out of 5`
    );

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


/* ==================================================
   FLOATING RATING POPOVER
   ================================================== */

function createPortRating(port, ratings) {
    // Ports without an ID cannot receive individual ratings.
    if (!port.portId) {
        return null;
    }

    const container = document.createElement("div");

    container.className = "port-rating";

    /*
     * Retrieve the real rating using PORTS_ID.
     * The API returns avg, votes and score.
     *
     * The displayed rating uses avg, not score.
     * score is reserved for future ranking features.
     */

    const rating = ratings?.[port.portId] || {};

    const average = Number(rating.avg) || 0;
    const voteCount = Number(rating.votes) || 0;

    container.appendChild(
        createRatingStars(
            voteCount > 0 ? average : 0
        )
    );

    /* Average */

    const averageElement = document.createElement("span");

    averageElement.className = "port-rating-average";

    averageElement.textContent = voteCount > 0
        ? average.toFixed(1)
        : "—";

    container.appendChild(averageElement);

    /* Vote count */

    const count = document.createElement("span");

    count.className = "port-rating-count";
    count.textContent = `(${voteCount})`;

    count.title = `${voteCount} ${voteCount === 1 ? "vote" : "votes"}`;

    container.appendChild(count);

    /* Rate button */

    const rateButton = document.createElement("button");

    rateButton.type = "button";
    rateButton.className = "port-rating-button";
    rateButton.textContent = "Rate";
    rateButton.setAttribute("aria-expanded", "false");

    /* Floating popover */

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

    /* Rating options */

    const options = [
        "AI Slop",
        "Just emulate it bro",
        "Decent",
        "Good Port",
        "Gem"
    ];

    let selectedRating = 0;

    const optionButtons = [];

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
            selectedRating = score;

            optionButtons.forEach(button => {
                button.classList.toggle(
                    "selected",
                    button === option
                );
            });

            submit.disabled = false;

            feedback.textContent = `Selected: ${label}`;
        });

        optionButtons.push(option);

        popover.appendChild(option);
    });

    /* Submit button */

    const submit = document.createElement("button");

    submit.type = "button";
    submit.className = "port-rating-submit";
    submit.textContent = "Submit vote";
    submit.disabled = true;

    const feedback = document.createElement("p");

    feedback.className = "port-rating-feedback";
    feedback.textContent = "Select one of the five options.";

    submit.addEventListener("click", () => {
        if (!selectedRating) {
            return;
        }

        /*
         * Vote submission will be connected
         * to the Cloudflare Worker API
         * in the next implementation step.
         */

        feedback.textContent =
            `Selected rating: ${selectedRating}/5.`;

        popover.hidden = true;

        rateButton.setAttribute(
            "aria-expanded",
            "false"
        );
    });

    popover.append(submit, feedback);

    /* Open and close popover */

    rateButton.addEventListener("click", event => {
        event.stopPropagation();

        const opening = popover.hidden;

        // Close all other rating popovers.
        document.querySelectorAll(".port-rating-popover")
            .forEach(element => {
                element.hidden = true;
            });

        document.querySelectorAll(".port-rating-button")
            .forEach(element => {
                element.setAttribute(
                    "aria-expanded",
                    "false"
                );
            });

        popover.hidden = !opening;

        rateButton.setAttribute(
            "aria-expanded",
            String(opening)
        );
    });

    /* Close when clicking outside */

    document.addEventListener("click", event => {
        if (!container.contains(event.target)) {
            popover.hidden = true;

            rateButton.setAttribute(
                "aria-expanded",
                "false"
            );
        }
    });

    /* Close with Escape */

    container.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            popover.hidden = true;

            rateButton.setAttribute(
                "aria-expanded",
                "false"
            );

            rateButton.focus();
        }
    });

    container.append(rateButton, popover);

    return container;
}


/* ==================================================
   PORT INFORMATION
   ================================================== */

function createPortDetail(label, value, url = "") {
    if (!String(value || "").trim()) {
        return null;
    }

    const detail = document.createElement("div");

    detail.className = "port-detail";

    const labelElement = document.createElement("span");

    labelElement.className = "port-detail-label";
    labelElement.textContent = label;

    const hasUrl = /^https?:\/\/\S+$/i.test(
        String(url || "").trim()
    );

    const valueElement = hasUrl
        ? document.createElement("a")
        : document.createElement("div");

    valueElement.className = "port-detail-value";
    valueElement.textContent = value;

    if (hasUrl) {
        valueElement.href = url;
        valueElement.target = "_blank";
        valueElement.rel = "noopener noreferrer";
    }

    detail.append(labelElement, valueElement);

    return detail;
}


/* ==================================================
   EXPANDABLE GAME DESCRIPTION
   ================================================== */

function createExpandableDescription(description) {
    const container = document.createElement("div");

    container.className =
        "game-summary-description-container";

    const text = document.createElement("p");

    text.className = "game-summary-description";

    text.textContent =
        restoreDescriptionLineBreaks(description);

    const collapsedStyles = {
        display: "-webkit-box",
        overflow: "hidden",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: "4"
    };

    Object.assign(text.style, collapsedStyles);

    container.appendChild(text);

    requestAnimationFrame(() => {
        if (!text.isConnected) {
            return;
        }

        const isLong =
            text.scrollHeight > text.clientHeight + 1;

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
            const expanded =
                button.getAttribute("aria-expanded") === "true";

            if (expanded) {
                Object.assign(text.style, collapsedStyles);

                button.textContent = "Show more";

                button.setAttribute(
                    "aria-expanded",
                    "false"
                );
            } else {
                text.style.display = "block";
                text.style.overflow = "visible";
                text.style.webkitLineClamp = "unset";
                text.style.webkitBoxOrient = "initial";

                button.textContent = "Show less";

                button.setAttribute(
                    "aria-expanded",
                    "true"
                );
            }
        });

        container.appendChild(button);
    });

    return container;
}


/* ==================================================
   GAME SUMMARY
   ================================================== */

function displayGameSummary(game, parentElement) {
    parentElement.replaceChildren();

    parentElement.className =
        "game-header game-summary-card";

    const coverUrl = String(
        game.coverUrl || ""
    ).trim();

    if (/^https?:\/\/\S+$/i.test(coverUrl)) {
        const cover = document.createElement("img");

        cover.className = "game-summary-cover";
        cover.src = coverUrl;
        cover.alt = `${game.name} cover`;
        cover.loading = "eager";
        cover.decoding = "async";

        cover.addEventListener(
            "error",
            () => cover.remove(),
            { once: true }
        );

        parentElement.appendChild(cover);
    }

    const info = document.createElement("div");

    info.className = "game-summary-info";

    const eyebrow = document.createElement("div");

    eyebrow.className = "game-summary-eyebrow";
    eyebrow.textContent = "ANDROID GAME";

    const title = document.createElement("h1");

    title.id = "game-title";
    title.className = "game-summary-title";
    title.textContent = game.name;

    info.append(eyebrow, title);

    const metadata = document.createElement("div");

    metadata.className = "game-summary-metadata";

    if (game.year) {
        const year = document.createElement("span");

        year.className = "game-summary-year";
        year.textContent = game.year;

        metadata.appendChild(year);
    }

    if (game.genre) {
        const genre = document.createElement("span");

        genre.className = "game-summary-genre";
        genre.textContent = game.genre;

        metadata.appendChild(genre);
    }

    const platform = document.createElement("span");

    platform.className = "game-summary-genre";
    platform.textContent = "Android";

    metadata.appendChild(platform);

    info.appendChild(metadata);

    if (game.description) {
        info.appendChild(
            createExpandableDescription(game.description)
        );
    }

    parentElement.appendChild(info);
}


/* ==================================================
   MULTI-GAME APP SUPPORT
   ================================================== */

function displayGamesUsingApp(
    appName,
    allRows,
    titleText,
    parentElement
) {
    const gamesUsingApp = findGamesUsingApp(
        appName,
        allRows
    );

    if (!gamesUsingApp.length) {
        return;
    }

    const section = document.createElement("section");

    section.className = "games-using-app";

    const toggle = document.createElement("button");

    toggle.type = "button";
    toggle.className = "games-using-app-toggle";

    toggle.setAttribute(
        "aria-expanded",
        "false"
    );

    const title = document.createElement("span");

    title.textContent = titleText;

    const arrow = document.createElement("span");

    arrow.className = "games-using-app-arrow";
    arrow.textContent = "▼";

    arrow.setAttribute("aria-hidden", "true");

    toggle.append(title, arrow);

    const list = document.createElement("div");

    list.className = "games-using-app-list";
    list.hidden = true;

    for (const game of gamesUsingApp) {
        const link = document.createElement("a");

        link.className = "games-using-app-item";

        link.href =
            `game.html?game=${encodeURIComponent(
                createSlug(game.name)
            )}`;

        link.textContent = game.name;

        if (game.year) {
            const year = document.createElement("span");

            year.textContent = ` (${game.year})`;

            link.appendChild(year);
        }

        list.appendChild(link);
    }

    toggle.addEventListener("click", () => {
        const isOpen =
            toggle.getAttribute("aria-expanded") === "true";

        toggle.setAttribute(
            "aria-expanded",
            String(!isOpen)
        );

        list.hidden = isOpen;

        arrow.textContent = isOpen ? "▼" : "▲";
    });

    section.append(toggle, list);

    parentElement.appendChild(section);
}


/* ==================================================
   PORT CARD
   ================================================== */

function displayPortCard(port, index, allRows, ratings) {
    const card = document.createElement("article");

    card.className = "port port-card";

    /* Port heading */

    const top = document.createElement("div");

    top.className = "port-top";

    const title = document.createElement("h3");

    title.className = "port-title";

    title.textContent =
        port.project || `Port ${index + 1}`;

    top.appendChild(title);

    // Ratings appear only on individual port cards.
    const rating = createPortRating(port, ratings);

    if (rating) {
        top.appendChild(rating);
    }

    card.appendChild(top);

    /* Port details */

    const details = document.createElement("div");

    details.className = "port-details";

    const fields = [
        ["Version", port.version, ""],
        ["Developer", port.developer, ""],
        ["Need files?", port.files, port.dataUrl],
        ["Port type", port.platform, ""],
        ["Supported inputs", port.controller, ""],
        ["Works?", port.works, ""],
        ["Last update", port.lastUpdate, ""]
    ];

    for (const [label, value, url] of fields) {
        const detail = createPortDetail(
            label,
            value,
            url
        );

        if (detail) {
            details.appendChild(detail);
        }
    }

    if (details.childElementCount > 0) {
        card.appendChild(details);
    }

    /* Notes */

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

    /* Port link */

    const portUrl = String(
        port.url || ""
    ).trim();

    if (/^https?:\/\/\S+$/i.test(portUrl)) {
        const link = document.createElement("a");

        link.className = "port-link";
        link.href = portUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        link.textContent =
            port.link || "Download / View Port";

        const arrow = document.createElement("span");

        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "↗";

        link.appendChild(arrow);

        card.appendChild(link);
    }

    /* Multi-game app information */

    if (isMultiGameAppPort(port, allRows)) {
        displayGamesUsingApp(
            port.project,
            allRows,
            "With this port you can also play:",
            card
        );
    }

    return card;
}


/* ==================================================
   DISPLAY SELECTED GAME
   ================================================== */

export function displayGame(game, allRows, ratings = {}) {
    const gameHeader =
        document.getElementById("game-header");

    const portList =
        document.getElementById("port-list");

    const statusElement =
        document.getElementById("status");

    if (!gameHeader || !portList || !statusElement) {
        console.error(
            "Game page is missing a required element.",
            {
                gameHeader: Boolean(gameHeader),
                portList: Boolean(portList),
                statusElement: Boolean(statusElement)
            }
        );

        return;
    }

    /* Inject rating styles once */

    injectRatingStyles();

    /* Game information */

    displayGameSummary(game, gameHeader);

    /* Port count */

    const portCount = game.ports.length;

    statusElement.textContent =
        `${portCount} ${portCount === 1 ? "port" : "ports"}`;

    /* Render ports */

    portList.replaceChildren();

    if (portCount === 0) {
        const emptyMessage = document.createElement("p");

        emptyMessage.className = "port-empty";

        emptyMessage.textContent =
            "No ports are currently listed for this game.";

        portList.appendChild(emptyMessage);
    } else {
        game.ports.forEach((port, index) => {
            portList.appendChild(
                displayPortCard(
                    port,
                    index,
                    allRows,
                    ratings
                )
            );
        });
    }

    /* Games using this Multi-Game App */

    if (isMultiGameApp(game)) {
        displayGamesUsingApp(
            game.name,
            allRows,
            "Games using this app",
            portList
        );
    }
}
