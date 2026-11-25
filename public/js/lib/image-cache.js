/*
 * NAPL — BROWSER-SIDE COVER IMAGE CACHE
 *
 * Multi-layer browser caching for retrieved cover images:
 *  1. In-memory ObjectURL + in-flight request deduplication (instant across re-renders)
 *  2. Persistent CacheStorage (`napl-cover-images-v1`) for CORS/same-origin binaries
 *  3. Persistent localStorage mapping of broken URLs -> resolved working URLs
 */

const IMAGE_CACHE_NAME = "napl-cover-images-v1";
const RESOLVED_URL_STORAGE_KEY = "napl_resolved_covers_v1";
const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_RESOLVED_URL_ENTRIES = 400;
const MAX_MEMORY_BLOB_ENTRIES = 200;
const MAX_CACHE_STORAGE_ENTRIES = 250;

const memoryBlobUrls = new Map();
const inFlightFetches = new Map();
const memoryResolvedUrls = new Map();
const sessionFailedUrls = new Set();

let resolvedStorageLoaded = false;
let resolvedStorageStore = {};

function loadResolvedStorage() {
    if (resolvedStorageLoaded) return resolvedStorageStore;
    resolvedStorageLoaded = true;

    try {
        const raw = localStorage.getItem(RESOLVED_URL_STORAGE_KEY);
        if (!raw) {
            resolvedStorageStore = {};
            return resolvedStorageStore;
        }
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const now = Date.now();
            const cleaned = {};
            for (const [key, entry] of Object.entries(parsed)) {
                if (
                    entry &&
                    typeof entry.url === "string" &&
                    Number.isFinite(entry.updatedAt) &&
                    now - entry.updatedAt < IMAGE_CACHE_TTL_MS
                ) {
                    cleaned[key] = entry;
                    memoryResolvedUrls.set(key, entry.url);
                }
            }
            resolvedStorageStore = cleaned;
        }
    } catch {
        resolvedStorageStore = {};
    }

    return resolvedStorageStore;
}

function saveResolvedStorage() {
    try {
        const entries = Object.entries(resolvedStorageStore);
        if (entries.length > MAX_RESOLVED_URL_ENTRIES) {
            entries.sort(
                (a, b) => (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0)
            );
            const trimmed = entries.slice(
                entries.length - MAX_RESOLVED_URL_ENTRIES
            );
            resolvedStorageStore = Object.fromEntries(trimmed);
        }
        localStorage.setItem(
            RESOLVED_URL_STORAGE_KEY,
            JSON.stringify(resolvedStorageStore)
        );
    } catch {
        // Ignore storage quota or private-mode errors
    }
}

export function getCachedResolvedCoverUrl(originalUrl) {
    const key = String(originalUrl || "").trim();
    if (!key) return "";

    if (memoryResolvedUrls.has(key)) {
        return memoryResolvedUrls.get(key) || "";
    }

    const store = loadResolvedStorage();
    const entry = store[key];
    if (entry && typeof entry.url === "string") {
        if (Date.now() - (entry.updatedAt || 0) < IMAGE_CACHE_TTL_MS) {
            memoryResolvedUrls.set(key, entry.url);
            return entry.url;
        }
        delete store[key];
        saveResolvedStorage();
    }

    return "";
}

export function setCachedResolvedCoverUrl(originalUrl, resolvedUrl) {
    const key = String(originalUrl || "").trim();
    const val = String(resolvedUrl || "").trim();
    if (!key || !val) return;

    memoryResolvedUrls.set(key, val);
    const store = loadResolvedStorage();
    store[key] = {
        url: val,
        updatedAt: Date.now(),
    };
    saveResolvedStorage();
}

export function markCoverUrlFailed(url) {
    const key = String(url || "").trim();
    if (key) sessionFailedUrls.add(key);
}

export function isCoverUrlFailed(url) {
    const key = String(url || "").trim();
    return Boolean(key && sessionFailedUrls.has(key));
}

