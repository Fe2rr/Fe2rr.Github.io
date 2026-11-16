/*
 * NAPL — POPULARITY SERVICE
 *
 * Popular rankings are served by the Google Apps Script web app.
 * Popular and All Time category sorting are handled independently
 * through the Apps Script endpoint.
 */

import { createSlug } from "../core/helpers.js";

const POPULAR_URL =
    "https://script.google.com/macros/s/AKfycbxio6DGpBJRkYdceeFVXk3gSOFcBe5KZJtHU8F2j66DDYx_G_az01p7rnsuCq0KPHY/exec";

const popularByPeriod = new Map();
const popularPromises = new Map();
let callbackSequence = 0;

/**
 * Load a popularity period through JSONP.
 * Apps Script supports JSONP and can therefore be called from GitHub Pages
 * without a CORS proxy.
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

export async function ensurePopularPeriod(period = "alltime") {
    const normalizedPeriod = String(period || "alltime").trim().toLowerCase();
    if (popularByPeriod.has(normalizedPeriod)) {
        return popularByPeriod.get(normalizedPeriod);
    }

    if (popularPromises.has(normalizedPeriod)) {
        return popularPromises.get(normalizedPeriod);
    }

    const promise = fetchPopularPeriod(normalizedPeriod)
        .then((items) => {
            const periodMap = new Map();

            for (const item of items) {
                const visits = Number(item.visits) || 0;
                const apiSlug = createSlug(item.slug || "");
                const gameSlug = createSlug(item.game || "");
                if (apiSlug) {
                    periodMap.set(apiSlug, Math.max(periodMap.get(apiSlug) || 0, visits));
                }
                if (gameSlug) {
                    periodMap.set(gameSlug, Math.max(periodMap.get(gameSlug) || 0, visits));
                }
            }

            popularByPeriod.set(normalizedPeriod, periodMap);
            return periodMap;
        })
        .catch((error) => {
            console.warn(`Could not load ${normalizedPeriod} popularity:`, error);
            return new Map();
        })
        .finally(() => {
            popularPromises.delete(normalizedPeriod);
        });

    popularPromises.set(normalizedPeriod, promise);
    return promise;
}

export function getPopularVisits(slug, period = "alltime") {
    const normalizedPeriod = String(period || "alltime").trim().toLowerCase();
    return popularByPeriod.get(normalizedPeriod)?.get(slug) || 0;
}

export async function ensureAllTimePopular() {
    return ensurePopularPeriod("alltime");
}

export function getAllTimeVisits(slug) {
    return getPopularVisits(slug, "alltime");
}
