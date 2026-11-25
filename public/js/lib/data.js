/*
 * NAPL — PUBLIC CATALOG LOADER
 *
 * The catalog is fetched from the published static JSON on every page load.
 * No offline copy or browser-side catalog cache is maintained.
 */

import { hydrateCatalog } from "./catalog-schema.js";

const CATALOG_JSON_URL = "https://napl-admin-api.federicoxastro.workers.dev/api/public-catalog";

let catalogPromise = null;

function clearLegacyCatalogCache() {
    try {
        if (typeof window !== "undefined" && "caches" in window) {
            window.caches.delete("napl-catalog-v4").catch(() => {});
        }
    } catch {
        // Ignore unavailable CacheStorage.
    }

    try {
        if (typeof localStorage !== "undefined") {
            localStorage.removeItem("napl_catalog_cache_meta_v4");
        }
    } catch {
        // Ignore unavailable localStorage.
    }
}

async function fetchStaticJsonCatalog() {
    const response = await fetch(CATALOG_JSON_URL, {
        method: "GET",
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`Catalog JSON returned HTTP ${response.status}.`);
    }

    const doc = await response.json();
    if (!doc || !Array.isArray(doc.games)) {
        throw new Error("Catalog JSON is invalid.");
    }

    return doc;
}

export async function loadCatalog() {
    if (catalogPromise) return catalogPromise;

    clearLegacyCatalogCache();

    catalogPromise = fetchStaticJsonCatalog()
        .then((doc) => hydrateCatalog(doc))
        .catch((error) => {
            catalogPromise = null;
            throw error;
        });

    return catalogPromise;
}
