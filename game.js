
/*
 * NAPL — GAME DATA
 *
 * Loads the selected game from Google Sheets,
 * groups its Android ports, registers the visit,
 * loads port ratings and sends everything to
 * game-render.js.
 *
 * Includes anonymous rating tokens and voting API.
 */

import { displayGame } from "./game-render.js";


/* ==================================================
   CONFIGURATION
   ================================================== */

const GAME_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";

const VISIT_TRACKING_URL =
    "https://script.google.com/macros/s/AKfycbxio6DGpBJRkYdceeFVXk3gSOFcBe5KZJtHU8F2j66DDYx_G_az01p7rnsuCq0KPHY/exec";

const RATINGS_API_BASE =
    "https://ports-rankings.federicoxastro.workers.dev";

const RATINGS_API_URL =
    RATINGS_API_BASE + "/ratings";

const RATING_TOKEN_STORAGE_KEY =
    "napl_rating_token_v1";

let ratingTokenMemory = "";

let myVotesCache = null;


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
   VISIT TRACKING
   ================================================== */

function registerGameVisit(gameName) {
    if (!gameName) {
        return;
    }

    const slug = createSlug(gameName);

    if (!slug) {
        return;
    }

    const url = new URL(VISIT_TRACKING_URL);

    url.searchParams.set("game", slug);
    url.searchParams.set("_", String(Date.now()));

    fetch(url.toString(), {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        keepalive: true
    }).catch(error => {
        console.error(
            "NAPL: could not send the game visit.",
            error
        );
    });
}


/* ==================================================
   LOAD PORT RATINGS
   ================================================== */

/*
 * Returns an object indexed by PORTS_ID.
 *
 * Example:
 * {
 *   "example-port": {
 *     avg: 4.25,
 *     votes: 12,
 *     score: 3.90
 *   }
 * }
 *
 * If the API is unavailable, returns an empty
 * object without interrupting the game page.
 */

async function loadPortRatings() {
    try {
        const response = await fetch(RATINGS_API_URL, {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(
                `Ratings API returned HTTP ${response.status}.`
            );
        }

        const data = await response.json();

        if (!data || !Array.isArray(data.ports)) {
            throw new Error(
                "Ratings API returned an invalid response."
            );
        }

        const ratings = {};

        for (const port of data.ports) {
            if (
                typeof port.port_id !== "string" ||
                !port.port_id.trim()
            ) {
                continue;
            }

            const avg = Number(port.avg);
            const votes = Number(port.votes);
            const score = Number(port.score);

            ratings[port.port_id] = {
                avg: Number.isFinite(avg) ? avg : 0,
                votes: Number.isFinite(votes) ? votes : 0,
                score: Number.isFinite(score) ? score : 0
            };
        }

        return ratings;

    } catch (error) {
        console.warn(
            "NAPL: could not load port ratings.",
            error
        );

        return {};
    }
}


/* ==================================================
   RATING VOTING API
   ================================================== */

/*
 * Anonymous voter identity.
 *
 * A token is generated only when the visitor
 * opens the rating panel for the first time.
 *
 * It is stored locally so the visitor can
 * recover and update previous votes.
 */


function readStoredRatingToken() {
    if (ratingTokenMemory) {
        return ratingTokenMemory;
    }

    try {
        ratingTokenMemory =
            localStorage.getItem(
                RATING_TOKEN_STORAGE_KEY
            ) || "";

    } catch (error) {
        // Continue using the in-memory token.
    }

    return ratingTokenMemory;
}


function storeRatingToken(token) {
    ratingTokenMemory = token;

    try {
        localStorage.setItem(
            RATING_TOKEN_STORAGE_KEY,
            token
        );

    } catch (error) {
        // The token remains available for this page session.
    }
}


/* ==================================================
   GENERIC POST REQUEST
   ================================================== */

async function postRatingRequest(endpoint, payload) {
    const response = await fetch(
        RATINGS_API_BASE + endpoint,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(payload),

            cache: "no-store"
        }
    );

    const raw = await response.text();

    let data = {};

    try {
        data = raw ? JSON.parse(raw) : {};

    } catch (error) {
        throw new Error(
            "The ratings server returned an invalid response."
        );
    }

    if (!response.ok) {
        throw new Error(
            data.error ||
            data.message ||
            `Ratings server error (HTTP ${response.status}).`
        );
    }

    return data;
}


/* ==================================================
   GET OR CREATE VOTER TOKEN
   ================================================== */

async function getRatingToken() {
    const existingToken = readStoredRatingToken();

    if (existingToken) {
        return existingToken;
    }

    /*
     * REQUIRE_CAPTCHA is currently false
     * in the Cloudflare Worker configuration.
     */

    const data = await postRatingRequest(
        "/token",
        {}
    );

    if (
        !data ||
        typeof data.token !== "string" ||
        !data.token.trim()
    ) {
        throw new Error(
            "The ratings server did not provide a valid voter token."
        );
    }

    storeRatingToken(data.token);

    return data.token;
}


/* ==================================================
   LOAD PREVIOUS VOTES
   ================================================== */

async function loadMyVotes(force = false) {
    if (myVotesCache && !force) {
        return myVotesCache;
    }

    const token = await getRatingToken();

    const data = await postRatingRequest(
        "/my-votes",
        {
            token
        }
    );

    if (
        !data ||
        !data.votes ||
        typeof data.votes !== "object" ||
        Array.isArray(data.votes)
    ) {
        throw new Error(
            "The ratings server returned an invalid vote list."
        );
    }

    myVotesCache = data.votes;

    return myVotesCache;
}


/* ==================================================
   RATING ACTIONS FOR GAME RENDERER
   ================================================== */

/*
 * These functions are passed to game-render.js.
 *
 * getMyVote:
 * Retrieves the visitor's previous vote for a port.
 *
 * submitVote:
 * Sends a new vote or updates an existing one.
 */

function createRatingActions() {
    return {

        async getMyVote(portId) {
            const votes = await loadMyVotes();

            const value = Number(votes[portId]);

            return Number.isInteger(value) &&
                value >= 1 &&
                value <= 5
                ? value
                : 0;
        },


        async submitVote(portId, stars) {
            const token = await getRatingToken();

            await postRatingRequest(
                "/vote",
                {
                    token,
                    port_id: portId,
                    stars
                }
            );

            /*
             * Update local vote cache.
             */

            if (!myVotesCache) {
                myVotesCache = {};
            }

            myVotesCache[portId] = stars;

            /*
             * Refresh public averages and vote counts.
             */

            const updatedRatings =
                await loadPortRatings();

            return {
                myVote: stars,
                rating: updatedRatings[portId] || null
            };
        }

    };
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

        const portId = getGameColumn(row, [
            "PORTS_ID",
            "PORT ID",
            "PORT_ID"
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
            portId,
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

        /*
         * Register one visit after the game is found.
         */

        registerGameVisit(game.name);

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

        /*
         * Load public ratings independently.
         * An API error does not prevent the game
         * from being displayed.
         */

        const ratings = await loadPortRatings();

        /*
         * Pass voting actions to the renderer.
         */

        displayGame(
            game,
            allRows,
            ratings,
            createRatingActions()
        );

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
