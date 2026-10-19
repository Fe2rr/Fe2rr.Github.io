
/*
 * NAPL — GAME RENDER
 *
 * Renders game information and Android port cards.
 * Preserves existing navigation, links, notes,
 * expandable descriptions and Multi-Game App support.
 */

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
   PORT INFORMATION
   ================================================== */

/*
 * Creates a detail field.
 * When url is supplied, the value remains clickable.
 */
function createPortDetail(label, value, url = "") {
    if (!String(value || "").trim()) {
        return null;
    }

    const detail = document.createElement("div");
    detail.className = "port-detail";

    const labelElement = document.createElement("span");
    labelElement.className = "port-detail-label";
    labelElement.textContent = label;

    const valueElement = url
        ? document.createElement("a")
        : document.createElement("div");

    valueElement.className = "port-detail-value";
    valueElement.textContent = value;

    if (url) {
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
    container.className = "game-summary-description-container";

    const text = document.createElement("p");
    text.className = "game-summary-description";
    text.textContent = restoreDescriptionLineBreaks(description);

    const collapsedStyles = {
        display: "-webkit-box",
        overflow: "hidden",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: "4"
    };

    Object.assign(text.style, collapsedStyles);
    container.appendChild(text);

    requestAnimationFrame(() => {
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


/* ==================================================
   GAME SUMMARY
   ================================================== */

function displayGameSummary(game, parentElement) {
    parentElement.replaceChildren();
    parentElement.className =
        "game-header game-summary-card";

    const coverUrl = String(game.coverUrl || "").trim();

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
    eyebrow.textContent = "Featured port";

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

    const android = document.createElement("span");
    android.className = "game-summary-genre";
    android.textContent = "Android";
    metadata.appendChild(android);

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

    if (gamesUsingApp.length === 0) {
        return;
    }

    const section = document.createElement("section");
    section.className = "games-using-app";

    const toggle = document.createElement("button");

    toggle.type = "button";
    toggle.className = "games-using-app-toggle";
    toggle.setAttribute("aria-expanded", "false");

    const title = document.createElement("span");
    title.textContent = titleText;

    const arrow = document.createElement("span");
    arrow.className = "games-using-app-arrow";
    arrow.textContent = "▼";

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

function displayPortCard(port, index, allRows) {
    const card = document.createElement("article");
    card.className = "port port-card";

    /* Port heading */

    const top = document.createElement("div");
    top.className = "port-top";

    const title = document.createElement("h3");
    title.className = "port-title";
    title.textContent = port.project || `Port ${index + 1}`;

    top.appendChild(title);
    card.appendChild(top);

    /* Port details */

    const details = document.createElement("div");
    details.className = "port-details";

    const fields = [
        ["Version", port.version, ""],
        ["Developer", port.developer, ""],
        [
            "Need files?",
            port.files,
            port.dataUrl
        ],
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
        label.textContent = "Notes";

        const text = document.createElement("p");
        text.className = "port-notes-text";
        text.textContent = port.notes;

        notes.append(label, text);
        card.appendChild(notes);
    }

    /* Download / port link */

    if (port.url) {
        const link = document.createElement("a");

        link.className = "port-link";
        link.href = port.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = port.link || "Download / View Port";

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

export function displayGame(game, allRows) {
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

    /* Game information */

    displayGameSummary(game, gameHeader);

    /* Port count */

    statusElement.textContent =
        `${game.ports.length} port${
            game.ports.length !== 1 ? "s" : ""
        }`;

    portList.replaceChildren();

    /* Render every port */

    for (let index = 0; index < game.ports.length; index++) {
        const port = game.ports[index];

        portList.appendChild(
            displayPortCard(port, index, allRows)
        );
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
