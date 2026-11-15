/*
 * NAPL — VISIT TRACKING SERVICE
 *
 * Visits are recorded through the Google Apps Script web app,
 * which stores the counters in Google Sheets.
 */

import { createSlug } from "../core/helpers.js";

const VISIT_TRACKING_URL =
    "https://script.google.com/macros/s/AKfycbxio6DGpBJRkYdceeFVXk3gSOFcBe5KZJtHU8F2j66DDYx_G_az01p7rnsuCq0KPHY/exec";

export function registerGameVisit(gameName) {
    if (!gameName) return;

    const slug = createSlug(gameName);
    if (!slug) return;

    const url = new URL(VISIT_TRACKING_URL);
    url.searchParams.set("game", slug);
    url.searchParams.set("_", String(Date.now()));

    fetch(url.toString(), {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        keepalive: true,
    }).catch((error) => {
        console.warn("NAPL: could not send the game visit.", error);
    });
}
