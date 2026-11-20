/*
 * NAPL — CATALOG DATA LOADER & CLIENT CACHE
 *
 * Loads live catalog data from Cloudflare D1 (or local SQLite preview API)
 * with instant CacheStorage stale-while-revalidate caching and graceful
 * fallback to static `assets/data/catalog.json` and Google Sheets CSV.
 */

import { hydrateCatalog, csvToCatalogDocument } from "./catalog-schema.js";
import { resolveCatalogApiBase } from "./config.js";

const CATALOG_JSON_URL = "assets/data/catalog.json";
const SHEET_CSV_URL =
    "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";
const CATALOG_CACHE_NAME = "napl-catalog-v2";
const CATALOG_CACHE_KEY = "/__napl_live_catalog__.json";
const CATALOG_META_STORAGE_KEY = "napl_catalog_cache_meta_v2";
const CATALOG_SOFT_TTL_MS = 30 * 1000;

let catalogPromise = null;
let revalidationPromise = null;

function readCachedMeta() {
    try {
        const raw = localStorage.getItem(CATALOG_META_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function writeCachedMeta(doc) {
    try {
        localStorage.setItem(
            CATALOG_META_STORAGE_KEY,
            JSON.stringify({
                updatedAt: String(doc?.updatedAt || ""),
                cachedAt: Date.now(),
            })
        );
    } catch {
        // Ignore storage errors
    }
}

async function readCachedCatalogDoc() {
    if (typeof window === "undefined" || !("caches" in window)) {
        return null;
    }
    try {
        const cache = await window.caches.open(CATALOG_CACHE_NAME);
        const match = await cache.match(CATALOG_CACHE_KEY);
        if (!match) return null;
        const doc = await match.json();
        return doc && Array.isArray(doc.games) ? doc : null;
    } catch {
        return null;
    }
}

async function writeCachedCatalogDoc(doc) {
    writeCachedMeta(doc);
    if (typeof window === "undefined" || !("caches" in window)) {
        return;
    }
    try {
        const cache = await window.caches.open(CATALOG_CACHE_NAME);
        const res = new Response(JSON.stringify(doc), {
            status: 200,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
            },
        });
        await cache.put(CATALOG_CACHE_KEY, res);
    } catch {
        // Ignore CacheStorage write errors
    }
}

async function fetchLiveDbCatalog(bypassBrowserCache = false) {
    const apiBase = resolveCatalogApiBase();
    const endpoint = `${apiBase}/api/public/catalog`;
    const url = bypassBrowserCache ? `${endpoint}?t=${Date.now()}` : endpoint;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 5500) : null;

    try {
        const response = await fetch(url, {
            method: "GET",
            cache: bypassBrowserCache ? "no-store" : "default",
            signal: controller ? controller.signal : undefined,
        });
        if (!response.ok) {
            throw new Error(`Live D1 catalog HTTP ${response.status}.`);
        }
        const doc = await response.json();
        if (!doc || !Array.isArray(doc.games) || !doc.games.length) {
            throw new Error("Live D1 catalog is empty.");
        }
        await writeCachedCatalogDoc(doc);
        return doc;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function fetchStaticJsonCatalog(bypassBrowserCache = false) {
    const url = bypassBrowserCache
        ? `${CATALOG_JSON_URL}?t=${Date.now()}`
        : CATALOG_JSON_URL;
    const response = await fetch(url, {
        method: "GET",
        cache: bypassBrowserCache ? "no-store" : "default",
    });

    if (!response.ok) {
        throw new Error(`Catalog JSON returned HTTP ${response.status}.`);
    }

    const doc = await response.json();
    if (!doc || !Array.isArray(doc.games) || !doc.games.length) {
        throw new Error("Catalog JSON is empty or invalid.");
    }

    await writeCachedCatalogDoc(doc);
    return doc;
}

async function fetchFallbackSheetCatalog() {
    const response = await fetch(SHEET_CSV_URL, {
        method: "GET",
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`Google Sheets returned HTTP ${response.status}.`);
    }

    const csv = await response.text();
    const doc = csvToCatalogDocument(csv);
    await writeCachedCatalogDoc(doc);
    return doc;
}

async function loadFreshCatalogDoc(force = false) {
    try {
        return await fetchLiveDbCatalog(force);
    } catch {
        try {
            return await fetchStaticJsonCatalog(force);
        } catch {
            return await fetchFallbackSheetCatalog();
        }
    }
}

function scheduleBackgroundRevalidation(cachedDoc, onBackgroundUpdate) {
    if (revalidationPromise) return revalidationPromise;

    revalidationPromise = (async () => {
        try {
            const freshDoc = await loadFreshCatalogDoc(true);
            const prevStamp = String(cachedDoc?.updatedAt || "");
            const nextStamp = String(freshDoc?.updatedAt || "");

            if (nextStamp && nextStamp !== prevStamp) {
                const hydrated = hydrateCatalog(freshDoc);
                catalogPromise = Promise.resolve(hydrated);
                if (typeof onBackgroundUpdate === "function") {
                    onBackgroundUpdate(hydrated);
                }
            }
        } catch {
            // Silent background revalidation failure; cached catalog remains active
        } finally {
            revalidationPromise = null;
        }
    })();

    return revalidationPromise;
}

export async function loadCatalog(force = false, options = {}) {
    const { onBackgroundUpdate = null } = options || {};

    if (catalogPromise && !force) {
        return catalogPromise;
    }

    catalogPromise = (async () => {
        if (!force) {
            const cachedDoc = await readCachedCatalogDoc();
            if (cachedDoc) {
                const meta = readCachedMeta();
                const isStale =
                    !meta?.cachedAt || Date.now() - meta.cachedAt > CATALOG_SOFT_TTL_MS;
                if (isStale) {
                    scheduleBackgroundRevalidation(cachedDoc, onBackgroundUpdate);
                }
                return hydrateCatalog(cachedDoc);
            }
        }

        const doc = await loadFreshCatalogDoc(force);
        return hydrateCatalog(doc);
    })().catch((err) => {
        catalogPromise = null;
        throw err;
    });

    return catalogPromise;
}
