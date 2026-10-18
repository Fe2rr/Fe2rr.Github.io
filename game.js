
/*
 * NAPL — GAME MODULE
 *
 * Loads game data from Google Sheets,
 * processes the CSV and coordinates rendering.
 */

import { displayGame } from "./game-render.js";


/*
 * GOOGLE SHEETS
 */

const SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";


/*
 * VISIT COUNTER
 */

const VISITS_URL =
    "https://script.google.com/macros/s/AKfycbxio6DGpBJRkYdceeFVXk3gSOFcBe5KZJtHU8F2j66DDYx_G_az01p7rnsuCq0KPHY/exec";


/*
 * PAGE ELEMENTS
 */

const gameTitle = document.getElementById("game-title");
const gameYear = document.getElementById("game-year");
const portList = document.getElementById("port-list");
const statusElement = document.getElementById("status");


/*
 * NORMALIZE HEADERS
 */

function normalizeHeader(value) {
    return String(value || "")
        .replace(/^\uFEFF/, "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/*
 * NORMALIZE TEXT
 */

function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/*
 * CREATE GAME SLUG
 */

function createSlug(name) {
    return normalizeText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


/*
 * REGISTER GAME VISIT
 */

function registerVisit(gameSlug) {
    if (!gameSlug) {
        return;
    }

    const url =
        `${VISITS_URL}?game=${encodeURIComponent(gameSlug)}`;

    fetch(url, {
        method: "GET",
        mode: "no-cors",
        keepalive: true
    }).catch(error => {
        console.error(
            "Could not register game visit:",
            error
        );
    });
}


/*
 * CSV PARSER
 */

function parseCSV(csv) {
    const rows = [];

    let row = [];
    let field = "";
    let insideQuotes = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];

        if (char === '"') {
            if (
                insideQuotes &&
                csv[i + 1] === '"'
            ) {
                field += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }

            continue;
        }

        if (char === "," && !insideQuotes) {
            row.push(field);
            field = "";
            continue;
        }

        if (
            (char === "\n" || char === "\r") &&
            !insideQuotes
        ) {
            if (
                char === "\r" &&
                csv[i + 1] === "\n"
            ) {
                i++;
            }

            row.push(field);
            field = "";

            if (row.some(value => value.trim() !== "")) {
                rows.push(row);
            }

            row = [];
            continue;
        }

        field += char;
    }

    // Add the final field and row.
    if (field.length > 0 || row.length > 0) {
        row.push(field);

        if (row.some(value => value.trim() !== "")) {
            rows.push(row);
        }
    }

    if (rows.length === 0) {
        return [];
    }

    const headers = rows.shift().map(normalizeHeader);

    return rows.map(values => {
        const rowObject = {};

        headers.forEach((header, index) => {
            rowObject[header] = (values[index] || "").trim();
        });

        return rowObject;
    });
}


/*
 * FIND A COLUMN BY POSSIBLE HEADER NAMES
 */

function getColumn(row, possibleNames) {
    for (const name of possibleNames) {
        const key = normalizeHeader(name);

        if (
            Object.prototype.hasOwnProperty.call(row, key)
        ) {
            return row[key];
        }
    }

    return "";
}


/*
 * PROCESS SPREADSHEET ROWS
 *
 * Game metadata can be stored on a separate row.
 * Empty metadata cells inherit the latest value
 * for the current game.
 */

function processRows(rows) {
    let currentGame = "";
    let currentYear = "";
    let currentGenre = "";
    let currentCoverUrl = "";
    let currentDescription = "";

    const result = [];

    for (const row of rows) {
        const gameValue = getColumn(row, [
            "GAME",
            "GAME NAME",
            "NAME",
            "JUEGO"
        ]).trim();

        const yearValue = getColumn(row, [
            "YEAR",
            "ANO",
            "AÑO"
        ]).trim();

        if (gameValue) {
            currentGame = gameValue;

            // Prevent metadata from carrying over to another game.
            currentYear = "";
            currentGenre = "";
            currentCoverUrl = "";
            currentDescription = "";
        }

        if (yearValue) {
            currentYear = yearValue;
        }

        const genreValue = getColumn(row, [
            "GENRE",
            "GENRES",
            "GÉNERO",
            "GENERO"
        ]).trim();

        if (genreValue) {
            currentGenre = genreValue;
        }

        const coverUrlValue = getColumn(row, [
            "COVER_URL",
            "COVER URL",
            "COVER",
            "IMAGE_URL",
            "IMAGE URL",
            "PORTADA"
        ]).trim();

        if (coverUrlValue) {
            currentCoverUrl = coverUrlValue;
        }

        const descriptionValue = getColumn(row, [
            "DESCRIPTION",
            "DESCRIPCIÓN",
            "DESCRIPCION",
            "SUMMARY",
            "SINOPSIS"
        ]).trim();

        if (descriptionValue) {
            currentDescription = descriptionValue;
        }

        const platform = getColumn(row, [
            "PLATFORM",
            "PLATAFORM",
            "PLATAFORMA"
        ]);

        const project = getColumn(row, [
            "PROJECT",
            "PROYECTO"
        ]);

        const link = getColumn(row, [
            "LINK",
            "PROJECT LINK",
            "ENLACE"
        ]);

        const url = getColumn(row, ["URL"]);

        const developer = getColumn(row, [
            "DEVELOPER",
            "DEVELOPER/PUBLISHER",
            "DESARROLLADOR"
        ]);

        const version = getColumn(row, [
            "VERSION",
            "VERSIÓN"
        ]);

        const controller = getColumn(row, [
            "CONTROLLER SUPPORT",
            "CONTROLLER",
            "GAMEPAD",
            "MANDO"
        ]);

        const files = getColumn(row, [
            "NEEDS GAME FILES?",
            "NEEDS GAME FILES",
            "GAME FILES",
            "NECESITA ARCHIVOS"
        ]);

        const dataUrl = getColumn(row, ["DATA URL"]);

        const works = getColumn(row, [
            "WORKS?",
            "WORKS",
            "FUNCIONA"
        ]);

        const lastUpdate = getColumn(row, [
            "LAST UPDATE",
            "LAST UPDATED",
            "ÚLTIMA ACTUALIZACIÓN"
        ]);

        const notes = getColumn(row, [
            "NOTES",
            "NOTE",
            "NOTAS"
        ]);

        const hasPortData =
            project ||
            link ||
            url ||
            developer ||
            version ||
            controller ||
            files ||
            dataUrl ||
            works ||
            lastUpdate ||
            notes;

        // Metadata-only rows are not rendered as ports.
        if (!currentGame || !hasPortData) {
            continue;
        }

        result.push({
            game: currentGame,
            year: currentYear,
            genre: currentGenre,
            coverUrl: currentCoverUrl,
            description: currentDescription,
            platform: platform.trim(),
            project: project.trim(),
            link: link.trim(),
            url: url.trim(),
            developer: developer.trim(),
            version: version.trim(),
            controller: controller.trim(),
            files: files.trim(),
            dataUrl: dataUrl.trim(),
            works: works.trim(),
            lastUpdate: lastUpdate.trim(),
            notes: notes.trim()
        });
    }

    return result;
}


/*
 * GET THE REQUESTED GAME FROM THE URL
 */

function getRequestedGame() {
    const params = new URLSearchParams(window.location.search);
    return params.get("game") || "";
}


/*
 * DISPLAY A SAFE ERROR MESSAGE
 */

function displayLoadError(error) {
    console.error("Could not load game:", error);

    gameTitle.textContent = "Error";
    gameYear.textContent = "";
    statusElement.textContent = "";

    let message = error?.message || "An unexpected error occurred.";

    if (error?.name === "AbortError") {
        message = "Google Sheets did not respond within 15 seconds.";
    }

    const errorContainer = document.createElement("div");
    errorContainer.className = "error";

    const heading = document.createElement("strong");
    heading.textContent = "Could not load the game.";

    const details = document.createElement("p");
    details.textContent = message;

    errorContainer.append(heading, details);

    // Avoid inserting error messages through innerHTML.
    portList.replaceChildren(errorContainer);
}


/*
 * LOAD THE SELECTED GAME
 */

async function loadGame() {
    try {
        const requestedGame = getRequestedGame();

        if (!requestedGame) {
            throw new Error("No game was specified.");
        }

        registerVisit(requestedGame);

        statusElement.textContent = "Loading ports...";

        // Abort if Google Sheets does not respond within 15 seconds.
        const controller = new AbortController();

        const timeout = setTimeout(
            () => controller.abort(),
            15000
        );

        let response;

        try {
            response = await fetch(SHEET_URL, {
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }

        const csv = await response.text();

        if (!csv || !csv.trim()) {
            throw new Error(
                "Google Sheets returned an empty response."
            );
        }

        const rows = parseCSV(csv);

        if (rows.length === 0) {
            throw new Error(
                "The Google Sheet contains no data."
            );
        }

        const processedRows = processRows(rows);

        if (processedRows.length === 0) {
            throw new Error(
                "No ports were found in the Google Sheet."
            );
        }

        const matchingRows = processedRows.filter(
            row => createSlug(row.game) === requestedGame
        );

        if (matchingRows.length === 0) {
            throw new Error(`Game not found: ${requestedGame}`);
        }

        const firstMatchingRow = matchingRows[0];

        const game = {
            name: firstMatchingRow.game,
            year: firstMatchingRow.year,
            genre: firstMatchingRow.genre,
            coverUrl: firstMatchingRow.coverUrl,
            description: firstMatchingRow.description,
            ports: matchingRows
        };

        // NAPL browser tab title.
        document.title = `${game.name} — NAPL`;

        displayGame(game, processedRows);

    } catch (error) {
        displayLoadError(error);
    }
}


/*
 * START
 */

loadGame();
            
