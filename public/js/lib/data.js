/*
 * NAPL — PUBLIC CATALOG LOADER
 *
 * The catalog is fetched from the published static JSON on every page load.
 * No offline copy or browser-side catalog cache is maintained.
 */

import { hydrateCatalog } from "./catalog-schema.js";
import { resolveCatalogApiBase } from "./config.js";

let catalogPromise = null;

function isLocalPreviewHost() {
    if (typeof window === "undefined") return false;
    const host = String(window.location.hostname || "").toLowerCase();
    return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".run.app")
    );
}

function getCatalogUrls() {
    const staticCatalogUrl = new URL(
        "../../assets/data/catalog.json",
        import.meta.url
    ).toString();
    const mode = resolveCatalogApiBase();
    if (!mode || isLocalPreviewHost()) {
        return ["/api/public-catalog", staticCatalogUrl];
    }
    return [staticCatalogUrl];
}

async function fetchStaticJsonCatalog() {
    const urls = getCatalogUrls();
    let lastError = null;

    for (const url of urls) {
        try {
            const response = await fetch(url, {
                method: "GET",
                cache: "default",
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
