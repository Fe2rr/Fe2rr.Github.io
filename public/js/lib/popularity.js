/* NAPL popularity service — GitHub snapshot for reads, Supabase Edge Function for deduplicated writes. */
import { createSlug } from "./helpers.js";
import { POPULARITY_API_BASE } from "./config.js";
import { loadCommunitySummary } from "./community-summary.js";

const POPULARITY_CACHE_TTL_MS = 15 * 60 * 1000;
const VISIT_CLIENT_RETRY_MS = 60 * 1000;
const VISIT_DEDUP_STORAGE_KEY = "napl_popularity_visit_dedup_v1";
const popularByPeriod = new Map();
const popularFetchedAt = new Map();
const popularPromises = new Map();
const recentVisitSentAt = new Map();

function hasStoredVisitToday(game) {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const stored = JSON.parse(localStorage.getItem(VISIT_DEDUP_STORAGE_KEY) || "{}");
        return stored?.day === today && stored?.games?.[game] === true;
    } catch {
        return false;
    }
}

function markStoredVisitToday(game) {
    try {
        const today = new Date().toISOString().slice(0, 10);
        let stored = JSON.parse(localStorage.getItem(VISIT_DEDUP_STORAGE_KEY) || "{}");
        if (!stored || stored.day !== today || typeof stored.games !== "object") {
            stored = { day: today, games: {} };
        }
        stored.games[game] = true;
        const keys = Object.keys(stored.games);
        if (keys.length > 1500) {
            for (const key of keys.slice(0, keys.length - 1500)) delete stored.games[key];
        }
        localStorage.setItem(VISIT_DEDUP_STORAGE_KEY, JSON.stringify(stored));
    } catch {
        // Continue without persistent dedup when storage is unavailable.
    }
}

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
        // ranking from Supabase on a passive visit.
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

    if (hasStoredVisitToday(game)) return;

    const now = Date.now();
    const lastSent = recentVisitSentAt.get(game) || 0;
    if (now - lastSent < VISIT_CLIENT_RETRY_MS) return;
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
            markStoredVisitToday(game);
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
