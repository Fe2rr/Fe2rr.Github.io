
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
import { createSlug } from "./text.js";
import { API_BASE } from "./api-config.js";


/* ==================================================
   CONFIGURATION
   ================================================== */



const RATINGS_API_BASE = API_BASE;

const RATINGS_API_URL =
    RATINGS_API_BASE + "/ratings";

const GAME_API_URL =
    RATINGS_API_BASE + "/api/games/";

const VISIT_API_URL =
    RATINGS_API_BASE + "/api/visit";

const RATING_TOKEN_STORAGE_KEY =
    "napl_rating_token_v1";

let ratingTokenMemory = "";

let myVotesCache = null;


/* ==================================================
   TEXT HELPERS
   ================================================== */







/* ==================================================
   VISIT TRACKING
   ================================================== */



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



/* ==================================================
   COLUMN LOOKUP
   ================================================== */



/* ==================================================
   GROUP GAME DATA
   ================================================== */



/* ==================================================
   LOAD THE SELECTED GAME
   ================================================== */



/* ==================================================
   START
   ================================================== */


/* ==================================================
   VISIT TRACKING
   ================================================== */

function registerGameVisit(slug) {
    fetch(VISIT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
        keepalive: true
    }).catch(error => {
        console.error("NAPL: could not send the game visit.", error);
    });
}


/* ==================================================
   API -> RENDER MODEL
   ================================================== */

const MULTI_GAME_PLATFORM = "Multi-Game Apps";

function toGameModel(data) {
    const { game } = data;

    const ports = data.ports.map(port => ({
        game: game.name,
        year: game.year,
        platform: port.platform,
        project: port.project,
        portId: port.port_id,
        link: port.link_label,
        url: port.url,
        dataUrl: port.data_url,
        developer: port.developer,
        version: port.version,
        controller: port.controller,
        files: port.needs_files,
        works: port.works,
        lastUpdate: port.last_update,
        notes: port.notes,
        instructions: port.instructions
    }));

    return {
        name: game.name,
        year: game.year,
        slug: game.slug,
        coverUrl: game.cover_url,
        genre: game.genre,
        description: game.description,
        launchboxUrl: game.launchbox_url,
        platforms: [...new Set(ports.map(port => port.platform).filter(Boolean))],
        ports
    };
}

/*
 * displayGame() resolves multi-game app links from sheet-like rows;
 * the API already returns those relations, so rebuild only those rows.
 */
function toRelatedRows(data, game) {
    return [
        ...game.ports,
        ...data.apps_used.flatMap(app => [
            {
                game: app.name,
                year: "",
                platform: MULTI_GAME_PLATFORM,
                project: ""
            },
            ...(app.games || []).map(item => ({
                game: item.name,
                year: item.year,
                platform: "",
                project: app.name
            }))
        ]),
        ...data.games_using_app.map(item => ({
            game: item.name,
            year: item.year,
            platform: "",
            project: game.name
        }))
    ];
}


/* ==================================================
   LOAD THE SELECTED GAME
   ================================================== */

async function loadSelectedGame() {
    const gameHeader = document.getElementById("game-header");
    const portList = document.getElementById("port-list");
    const status = document.getElementById("status");

    if (!gameHeader || !portList || !status) {
        console.error("NAPL: required game page elements are missing.");
        return;
    }

    const requestedSlug = createSlug(
        new URLSearchParams(window.location.search).get("game")
    );

    if (!requestedSlug) {
        gameHeader.textContent = "No game selected.";
        status.textContent = "Return to the list and select a game.";
        portList.replaceChildren();
        return;
    }

    status.textContent = "Loading ports...";
    portList.replaceChildren();

    try {
        const response = await fetch(
            GAME_API_URL + encodeURIComponent(requestedSlug)
        );

        if (response.status === 404) {
            gameHeader.textContent = "Game not found.";
            status.textContent = "This game could not be found.";
            return;
        }

        if (!response.ok) {
            throw new Error(`The catalog returned HTTP ${response.status}.`);
        }

        const data = await response.json();
        const game = toGameModel(data);

        document.title = `${game.name} — NAPL`;
        registerGameVisit(game.slug);

        displayGame(
            game,
            toRelatedRows(data, game),
            data.ratings || {},
            createRatingActions()
        );
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


/* ==================================================
   START
   ================================================== */

loadSelectedGame();