export function isCacheableImageUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return false;

    if (raw.startsWith("/api/steam-cover/")) {
        return true;
    }

    try {
        const parsed = new URL(raw, window.location.href);
        if (parsed.origin === window.location.origin) {
            return true;
        }
        const host = parsed.hostname.toLowerCase();
        return (
            /(?:^|\.)steamstatic\.com$/i.test(host) ||
            host === "napl-image-optimizer.federicoxastro.workers.dev"
        );
    } catch {
        return false;
    }
}

export function getMemoryCachedImageSrc(url) {
    const key = String(url || "").trim();
    return key ? memoryBlobUrls.get(key) || "" : "";
}

function storeMemoryBlobUrl(url, blobUrl) {
    if (memoryBlobUrls.has(url)) {
        return memoryBlobUrls.get(url);
    }
    if (memoryBlobUrls.size >= MAX_MEMORY_BLOB_ENTRIES) {
        const oldestKey = memoryBlobUrls.keys().next().value;
        const oldestVal = memoryBlobUrls.get(oldestKey);
        memoryBlobUrls.delete(oldestKey);
        if (oldestVal && typeof URL?.revokeObjectURL === "function") {
            URL.revokeObjectURL(oldestVal);
        }
    }
    memoryBlobUrls.set(url, blobUrl);
    return blobUrl;
}

async function trimCacheStorage(cache) {
    try {
        const keys = await cache.keys();
        if (keys.length <= MAX_CACHE_STORAGE_ENTRIES) return;
        const overflow = keys.length - MAX_CACHE_STORAGE_ENTRIES;
        for (let i = 0; i < overflow; i++) {
            await cache.delete(keys[i]);
        }
    } catch {
        // Ignore cache eviction errors
    }
}

export function supportsBrowserImageCache() {
    return (
        typeof window !== "undefined" &&
        "caches" in window &&
        typeof URL?.createObjectURL === "function"
    );
}

export async function getCachedOrFetchImageSrc(url) {
    const key = String(url || "").trim();
    if (!key || !isCacheableImageUrl(key) || !supportsBrowserImageCache()) {
        return null;
    }

    const memHit = memoryBlobUrls.get(key);
    if (memHit) return memHit;

    if (inFlightFetches.has(key)) {
        return inFlightFetches.get(key);
    }

    const fetchPromise = (async () => {
        try {
            let cache = null;
            try {
                cache = await window.caches.open(IMAGE_CACHE_NAME);
            } catch {
                cache = null;
            }

            const cachedResponse = cache ? await cache.match(key) : null;

            if (cachedResponse) {
                const cachedAt = Number(
                    cachedResponse.headers.get("X-Napl-Cached-At") || 0
                );
                const isFresh =
                    !cachedAt || Date.now() - cachedAt < IMAGE_CACHE_TTL_MS;
                const contentType =
                    cachedResponse.headers.get("content-type") || "";
                if (isFresh && contentType.toLowerCase().startsWith("image/")) {
                    const blob = await cachedResponse.blob();
                    if (blob.size > 0) {
                        return storeMemoryBlobUrl(
                            key,
                            URL.createObjectURL(blob)
                        );
                    }
                }
                if (cache) {
                    await cache.delete(key);
                }
            }

            const isSameOrigin = key.startsWith("/");
            const response = await fetch(key, {
                method: "GET",
                mode: isSameOrigin ? "same-origin" : "cors",
                referrerPolicy: "no-referrer",
            });

            const contentType = response.headers.get("content-type") || "";
            if (
                !response.ok ||
                !contentType.toLowerCase().startsWith("image/")
            ) {
                return null;
            }

            const blob = await response.blob();
            if (!blob || blob.size === 0) {
                return null;
            }

            if (cache) {
                try {
                    const headers = new Headers(response.headers);
                    headers.set("X-Napl-Cached-At", String(Date.now()));
                    const cachedRes = new Response(blob.slice(0), {
                        status: 200,
                        statusText: "OK",
                        headers,
                    });
                    await cache.put(key, cachedRes);
                    trimCacheStorage(cache);
                } catch {
                    // Continue returning ObjectURL even if CacheStorage write fails
                }
            }

            return storeMemoryBlobUrl(key, URL.createObjectURL(blob));
        } catch {
            return null;
        } finally {
            inFlightFetches.delete(key);
        }
    })();

    inFlightFetches.set(key, fetchPromise);
    return fetchPromise;
}
