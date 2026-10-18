
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

/*
 * NAPL — LOAD SELECTED GAME
 *
 * Loads the spreadsheet, groups the ports by game
 * and renders the game selected in the URL.
 */

const GAME_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";


function normalizeGameHeader(value) {
    return String(value || "")
        .replace(/^\uFEFF/, "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


function parseGameCSV(csv) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];

        if (char === '"') {
            if (quoted && csv[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                quoted = !quoted;
            }

            continue;
        }

        if (char === "," && !quoted) {
            row.push(field);
            field = "";
            continue;
        }

        if (
            (char === "\n" || char === "\r") &&
            !quoted
        ) {
            if (char === "\r" && csv[i + 1] === "\n") {
                i++;
            }

            row.push(field);

            if (row.some(value => value.trim() !== "")) {
                rows.push(row);
            }

            row = [];
            field = "";
            continue;
        }

        field += char;
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);

        if (row.some(value => value.trim() !== "")) {
            rows.push(row);
        }
    }

    if (rows.length < 2) {
        return [];
    }

    const headers = rows.shift().map(normalizeGameHeader);

    return rows.map(values => {
        const result = {};

        headers.forEach((header, index) => {
            if (header) {
                result[header] = String(values[index] || "").trim();
            }
        });

        return result;
    });
}


function getGameColumn(row, aliases) {
    for (const alias of aliases) {
        const key = normalizeGameHeader(alias);

        if (Object.prototype.hasOwnProperty.call(row, key)) {
            return row[key] || "";
        }
    }

    return "";
}


function groupGameRows(rows) {
    const grouped = new Map();

    let currentGame = "";
    let currentYear = "";

    for (const row of rows) {
        const gameValue = getGameColumn(row, [
            "GAME",
            "GAME NAME",
            "NAME",
            "JUEGO"
        ]);

        const yearValue = getGameColumn(row, [
            "YEAR",
            "AÑO",
            "ANO"
        ]);

        if (gameValue) {
            currentGame = gameValue;
        }

        if (yearValue) {
            currentYear = yearValue;
        }

        if (!currentGame) {
            continue;
        }

        const platform = getGameColumn(row, [
            "PLATFORM",
            "PLATAFORM",
            "PLATAFORMA"
        ]);

        const project = getGameColumn(row, [
            "PROJECT",
            "PROYECTO"
        ]);

        const link = getGameColumn(row, [
            "LINK",
            "PROJECT LINK",
            "ENLACE"
        ]);

        const url = getGameColumn(row, [
            "URL",
            "PORT URL",
            "PORT LINK"
        ]);

        const dataUrl = getGameColumn(row, [
            "DATA URL",
            "DATA LINK",
            "GAME FILES URL"
        ]);

        const developer = getGameColumn(row, [
            "DEVELOPER",
            "DEVELOPER/PUBLISHER",
            "DESARROLLADOR"
        ]);

        const version = getGameColumn(row, [
            "VERSION",
            "VERSIÓN"
        ]);

        const controller = getGameColumn(row, [
            "CONTROLLER SUPPORT",
            "CONTROLLER",
            "GAMEPAD",
            "MANDO"
        ]);

        const files = getGameColumn(row, [
            "NEEDS GAME FILES?",
            "NEEDS GAME FILES",
            "GAME FILES",
            "NECESITA ARCHIVOS"
        ]);

        const works = getGameColumn(row, [
            "WORKS?",
            "WORKS",
            "FUNCIONA"
        ]);

        const lastUpdate = getGameColumn(row, [
            "LAST UPDATE",
            "LAST UPDATED",
            "ÚLTIMA ACTUALIZACIÓN"
        ]);

        const notes = getGameColumn(row, [
            "NOTES",
            "NOTE",
            "NOTAS"
        ]);

        const coverUrl = getGameColumn(row, [
            "COVER URL",
            "COVER",
            "COVER IMAGE",
            "IMAGE URL",
            "PORTADA"
        ]);

        const genre = getGameColumn(row, [
            "GENRE",
            "GÉNERO",
            "GENERO"
        ]);

        const description = getGameColumn(row, [
            "DESCRIPTION",
            "DESCRIPCIÓN",
            "DESCRIPCION"
        ]);

        const hasPortData = [
            project,
            link,
            url,
            dataUrl,
            developer,
            version,
            controller,
            files,
            works,
            lastUpdate,
            notes
        ].some(value => String(value || "").trim() !== "");

        if (!hasPortData) {
            continue;
        }

        const key = createSlug(currentGame);

        if (!key) {
            continue;
        }

        if (!grouped.has(key)) {
            grouped.set(key, {
                name: currentGame,
                slug: key,
                year: currentYear,
                genre,
                description,
                coverUrl,
                ports: [],
                platforms: []
            });
        }

        const game = grouped.get(key);

        if (!game.year && currentYear) {
            game.year = currentYear;
        }

        if (!game.genre && genre) {
            game.genre = genre;
        }

        if (!game.description && description) {
            game.description = description;
        }

        if (!game.coverUrl && coverUrl) {
            game.coverUrl = coverUrl;
        }

        if (platform && !game.platforms.includes(platform)) {
            game.platforms.push(platform);
        }

        game.ports.push({
            game: currentGame,
            year: currentYear,
            platform,
            project,
            link,
            url,
            dataUrl,
            developer,
            version,
            controller,
            files,
            works,
            lastUpdate,
            notes
        });
    }

    return Array.from(grouped.values());
}


