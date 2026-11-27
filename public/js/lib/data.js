/*
 * NAPL — PUBLIC CATALOG LOADER
 *
 * The catalog is fetched from the published static JSON on every page load.
 * No offline copy or browser-side catalog cache is maintained.
 */

import { hydrateCatalog } from "./catalog-schema.js";
import { resolveCatalogApiBase } from "./config.js";

const PAGES_CATALOG_JSON_URL =
    "https://napl-catalog.pages.dev/assets/data/catalog.json";

let catalogPromise = null;

function getCatalogUrls() {
    const apiBase = resolveCatalogApiBase();
    if (!apiBase) {
        return ["/api/public-catalog", PAGES_CATALOG_JSON_URL];
    }
    if (typeof window !== "undefined") {
        const host = String(window.location.hostname || "").toLowerCase();
        if (host === "napl-catalog.pages.dev" || host.endsWith(".napl-catalog.pages.dev")) {
            return ["/assets/data/catalog.json", PAGES_CATALOG_JSON_URL];
        }
    }
    return [PAGES_CATALOG_JSON_URL];
}

async function fetchStaticJsonCatalog() {
    const urls = getCatalogUrls();
    let lastError = null;

    for (const url of urls) {
        try {
            const response = await fetch(url, {
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
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("Could not load public catalog.");
}

export async function loadCatalog() {
    if (catalogPromise) return catalogPromise;

    catalogPromise = fetchStaticJsonCatalog()
        .then((doc) => hydrateCatalog(doc))
        .catch((error) => {
            catalogPromise = null;
            throw error;
        });

    return catalogPromise;
}
