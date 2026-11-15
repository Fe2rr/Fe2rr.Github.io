/*
 * NAPL — COMPATIBILITY SERVICE
 *
 * Manages Works? Yes/No reports paired with strict Android device selection
 * from the AndroidDeviceNames database (public/assets/data/devices.json).
 */

import {
    COMPATIBILITY_API_URL,
    REPORT_LINK_API_URL,
    USER_DEVICE_STORAGE_KEY,
} from "../core/config.js";
import { getRatingToken } from "./ratings.js";

let devicesCache = null;
let devicesPromise = null;

const COMPATIBILITY_CACHE_PREFIX = "napl_compatibility_v1:";
const COMPATIBILITY_CACHE_TTL = 60_000;

function readCachedCompatibility(portId) {
    try {
        const raw = localStorage.getItem(COMPATIBILITY_CACHE_PREFIX + portId);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (
            !cached ||
            typeof cached.savedAt !== "number" ||
            Date.now() - cached.savedAt > COMPATIBILITY_CACHE_TTL ||
            !cached.value ||
            typeof cached.value !== "object"
        ) {
            localStorage.removeItem(COMPATIBILITY_CACHE_PREFIX + portId);
            return null;
        }
        return cached.value;
    } catch {
        return null;
    }
}

function writeCachedCompatibility(data) {
    try {
        for (const [portId, value] of Object.entries(data || {})) {
            localStorage.setItem(
                COMPATIBILITY_CACHE_PREFIX + portId,
                JSON.stringify({ savedAt: Date.now(), value })
            );
        }
    } catch {
        // Storage may be unavailable or full; the API response still works.
    }
}

export async function loadDevices() {
    if (devicesCache) {
        return devicesCache;
    }

    if (!devicesPromise) {
        devicesPromise = (async () => {
            // Device data is served by the Supabase compatibility Edge Function.
            const response = await fetch(
                `${COMPATIBILITY_API_URL}?action=devices`,
                { cache: "force-cache" }
            );
            if (!response.ok) {
                throw new Error(
                    `Could not load device database (HTTP ${response.status}).`
                );
            }
            const payload = await response.json();
            const data = payload?.devices;
            if (!Array.isArray(data)) {
                throw new Error("Device database returned an invalid format.");
            }
            devicesCache = data.map((d) => ({
                id: String(d.id || ""),
                name: String(d.name || ""),
                lower: String(d.name || "").toLowerCase(),
            }));
            return devicesCache;
        })();
    }

    try {
        return await devicesPromise;
    } catch (error) {
        devicesPromise = null;
        throw error;
    }
}

export function searchDevices(devices, query, limit = 25) {
    const clean = String(query || "").trim().toLowerCase();
    if (!clean) return [];

    const terms = clean.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const startsWithMatches = [];
    const otherMatches = [];

    for (const device of devices) {
        let allMatch = true;
        for (const term of terms) {
            if (!device.lower.includes(term)) {
                allMatch = false;
                break;
            }
        }
        if (!allMatch) continue;

        if (device.lower.startsWith(clean)) {
            startsWithMatches.push(device);
        } else {
            otherMatches.push(device);
        }

        if (
            startsWithMatches.length >= limit &&
            otherMatches.length >= limit
        ) {
            break;
        }
    }

    return [...startsWithMatches, ...otherMatches].slice(0, limit);
}

export function getStoredUserDevice() {
    try {
        const raw = localStorage.getItem(USER_DEVICE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
            parsed &&
            typeof parsed.id === "string" &&
            parsed.id.trim() &&
            typeof parsed.name === "string" &&
            parsed.name.trim()
        ) {
            return { id: parsed.id, name: parsed.name };
        }
    } catch {
        // Ignore storage read errors
    }
    return null;
}

export function setStoredUserDevice(device) {
    try {
        if (!device) {
            localStorage.removeItem(USER_DEVICE_STORAGE_KEY);
            return;
        }
        localStorage.setItem(
            USER_DEVICE_STORAGE_KEY,
            JSON.stringify({ id: device.id, name: device.name })
        );
    } catch {
        // Ignore storage write errors
    }
}

export async function loadGameCompatibility(portIds, fresh = false) {
    const cleanIds = Array.from(
        new Set(
            (portIds || []).map((id) => String(id || "").trim()).filter(Boolean)
        )
    );

    if (cleanIds.length === 0) {
        return {};
    }

    const cached = {};
    const missingIds = [];

    if (!fresh) {
        for (const id of cleanIds) {
            const value = readCachedCompatibility(id);
            if (value) cached[id] = value;
            else missingIds.push(id);
        }
        if (missingIds.length === 0) return cached;
    }

    const requestedIds = fresh ? cleanIds : missingIds;

    try {
        const params = new URLSearchParams({
            port_ids: requestedIds.join(","),
        });
        if (fresh) params.set("fresh", "1");
        const response = await fetch(
            `${COMPATIBILITY_API_URL}?${params.toString()}`,
            {
                method: "GET",
                cache: "default",
            }
        );

        if (!response.ok) {
            throw new Error(
                `Compatibility API returned HTTP ${response.status}.`
            );
        }

        const data = await response.json();
        if (!data || typeof data.compatibility !== "object") {
            return cached;
        }

        writeCachedCompatibility(data.compatibility);
        return { ...cached, ...data.compatibility };
    } catch (error) {
        console.warn("NAPL: could not load compatibility reports.", error);
        return cached;
    }
}

export function createCompatibilityActions() {
    return {
        async loadSummary(portId) {
            const summaries = await loadGameCompatibility([portId]);
            return summaries[portId] || null;
        },

        async submitReport({ portId, deviceId, works }) {
            const token = await getRatingToken();

            const response = await fetch(COMPATIBILITY_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    token,
                    port_id: portId,
                    device_id: deviceId,
                    works: Boolean(works),
                }),
                cache: "no-store",
            });

            const raw = await response.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                throw new Error(
                    "The compatibility server returned an invalid response."
                );
            }

            if (!response.ok || !data.success) {
                throw new Error(
                    data.error ||
                        `Compatibility server error (HTTP ${response.status}).`
                );
            }

            const refreshed = await loadGameCompatibility([portId], true);
            return {
                report: data.report,
                summary: refreshed[portId] || null,
            };
        },

        async reportBrokenLink({ portId, reason, url }) {
            const token = await getRatingToken();

            const response = await fetch(REPORT_LINK_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    token,
                    port_id: portId,
                    reason,
                    url,
                }),
                cache: "no-store",
            });

            const raw = await response.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                throw new Error(
                    "The report server returned an invalid response."
                );
            }

            if (!response.ok || !data.success) {
                const error = new Error(
                    data.error ||
                        `Report server error (HTTP ${response.status}).`
                );
                error.retryAfterSeconds = Number(data.retry_after_seconds) || 0;
                throw error;
            }

            return data;
        },
    };
}
