/*
 * NAPL — RATINGS SERVICE
 *
 * Connects to the Supabase Edge Function ratings API.
 */

import {
    RATINGS_API_BASE,
    RATING_TOKEN_STORAGE_KEY,
} from "./config.js";
import { loadCommunitySummary } from "./community-summary.js";

let ratingTokenMemory = "";
let myVotesCache = null;

function normalizeRatingsPayload(data) {
    const ratings = {};

    for (const port of data?.ports || []) {
        if (typeof port?.port_id !== "string" || !port.port_id.trim()) {
            continue;
        }

        const avg = Number(port.avg);
        const votes = Number(port.votes);
        const score = Number(port.score);

        ratings[port.port_id] = {
            avg: Number.isFinite(avg) ? avg : 0,
            votes: Number.isFinite(votes) ? votes : 0,
            score: Number.isFinite(score) ? score : 0,
        };
    }

    return ratings;
}

function readStoredRatingToken() {
    if (ratingTokenMemory) {
        return ratingTokenMemory;
    }

    try {
        ratingTokenMemory =
            localStorage.getItem(RATING_TOKEN_STORAGE_KEY) || "";
    } catch {
        // Continue using the in-memory token.
    }

    return ratingTokenMemory;
}

function storeRatingToken(token) {
    ratingTokenMemory = token;

    try {
        localStorage.setItem(RATING_TOKEN_STORAGE_KEY, token);
    } catch {
        // The token remains available for this page session.
    }
}

async function postRatingRequest(endpoint, payload) {
    const response = await fetch(RATINGS_API_BASE + endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
    });

    const raw = await response.text();
    let data = {};

    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        throw new Error("The ratings server returned an invalid response.");
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

export async function getRatingToken() {
    const existingToken = readStoredRatingToken();
    if (existingToken) {
        return existingToken;
    }

    const data = await postRatingRequest("/token", {});

    if (!data || typeof data.token !== "string" || !data.token.trim()) {
        throw new Error(
            "The ratings server did not provide a valid voter token."
        );
    }

    storeRatingToken(data.token);
    return data.token;
}

function clearStoredRatingToken() {
    ratingTokenMemory = "";

    try {
        localStorage.removeItem(RATING_TOKEN_STORAGE_KEY);
    } catch {
        // Continue using the in-memory token.
    }
}

async function postWithTokenRefresh(endpoint, payload) {
    let token = await getRatingToken();

    try {
        return await postRatingRequest(endpoint, { ...payload, token });
    } catch (error) {
        if (!(error instanceof Error) || error.message !== "invalid_token") {
            throw error;
        }

        clearStoredRatingToken();
        token = await getRatingToken();
        return postRatingRequest(endpoint, { ...payload, token });
    }
}

async function loadMyVotes(force = false) {
    if (myVotesCache && !force) {
        return myVotesCache;
    }

    const data = await postWithTokenRefresh("/my-votes", {});

    if (
        !data ||
        !data.votes ||
        typeof data.votes !== "object" ||
        Array.isArray(data.votes)
    ) {
        throw new Error("The ratings server returned an invalid vote list.");
    }

    myVotesCache = data.votes;
    return myVotesCache;
}

export async function loadPortRatings(fresh = false) {
    try {
        if (!fresh) {
            const summary = await loadCommunitySummary();
            if (summary?.ratings && Array.isArray(summary.ratings.ports)) {
                return normalizeRatingsPayload(summary.ratings);
            }
        }

        const response = await fetch(RATINGS_API_BASE, {
            method: "GET",
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error(`Ratings API returned HTTP ${response.status}.`);
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.ports)) {
            throw new Error("Ratings API returned an invalid response.");
        }

        return normalizeRatingsPayload(data);
    } catch (error) {
        console.warn("NAPL: could not load port ratings.", error);
        return {};
    }
}

export function createRatingActions() {
    return {
        async getMyVote(portId) {
            const votes = await loadMyVotes();
            const value = Number(votes[portId]);

            return Number.isInteger(value) && value >= 1 && value <= 5
                ? value
                : 0;
        },

        async submitVote(portId, stars) {
            await postWithTokenRefresh("/vote", {
                port_id: portId,
                stars,
            });

            if (!myVotesCache) {
                myVotesCache = {};
            }

            myVotesCache[portId] = stars;

            const updatedRatings = await loadPortRatings(true);

            return {
                myVote: stars,
                rating: updatedRatings[portId] || null,
            };
        },
    };
}
