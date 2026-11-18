/*
 * NAPL — COVER IMAGE LOADER & FALLBACK HELPER
 *
 * Recovers Steam covers when newer AppIDs use hashed asset paths or
 * when a specific Steam CDN host fails to respond, and caches both
 * resolved URLs and retrieved image binaries in the browser.
 */

import {
    getCachedResolvedCoverUrl,
    setCachedResolvedCoverUrl,
    markCoverUrlFailed,
    isCoverUrlFailed,
    isCacheableImageUrl,
    getMemoryCachedImageSrc,
    supportsBrowserImageCache,
    getCachedOrFetchImageSrc,
} from "./image-cache.js?v=1";

export function extractSteamAppId(coverUrl) {
    const raw = String(coverUrl || "").trim();
    if (!raw) return "";

    const pathMatch = raw.match(/\/steam\/apps\/(\d+)\//i);
    if (pathMatch) return pathMatch[1];

    const apiMatch = raw.match(/\/api\/steam-cover\/(\d+)/i);
    if (apiMatch) return apiMatch[1];

    const storeMatch = raw.match(/store\.steampowered\.com\/app\/(\d+)/i);
    if (storeMatch) return storeMatch[1];

    return "";
}

function buildSteamFallbackUrls(appId, excludeUrls = []) {
    if (!appId) return [];

    const excluded = new Set(
        excludeUrls.map((u) => String(u || "").trim()).filter(Boolean)
    );
    const candidates = [
        `/api/steam-cover/${encodeURIComponent(appId)}`,
        `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_capsule.jpg`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    ];

    return candidates.filter((candidate) => !excluded.has(candidate));
}

function buildCoverCandidates(rawUrl, effectiveUrl) {
    const appId =
        extractSteamAppId(rawUrl) || extractSteamAppId(effectiveUrl);
    const ordered = [effectiveUrl];
    const fallbacks = buildSteamFallbackUrls(appId, [effectiveUrl, rawUrl]);

    for (const url of fallbacks) {
        if (!ordered.includes(url)) {
            ordered.push(url);
        }
    }

    if (effectiveUrl !== rawUrl && rawUrl && !ordered.includes(rawUrl)) {
        ordered.push(rawUrl);
    }

    return ordered;
}

export function attachCoverFallback(
    imgElement,
    coverUrl,
    onUnavailable,
    originalCoverUrl = coverUrl
) {
    if (!imgElement) return;

    const baseKey = String(originalCoverUrl || coverUrl || "").trim();
    const initialUrl = String(coverUrl || "").trim();
    const appId = extractSteamAppId(baseKey) || extractSteamAppId(initialUrl);
    const fallbacks = buildSteamFallbackUrls(appId, [initialUrl]);
    let activeUrl = initialUrl;
    let fallbackIndex = 0;

    function handleLoad() {
        imgElement.removeEventListener("error", handleError);
        if (baseKey && activeUrl && activeUrl !== baseKey) {
            setCachedResolvedCoverUrl(baseKey, activeUrl);
        }
    }

    function handleError() {
        if (fallbackIndex < fallbacks.length) {
            activeUrl = fallbacks[fallbackIndex++];
            imgElement.src = activeUrl;
            return;
        }

        imgElement.removeEventListener("error", handleError);
        imgElement.removeEventListener("load", handleLoad);
        if (baseKey) {
            markCoverUrlFailed(baseKey);
        }
        if (typeof onUnavailable === "function") {
            onUnavailable();
        }
    }

    imgElement.addEventListener("load", handleLoad, { once: true });
    imgElement.addEventListener("error", handleError);
}

export async function loadCoverImage(imgElement, coverUrl, onUnavailable) {
    const rawUrl = String(coverUrl || "").trim();
    if (!imgElement || !rawUrl) {
        if (typeof onUnavailable === "function") {
            onUnavailable();
        }
        return;
    }

    if (isCoverUrlFailed(rawUrl)) {
        if (typeof onUnavailable === "function") {
            onUnavailable();
        }
        return;
    }

    const cachedResolved = getCachedResolvedCoverUrl(rawUrl);
    const effectiveUrl = cachedResolved || rawUrl;

    // Fast synchronous hit from in-memory ObjectURL map (zero flicker)
    const memoryHit = getMemoryCachedImageSrc(effectiveUrl);
    if (memoryHit) {
        imgElement.src = memoryHit;
        return;
    }

    // Use CacheStorage + fetch deduplication for same-origin and CORS-enabled CDNs
    if (supportsBrowserImageCache() && isCacheableImageUrl(effectiveUrl)) {
        const candidates = buildCoverCandidates(rawUrl, effectiveUrl).filter(
            (candidate) => isCacheableImageUrl(candidate)
        );

        for (const candidate of candidates) {
            const cachedSrc =
                getMemoryCachedImageSrc(candidate) ||
                (await getCachedOrFetchImageSrc(candidate));

            if (cachedSrc) {
                if (candidate !== rawUrl) {
                    setCachedResolvedCoverUrl(rawUrl, candidate);
                }

                imgElement.addEventListener(
                    "error",
                    () => {
                        markCoverUrlFailed(rawUrl);
                        if (typeof onUnavailable === "function") {
                            onUnavailable();
                        }
                    },
                    { once: true }
                );

                imgElement.src = cachedSrc;
                return;
            }
        }

        markCoverUrlFailed(rawUrl);
        if (typeof onUnavailable === "function") {
            onUnavailable();
        }
        return;
    }

    // Standard browser HTTP cache path for non-CORS hosts (e.g., LaunchBox CDN)
    attachCoverFallback(imgElement, effectiveUrl, onUnavailable, rawUrl);
    imgElement.src = effectiveUrl;
}

