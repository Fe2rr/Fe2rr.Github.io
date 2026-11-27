/* NAPL popularity service — static community summary first, live Worker on write/fallback. */
import { createSlug } from "./helpers.js";
import { POPULARITY_API_BASE } from "./config.js";
import { loadCommunitySummary } from "./community-summary.js";

const POPULARITY_CACHE_TTL_MS = 5 * 60 * 1000;
const VISIT_CLIENT_DEDUP_MS = 20 * 1000;
const popularByPeriod = new Map();
const popularFetchedAt = new Map();
const popularPromises = new Map();
const recentVisitSentAt = new Map();

function normalizePopularityKey(value) {
    const key = createSlug(value || "");
    return /^[a-z0-9][a-z0-9-]{0,179}$/.test(key) ? key : "";
}

async function requestPopularity(period) {
    const response = await fetch(
        `${POPULARITY_API_BASE}?period=${encodeURIComponent(period)}`,
        { method: "GET", cache: "no-store" }
    );
    if (!response.ok) {
        throw new Error(`Popularity API returned HTTP ${response.status}.`);
    }
    const data = await response.json();
    if (!data?.success || !Array.isArray(data.games)) {
        throw new Error("Invalid popularity response.");
    }
    return data.games;
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

        const items = await requestPopularity(normalized);
        const map = buildPopularityMap(items);
        popularByPeriod.set(normalized, map);
        popularFetchedAt.set(normalized, Date.now());
        return map;
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
                popularByPeriod.clear();
                popularFetchedAt.clear();
            }
        })
        .catch((error) =>
            console.warn("NAPL: could not register the game visit.", error)
        );
}
