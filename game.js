/*
 * GAME MODULE
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

const gameTitle =
    document.getElementById("game-title");

const gameYear =
    document.getElementById("game-year");

const portList =
    document.getElementById("port-list");

const statusElement =
    document.getElementById("status");


/*
 * Normalize headers.
 */

function normalizeHeader(value) {

    return value
        .replace(/^\uFEFF/, "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/*
 * Normalize text.
 */

function normalizeText(value) {

    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/*
 * Create the same slug used by app.js.
 */

function createSlug(name) {

    return normalizeText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


/*
 * Register a game visit.
 */

function registerVisit(gameSlug) {

    if (!gameSlug) {
        return;
    }

    const url =
        `${VISITS_URL}?game=${encodeURIComponent(gameSlug)}`;

    fetch(
        url,
        {
            method: "GET",
            mode: "no-cors",
            keepalive: true
        }
    ).catch(
        error => {
            console.error(
                "Could not register game visit:",
                error
            );
        }
    );
}


/*
 * CSV parser.
 */

function parseCSV(csv) {

    const rows = [];

    let row = [];
    let field = "";
    let insideQuotes = false;

    for (let i = 0; i < csv.length; i++) {

        const char = csv[i];

        /*
         * Quotes.
         */

        if (char === '"') {

            if (
                insideQuotes &&
                csv[i + 1] === '"'
            ) {

                field += '"';
                i++;

            } else {

                insideQuotes =
                    !insideQuotes;
            }

            continue;
        }

        /*
         * Comma outside quotes.
         */

        if (
            char === "," &&
            !insideQuotes
        ) {

            row.push(field);
            field = "";

            continue;
        }

        /*
         * End of row.
         */

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

            if (
                row.some(
                    value =>
                        value.trim() !== ""
                )
            ) {

                rows.push(row);
            }

            row = [];

            continue;
        }

        field += char;
    }

    /*
     * Last field.
     */

    if (
        field.length > 0 ||
        row.length > 0
    ) {

        row.push(field);

        if (
            row.some(
                value =>
                    value.trim() !== ""
            )
        ) {

            rows.push(row);
        }
    }

    if (rows.length === 0) {
        return [];
    }

    /*
     * First row = headers.
     */

    const headers =
        rows.shift().map(
            normalizeHeader
        );

    /*
     * Convert rows into objects.
     */

    return rows.map(values => {

        const rowObject = {};

        headers.forEach(
            (header, index) => {

                rowObject[header] =
                    (values[index] || "").trim();

            }
        );

        return rowObject;
    });
}


/*
 * Find a column.
 */

function getColumn(row, possibleNames) {

    for (const name of possibleNames) {

        const key =
            normalizeHeader(name);

        if (
            Object.prototype.hasOwnProperty.call(
                row,
                key
            )
        ) {

            return row[key];
        }
    }

    return "";
}


/*
 * Process rows.
 *
 * GAME and YEAR can be merged in Google Sheets.
 *
 * If GAME is empty, the game from the
 * previous row is inherited.
 */

function processRows(rows) {

    let currentGame = "";
    let currentYear = "";

    const result = [];

    for (const row of rows) {

        const gameValue =
            getColumn(row, [
                "GAME",
                "GAME NAME",
                "NAME",
                "JUEGO"
            ]).trim();

        const yearValue =
            getColumn(row, [
                "YEAR",
                "ANO",
                "AÑO"
            ]).trim();

        /*
         * Update current game.
         */

        if (gameValue) {
            currentGame = gameValue;
        }

        /*
         * Update current year.
         */

        if (yearValue) {
            currentYear = yearValue;
        }

        /*
         * PLATFORM.
         */

        const platform =
            getColumn(row, [
                "PLATFORM",
                "PLATAFORM",
                "PLATAFORMA"
            ]);

        /*
         * Project name.
         */

        const project =
            getColumn(row, [
                "PROJECT",
                "PROYECTO"
            ]);

        /*
         * LINK = text displayed on the button.
         */

        const link =
            getColumn(row, [
                "LINK",
                "PROJECT LINK",
                "ENLACE"
            ]);

        /*
         * URL = actual destination.
         */

        const url =
            getColumn(row, [
                "URL"
            ]);

        const developer =
            getColumn(row, [
                "DEVELOPER",
                "DEVELOPER/PUBLISHER",
                "DESARROLLADOR"
            ]);

        const version =
            getColumn(row, [
                "VERSION",
                "VERSIÓN"
            ]);

        const controller =
            getColumn(row, [
                "CONTROLLER SUPPORT",
                "CONTROLLER",
                "GAMEPAD",
                "MANDO"
            ]);

        const files =
            getColumn(row, [
                "NEEDS GAME FILES?",
                "NEEDS GAME FILES",
                "GAME FILES",
                "NECESITA ARCHIVOS"
            ]);

        /*
         * DATA URL = destination for the
         * value of "Needs Game Files?".
         */

        const dataUrl =
            getColumn(row, [
                "DATA URL"
            ]);

        const works =
            getColumn(row, [
                "WORKS?",
                "WORKS",
                "FUNCIONA"
            ]);

        const lastUpdate =
            getColumn(row, [
                "LAST UPDATE",
                "LAST UPDATED",
                "ÚLTIMA ACTUALIZACIÓN"
            ]);

        const notes =
            getColumn(row, [
                "NOTES",
                "NOTE",
                "NOTAS"
            ]);

        /*
         * Determine whether this row contains
         * port information.
         */

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

        if (
            !currentGame ||
            !hasPortData
        ) {

            continue;
        }

        result.push({

            game: currentGame,

            year: currentYear,

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
 * Get the requested game from the URL.
 */

function getRequestedGame() {

    const params =
        new URLSearchParams(
            window.location.search
        );

    return params.get("game") || "";
}


/*
 * Load the selected game.
 */

async function loadGame() {

    try {

        const requestedGame =
            getRequestedGame();

        /*
         * Make sure a game was specified.
         */

        if (!requestedGame) {

            throw new Error(
                "No game was specified."
            );
        }

        /*
         * Register the visit.
         */

        registerVisit(requestedGame);

        statusElement.textContent =
            "Loading ports...";

        /*
         * Abort the request if Google Sheets
         * does not respond within 15 seconds.
         */

        const controller =
            new AbortController();

        const timeout =
            setTimeout(
                () => controller.abort(),
                15000
            );

        let response;

        try {

            response =
                await fetch(
                    SHEET_URL,
                    {
                        signal:
                            controller.signal
                    }
                );

        } finally {

            clearTimeout(timeout);
        }

        if (!response.ok) {

            throw new Error(
                `HTTP error ${response.status}`
            );
        }

        /*
         * Read CSV.
         */

        const csv =
            await response.text();

        if (
            !csv ||
            !csv.trim()
        ) {

            throw new Error(
                "Google Sheets returned an empty response."
            );
        }

        /*
         * Parse CSV.
         */

        const rows =
            parseCSV(csv);

        if (rows.length === 0) {

            throw new Error(
                "The Google Sheet contains no data."
            );
        }

        /*
         * Process ports.
         */

        const processedRows =
            processRows(rows);

        if (
            processedRows.length === 0
        ) {

            throw new Error(
                "No ports were found in the Google Sheet."
            );
        }

        /*
         * Find the requested game.
         */

        const matchingRows =
            processedRows.filter(
                row =>
                    createSlug(row.game) ===
                    requestedGame
            );

        if (
            matchingRows.length === 0
        ) {

            throw new Error(
                `Game not found: ${requestedGame}`
            );
        }

        /*
         * Build game object.
         */

        const game = {

            name:
                matchingRows[0].game,

            year:
                matchingRows[0].year,

            ports:
                matchingRows

        };

        /*
         * Update browser title.
         */

        document.title =
            `${game.name} - Community Android Ports`;

        /*
         * Display game using game-render.js.
         */

        displayGame(
            game,
            processedRows
        );

    } catch (error) {

        console.error(
            "Could not load game:",
            error
        );

        gameTitle.textContent =
            "Error";

        gameYear.textContent =
            "";

        statusElement.textContent =
            "";

        let message =
            error.message;

        /*
         * Special message for a timeout.
         */

        if (
            error.name === "AbortError"
        ) {

            message =
                "Google Sheets did not respond within 15 seconds.";
        }

        portList.innerHTML = `
            <div class="error">

                <strong>
                    Could not load the game.
                </strong>

                <br><br>

                ${message}

            </div>
        `;
    }
}


/*
 * Start.
 */

loadGame();
