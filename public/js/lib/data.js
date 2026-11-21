/*
 * NAPL — PUBLIC CATALOG LOADER
 *
 * Public pages read ONLY the generated static catalog.json.
 * Cloudflare D1 is private and is accessed exclusively by the authenticated
 * Admin panel. The Admin publishes D1 snapshots to this JSON file on GitHub.
 */

import { hydrateCatalog } from "./catalog-schema.js";

const CATALOG_JSON_URL = "https://raw.githubusercontent.com/Fe2rr/Napl-prueba/main/public/assets/data/catalog.json";
const CATALOG_CACHE_NAME = "napl-catalog-v4";
const CATALOG_CACHE_KEY = "/__napl_static_catalog__.json";
const CATALOG_META_STORAGE_KEY = "napl_catalog_cache_meta_v4";
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
    if (typeof window === "undefined" || !("caches" in window)) return null;
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
    if (typeof window === "undefined" || !("caches" in window)) return;
    try {
        const cache = await window.caches.open(CATALOG_CACHE_NAME);
        const response = new Response(JSON.stringify(doc), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
        });
        await cache.put(CATALOG_CACHE_KEY, response);
    } catch {
        // Ignore CacheStorage write errors
    }
}

async function fetchStaticJsonCatalog(force = false) {
    const url = force ? `${CATALOG_JSON_URL}?t=${Date.now()}` : CATALOG_JSON_URL;
    const response = await fetch(url, {
        method: "GET",
        cache: force ? "no-store" : "default",
    });
    if (!response.ok) throw new Error(`Catalog JSON returned HTTP ${response.status}.`);

    const doc = await response.json();
    if (!doc || !Array.isArray(doc.games)) {
        throw new Error("Catalog JSON is invalid.");
    }
    await writeCachedCatalogDoc(doc);
    return doc;
}

function scheduleBackgroundRevalidation(cachedDoc, onBackgroundUpdate) {
    if (revalidationPromise) return revalidationPromise;
    revalidationPromise = (async () => {
        try {
            const freshDoc = await fetchStaticJsonCatalog(true);
            const previous = String(cachedDoc?.updatedAt || "");
            const next = String(freshDoc?.updatedAt || "");
            if (next && next !== previous) {
                const hydrated = hydrateCatalog(freshDoc);
                catalogPromise = Promise.resolve(hydrated);
                if (typeof onBackgroundUpdate === "function") onBackgroundUpdate(hydrated);
            }
        } catch {
            // Keep serving the last valid local copy while offline or on errors.
        } finally {
            revalidationPromise = null;
        }
    })();
    return revalidationPromise;
}

export async function loadCatalog(force = false, options = {}) {
    const { onBackgroundUpdate = null } = options || {};
    if (catalogPromise && !force) return catalogPromise;

    catalogPromise = (async () => {
        if (!force) {
            const cachedDoc = await readCachedCatalogDoc();
            if (cachedDoc) {
                const meta = readCachedMeta();
                const stale = !meta?.cachedAt || Date.now() - meta.cachedAt > CATALOG_SOFT_TTL_MS;
                if (stale) scheduleBackgroundRevalidation(cachedDoc, onBackgroundUpdate);
                return hydrateCatalog(cachedDoc);
            }
        }
        return hydrateCatalog(await fetchStaticJsonCatalog(force));
    })().catch((error) => {
        catalogPromise = null;
        throw error;
    });
    return catalogPromise;
}
