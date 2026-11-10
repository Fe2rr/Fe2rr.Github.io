/*
 * THE PORTS VAULT — TEXT HELPERS (ES module)
 *
 * Keep createSlug identical to the API (ports-ratings-worker
 * src/lib/text.js): game.html?game=<slug> depends on it.
 */

export function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

export function createSlug(name) {
    return normalizeText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