async function loadSelectedGame() {
    const gameHeader = document.getElementById("game-header");
    const portList = document.getElementById("port-list");
    const status = document.getElementById("status");

    if (!gameHeader || !portList || !status) {
        console.error(
            "NAPL: game page elements are missing."
        );
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const requestedSlug = params.get("game");

    if (!requestedSlug) {
        gameHeader.textContent = "No game selected.";
        status.textContent = "Return to the list and select a game.";
        portList.replaceChildren();
        return;
    }

    status.textContent = "Loading ports...";
    portList.replaceChildren();

    try {
        const response = await fetch(GAME_SHEET_URL, {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(
                `The spreadsheet returned HTTP ${response.status}.`
            );
        }

        const csv = await response.text();

        if (!csv.trim()) {
            throw new Error("The spreadsheet returned no data.");
        }

        const rows = parseGameCSV(csv);

        if (rows.length === 0) {
            throw new Error(
                "No valid rows were found in the spreadsheet."
            );
        }

        const games = groupGameRows(rows);

        const game = games.find(
            item => item.slug === createSlug(requestedSlug)
        );

        if (!game) {
            gameHeader.textContent = "Game not found.";
            status.textContent =
                "This game could not be found in the spreadsheet.";
            portList.replaceChildren();

            console.error(
                "NAPL: game slug not found:",
                requestedSlug
            );

            return;
        }

        document.title = `${game.name} — NAPL`;

        displayGame(game, rows.map(row => ({
            game: getGameColumn(row, [
                "GAME",
                "GAME NAME",
                "NAME",
                "JUEGO"
            ]),
            year: getGameColumn(row, ["YEAR", "AÑO", "ANO"]),
            platform: getGameColumn(row, [
                "PLATFORM",
                "PLATAFORM",
                "PLATAFORMA"
            ]),
            project: getGameColumn(row, [
                "PROJECT",
                "PROYECTO"
            ])
        })));

    } catch (error) {
        console.error("NAPL: could not load selected game.", error);

        gameHeader.textContent = "Could not load this game.";
        status.textContent =
            error instanceof Error
                ? error.message
                : "An unexpected error occurred.";

        portList.replaceChildren();
    }
}


/*
 * START GAME PAGE
 */

loadSelectedGame();
