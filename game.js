
/*
 * NAPL — GAME RENDER
 *
 * Displays game information and Android port cards.
 */

import {
    isMultiGameApp,
    isMultiGameAppPort,
    findGamesUsingApp
} from "./game-apps.js";


/*
 * TEXT HELPERS
 */

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


/*
 * URL VALIDATION
 *
 * Allow web links only.
 */

function safeWebUrl(value) {
    const input = String(value || "").trim();

    if (!input) {
        return "";
    }

    try {
        const url = new URL(input);

        if (
            url.protocol !== "https:" &&
            url.protocol !== "http:"
        ) {
            return "";
        }

        return url.href;
    } catch {
        return "";
    }
}


/*
 * STANDARD INFORMATION ROW
 */

function createInfoRow(label, value) {
    if (!value) {
        return null;
    }

    const row = document.createElement("div");
    row.className = "port-info-row";

    const labelElement = document.createElement("span");
    labelElement.className = "port-info-label";
    labelElement.textContent = label;

    const valueElement = document.createElement("span");
    valueElement.className = "port-info-value";
    valueElement.textContent = value;

    row.append(labelElement, valueElement);

    return row;
}


/*
 * INFORMATION ROW WITH A LINKED VALUE
 */

function createInfoRowWithLinkedValue(label, value, url) {
    if (!value) {
        return null;
    }

    const safeUrl = safeWebUrl(url);

    if (!safeUrl) {
        return createInfoRow(label, value);
    }

    const row = document.createElement("div");
    row.className = "port-info-row";

    const labelElement = document.createElement("span");
    labelElement.className = "port-info-label";
    labelElement.textContent = label;

    const valueElement = document.createElement("a");
    valueElement.className = "port-info-value";
    valueElement.href = safeUrl;
    valueElement.target = "_blank";
    valueElement.rel = "noopener noreferrer";
    valueElement.textContent = value;

    row.append(labelElement, valueElement);

    return row;
}


/*
 * GAME SUMMARY CARD
 *
 * Displays the cover, title, year, genre and description.
 */

function displayGameSummary(game, parentElement) {
    parentElement.replaceChildren();
    parentElement.className =
        "game-header game-summary-card";

    /*
     * Cover image.
     */

    const coverUrl = safeWebUrl(game.coverUrl);

    if (coverUrl) {
        const cover = document.createElement("img");

        cover.className = "game-summary-cover";
        cover.src = coverUrl;
        cover.alt = `${game.name} cover`;
        cover.loading = "eager";
        cover.decoding = "async";

        cover.addEventListener("error", () => {
            cover.remove();
        }, { once: true });

        parentElement.appendChild(cover);
    }

    /*
     * Game information.
     */

    const info = document.createElement("div");
    info.className = "game-summary-info";

    const title = document.createElement("h1");
    title.id = "game-title";
    title.className = "game-summary-title";
    title.textContent = game.name;

    info.appendChild(title);

    /*
     * Year and genre.
     */

    const metadata = document.createElement("div");
    metadata.className = "game-summary-metadata";

    if (game.year) {
        const year = document.createElement("span");

        year.id = "game-year";
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

    if (metadata.childElementCount > 0) {
        info.appendChild(metadata);
    }

    /*
     * Description.
     */

    if (game.description) {
        const description = document.createElement("p");

        description.className = "game-summary-description";
        description.textContent =
            restoreDescriptionLineBreaks(game.description);

        description.style.whiteSpace = "pre-line";

        info.appendChild(description);
    }

    parentElement.appendChild(info);
}


/*
 * GAMES THAT USE A MULTI-GAME APP
 */

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

    /*
     * Collapsible section header.
     */

    const toggle = document.createElement("button");

    toggle.type = "button";
    toggle.className = "games-using-app-toggle";
    toggle.setAttribute("aria-expanded", "false");

    const title = document.createElement("span");
    title.textContent = titleText;

    const arrow = document.createElement("span");
    arrow.className = "games-using-app-arrow";
    arrow.textContent = "▼";
    arrow.setAttribute("aria-hidden", "true");

    toggle.append(title, arrow);

    /*
     * Linked game list.
     */

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

    /*
     * Expand / collapse.
     */

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


/*
 * DISPLAY THE SELECTED GAME
 */

export function displayGame(game, allRows) {
    const gameHeader = document.getElementById("game-header");
    const portList = document.getElementById("port-list");
    const statusElement = document.getElementById("status");

    if (!gameHeader || !portList || !statusElement) {
        console.error("NAPL: required game page elements are missing.");
        return;
    }

    /*
     * Game summary.
     */

    displayGameSummary(game, gameHeader);

    /*
     * Port count.
     */

    const portCount = game.ports.length;

    statusElement.textContent =
        `${portCount} Android port${portCount !== 1 ? "s" : ""}`;

    portList.replaceChildren();

    /*
     * Render every port.
     */

    for (let index = 0; index < game.ports.length; index++) {
        const port = game.ports[index];

        const card = document.createElement("article");
        card.className = "port";

        /*
         * Port title.
         */

        const title = document.createElement("h2");
        title.className = "port-title";
        title.textContent = port.project || `Port ${index + 1}`;

        card.appendChild(title);

        /*
         * Port metadata.
         */

        const info = document.createElement("div");
        info.className = "port-info";

        const fields = [
            ["Developer", port.developer],
            ["Version", port.version],
            ["Supported Inputs", port.controller],
            ["Needs Game Files?", port.files],
            ["Works?", port.works],
            ["Last Update", port.lastUpdate]
        ];

        for (const [label, value] of fields) {
            let row;

            if (
                label === "Needs Game Files?" &&
                port.dataUrl
            ) {
                row = createInfoRowWithLinkedValue(
                    label,
                    value,
                    port.dataUrl
                );
            } else {
                row = createInfoRow(label, value);
            }

            if (row) {
                info.appendChild(row);
            }
        }

        if (info.childElementCount > 0) {
            card.appendChild(info);
        }

        /*
         * Notes.
         */

        if (port.notes) {
            const notes = document.createElement("div");
            notes.className = "port-notes";

            const notesTitle = document.createElement("strong");
            notesTitle.textContent = "Notes";

            const notesText = document.createElement("p");
            notesText.textContent = port.notes;

            notes.append(notesTitle, notesText);
            card.appendChild(notes);
        }

        /*
         * Port link.
         */

        const portUrl = safeWebUrl(port.url);

        if (portUrl) {
            const link = document.createElement("a");

            link.className = "port-link";
            link.href = portUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = port.link || "Open Port →";

            card.appendChild(link);
        }

        /*
         * Add card.
         */

        portList.appendChild(card);

        /*
         * Other games supported by this app.
         */

        if (isMultiGameAppPort(port, allRows)) {
            displayGamesUsingApp(
                port.project,
                allRows,
                "With this port you can also play:",
                card
            );
        }
    }

    /*
     * If the selected game is itself a Multi-game App,
     * show the games that use it.
     */

    if (isMultiGameApp(game)) {
        displayGamesUsingApp(
            game.name,
            allRows,
            "Games using this app",
            portList
        );
    }
}
