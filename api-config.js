/*
 * THE PORTS VAULT — API LOCATION (ES module)
 * Keep in sync with API_BASE in config.js (classic scripts on index.html).
 */

export const API_BASE =
    window.location.hostname === "localhost"
        ? "http://localhost:8787"
        : "https://ports-ratings-worker.federicoxastro.workers.dev";
