/*
 * NAPL — PUBLIC CATALOG LOADER
 *
 * The catalog is fetched from the published static JSON on every page load.
 * No offline copy or browser-side catalog cache is maintained.
 */

import { hydrateCatalog } from "./catalog-schema.js";
import { resolveCatalogApiBase } from "./config.js";

const LEGACY_STATIC_CATALOG_URL =
    "https://napl-catalog.pages.dev/assets/data/catalog.json";

let catalogPromise = null;

function getCatalogUrls() {
    const mode = resolveCatalogApiBase();
    if (!mode) {
        return ["/api/public-catalog", "assets/data/catalog.json", LEGACY_STATIC_CATALOG_URL];
    }
    return ["assets/data/catalog.json", LEGACY_STATIC_CATALOG_URL];
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
