/*
 * NAPL — COVER IMAGE LOADER & FALLBACK HELPER
 *
 * Serves pre-optimized static WebP covers from GitHub Pages (assets/covers/),
 * falls back to wsrv.nl WebP optimization for newly added covers pending the
 * next GitHub Actions run, and recovers vertical Steam artwork when CDN hosts
 * fail to respond.
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
} from "./image-cache.js";

function isLocalPreviewHost() {
    if (typeof window === "undefined") return false;
    const host = String(window.location.hostname || "").toLowerCase();
    return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".run.app")
    );
}

let coverManifestPromise = null;
async function getStaticCoverUrl(rawUrl) {
    const cleanRaw = String(rawUrl || "").trim();
    if (!cleanRaw || typeof window === "undefined") return "";
    try {
        if (!coverManifestPromise) {
            const manifestUrl = new URL("assets/covers/manifest.json", window.location.href).toString();
            coverManifestPromise = fetch(manifestUrl, { cache: "force-cache" })
                .then((response) => (response.ok ? response.json() : {}))
                .catch(() => ({}));
        }
        const manifest = await coverManifestPromise;
        const mapped = String(manifest?.covers?.[cleanRaw] || "").trim();
        if (!mapped) return "";
        return new URL(mapped, window.location.href).toString();
    } catch {
        return "";
    }
}

const OPTIMIZABLE_COVER_HOSTS = new Set([
    "images.launchbox-app.com",
    "gamesdb-images.launchbox.gg",
    "shared.fastly.steamstatic.com",
    "shared.akamai.steamstatic.com",
    "cdn.akamai.steamstatic.com",
    "cdn.cloudflare.steamstatic.com",
    "steamcdn-a.akamaihd.net",
    "img.itch.zone",
    "itch.zone",
    "static.itch.io",
    "cdn2.steamgriddb.com",
]);

export function getOptimizedCoverUrl(rawUrl, width = 180) {
    try {
        const source = new URL(String(rawUrl || "").trim());
        if (
            !["http:", "https:"].includes(source.protocol) ||
            !OPTIMIZABLE_COVER_HOSTS.has(source.hostname.toLowerCase())
        ) {
            return "";
        }
        source.protocol = "https:";
        const optimized = new URL("https://wsrv.nl/");
        optimized.searchParams.set("url", source.toString());
        optimized.searchParams.set("output", "webp");
        optimized.searchParams.set("w", String(width));
        optimized.searchParams.set("q", "82");
        return optimized.toString();
    } catch {
        return "";
    }
}

function extractSteamAppId(coverUrl) {
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
        ...(isLocalPreviewHost() ? [`/api/steam-cover/${encodeURIComponent(appId)}`] : []),
        `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_capsule_2x.jpg`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_capsule.jpg`,
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

function attachCoverFallback(
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

export async function loadOptimizedCoverImage(
    imgElement,
    coverUrl,
    onUnavailable,
    width = 180
) {
    const rawUrl = String(coverUrl || "").trim();
    const staticUrl = await getStaticCoverUrl(rawUrl);
    if (staticUrl) {
        const fallbackUrl = getOptimizedCoverUrl(rawUrl, width) || rawUrl;
        return loadCoverImage(imgElement, staticUrl, () =>
            loadCoverImage(imgElement, fallbackUrl, () =>
                loadCoverImage(imgElement, rawUrl, onUnavailable)
            )
        );
    }
    const optimizedUrl = getOptimizedCoverUrl(rawUrl, width);
    if (optimizedUrl) {
        return loadCoverImage(imgElement, optimizedUrl, () =>
            loadCoverImage(imgElement, rawUrl, onUnavailable)
        );
    }
    return loadCoverImage(imgElement, rawUrl, onUnavailable);
}
