/*
 * NAPL — POPULARITY SERVICE
 *
 * Popular rankings are served by the Google Apps Script web app.
 * This keeps Popular and All Time category sorting independent
 * from Cloudflare D1 read limits.
 */

import { createSlug } from "../core/helpers.js";

const POPULAR_URL =
    "https://script.google.com/macros/s/AKfycbxio6DGpBJRkYdceeFVXk3gSOFcBe5KZJtHU8F2j66DDYx_G_az01p7rnsuCq0KPHY/exec";

const allTimePopular = new Map();
let allTimePopularLoaded = false;
let allTimePopularPromise = null;
let callbackSequence = 0;

/**
 * Load a popularity period through JSONP.
 * Apps Script supports JSONP and can therefore be called from GitHub Pages
 * without a CORS proxy or a Cloudflare D1 read.
 */
function requestPopular(period) {
    return new Promise((resolve, reject) => {
        if (typeof document === "undefined" || typeof window === "undefined") {
            reject(new Error("Popularity service is only available in a browser."));
            return;
        }

        const callbackName =
            `naplPopularCallback_${Date.now()}_${++callbackSequence}`;
        const script = document.createElement("script");
        let timeoutId = null;
        let settled = false;

        const cleanup = () => {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
            delete window[callbackName];
            script.onerror = null;
            script.remove();
        };

        const finish = (error, data) => {
            if (settled) return;
            settled = true;
            cleanup();

            if (error) {
                reject(error);
                return;
            }

            if (!data?.success || !Array.isArray(data.games)) {
                reject(new Error(data?.error || "Invalid popularity response."));
                return;
            }

            resolve(data.games);
        };

        window[callbackName] = (data) => finish(null, data);

        script.async = true;
        script.src =
            `${POPULAR_URL}?popular=${encodeURIComponent(period)}&callback=${callbackName}`;

        script.onerror = () => {
            finish(new Error("Could not load popular games from Apps Script."));
        };

        timeoutId = window.setTimeout(() => {
            finish(new Error("Popularity request timed out."));
        }, 15000);

        document.head.appendChild(script);
    });
}

export async function fetchPopularPeriod(period = "week") {
    return requestPopular(period);
}

export async function ensureAllTimePopular() {
    if (allTimePopularLoaded) {
        return allTimePopular;
    }

    if (allTimePopularPromise) {
        return allTimePopularPromise;
    }

    allTimePopularPromise = fetchPopularPeriod("alltime")
        .then((items) => {
            allTimePopular.clear();

            for (const item of items) {
                const key = createSlug(item.game || item.slug || "");
                if (!key) continue;

                allTimePopular.set(key, Number(item.visits) || 0);
            }

            allTimePopularLoaded = true;
            return allTimePopular;
        })
        .catch((error) => {
            console.warn("Could not load All Time popularity:", error);
            return allTimePopular;
        })
        .finally(() => {
            allTimePopularPromise = null;
        });

    return allTimePopularPromise;
}

export function getAllTimeVisits(slug) {
    return allTimePopular.get(slug) || 0;
}
