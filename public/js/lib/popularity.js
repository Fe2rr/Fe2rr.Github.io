/* NAPL popularity service — static community summary first, live Worker on write/fallback. */
import { createSlug } from "./helpers.js";
import { POPULARITY_API_BASE } from "./config.js";
import { loadCommunitySummary } from "./community-summary.js";

const POPULARITY_CACHE_TTL_MS = 15 * 60 * 1000;
const VISIT_CLIENT_DEDUP_MS = 20 * 1000;
const popularByPeriod = new Map();
const popularFetchedAt = new Map();
const popularPromises = new Map();
const recentVisitSentAt = new Map();

function normalizePopularityKey(value) {
    const key = createSlug(value || "");
    return /^[a-z0-9][a-z0-9-]{0,179}$/.test(key) ? key : "";
}

function buildPopularityMap(items) {
    const map = new Map();
    for (const item of items || []) {
        const visits = Number(item?.visits) || 0;
        const key = normalizePopularityKey(item?.slug || item?.game_key);
        if (key) map.set(key, visits);
    }
    return map;
}

function hydrateAllPeriodsFromSummary(summary) {
    const now = Date.now();
    for (const p of ["week", "month", "alltime"]) {
        if (Array.isArray(summary?.popularity?.[p])) {
            popularByPeriod.set(p, buildPopularityMap(summary.popularity[p]));
            popularFetchedAt.set(p, now);
        }
    }
}

export async function ensurePopularPeriod(period = "alltime") {
    const normalized = String(period || "alltime").trim().toLowerCase();
    if (!["week", "month", "alltime"].includes(normalized)) return new Map();

    const cached = popularByPeriod.get(normalized);
    if (
        cached &&
        Date.now() - (popularFetchedAt.get(normalized) || 0) <
            POPULARITY_CACHE_TTL_MS
    ) {
        return cached;
    }

    if (popularPromises.has(normalized)) return popularPromises.get(normalized);

    const previous = cached || new Map();
    const promise = (async () => {
        const summary = await loadCommunitySummary();
        if (Array.isArray(summary?.popularity?.[normalized])) {
            hydrateAllPeriodsFromSummary(summary);
            return popularByPeriod.get(normalized) || previous;
        }

        // Popularity is a GitHub-hosted static snapshot. Never read the full
        // ranking from D1 on a passive visit.
        return previous;
    })()
        .catch((error) => {
            console.warn(`Could not load ${normalized} popularity:`, error);
            return previous;
        })
        .finally(() => popularPromises.delete(normalized));

    popularPromises.set(normalized, promise);
    return promise;
}

export function getPopularVisits(popularityKey, period = "alltime") {
    const key = normalizePopularityKey(popularityKey);
    return (
        popularByPeriod
            .get(String(period || "alltime").trim().toLowerCase())
            ?.get(key) || 0
    );
}

export async function ensureAllTimePopular() {
    return ensurePopularPeriod("alltime");
}

export function getAllTimeVisits(popularityKey) {
    return getPopularVisits(popularityKey, "alltime");
}

export function registerGameVisit(popularityKey) {
    const game = normalizePopularityKey(popularityKey);
    if (!game) return;

    const now = Date.now();
    const lastSent = recentVisitSentAt.get(game) || 0;
    if (now - lastSent < VISIT_CLIENT_DEDUP_MS) {
        return;
    }
    recentVisitSentAt.set(game, now);

    fetch(POPULARITY_API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game }),
        cache: "no-store",
        keepalive: true,
    })
        .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then((result) => {
            if (result?.counted) {
                for (const period of ["week", "month", "alltime"]) {
                    const map = popularByPeriod.get(period);
                    if (map) map.set(game, (map.get(game) || 0) + 1);
                }
            }
        })
        .catch((error) =>
            console.warn("NAPL: could not register the game visit.", error)
        );
}
