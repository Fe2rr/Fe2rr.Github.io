/*
 * NAPL — GAME DATA
 *
 * Loads the selected game from Google Sheets,
 * groups its Android ports and sends the data
 * to game-render.js.
 */

import { displayGame } from "./game-render.js";


/* ==================================================
   CONFIGURATION
   ================================================== */

const GAME_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";


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


function normalizeGameHeader(value) {
    return String(value || "")
        .replace(/^\uFEFF/, "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/* ==================================================
   CSV PARSER
   ================================================== */

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
            if (
                char === "\r" &&
                csv[i + 1] === "\n"
            ) {
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

    const headers = rows
        .shift()
        .map(normalizeGameHeader);

    return rows.map(values => {
        const result = {};

        headers.forEach((header, index) => {
            if (header) {
                result[header] =
                    String(values[index] || "").trim();
            }
        });

        return result;
    });
}


/* ==================================================
   COLUMN LOOKUP
   ================================================== */

function getGameColumn(row, aliases) {
    for (const alias of aliases) {
        const key = normalizeGameHeader(alias);

        if (
            Object.prototype.hasOwnProperty.call(
                row,
                key
            )
        ) {
            return String(row[key] || "").trim();
        }
    }

    return "";
}


/* ==================================================
   GROUP GAME DATA
   ================================================== */

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

        const key = createSlug(currentGame);

        if (!key) {
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
            "COVER_URL",
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

        if (!grouped.has(key)) {
            grouped.set(key, {
                name: currentGame,
                slug: key,
                year: currentYear,
                genre: "",
                description: "",
                coverUrl: "",
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

        if (
            platform &&
            !game.platforms.includes(platform)
        ) {
            game.platforms.push(platform);
        }

        /*
         * General-information rows without port
         * details do not create empty port cards.
         */

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


/* ==================================================
   LOAD THE SELECTED GAME
   ================================================== */

async function loadSelectedGame() {
    const gameHeader =
        document.getElementById("game-header");

    const portList =
        document.getElementById("port-list");

    const status =
        document.getElementById("status");

    if (!gameHeader || !portList || !status) {
        console.error(
            "NAPL: required game page elements are missing."
        );

        return;
    }

    const params =
        new URLSearchParams(window.location.search);

    const requestedSlug = params.get("game");

    if (!requestedSlug) {
        gameHeader.textContent = "No game selected.";

        status.textContent =
            "Return to the list and select a game.";

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
            throw new Error(
                "The spreadsheet returned no data."
            );
        }

        const rows = parseGameCSV(csv);

        if (!rows.length) {
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

        const allRows = rows.map(row => ({
            game: getGameColumn(row, [
                "GAME",
                "GAME NAME",
                "NAME",
                "JUEGO"
            ]),
            year: getGameColumn(row, [
                "YEAR",
                "AÑO",
                "ANO"
            ]),
            platform: getGameColumn(row, [
                "PLATFORM",
                "PLATAFORM",
                "PLATAFORMA"
            ]),
            project: getGameColumn(row, [
                "PROJECT",
                "PROYECTO"
            ])
        }));

        displayGame(game, allRows);

    } catch (error) {
        console.error(
            "NAPL: could not load selected game.",
            error
        );

        gameHeader.textContent =
            "Could not load this game.";

        status.textContent =
            error instanceof Error
                ? error.message
                : "An unexpected error occurred.";

        portList.replaceChildren();
    }
}


/* ==================================================
   START
   ================================================== */

loadSelectedGame();
