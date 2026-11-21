/*
 * NAPL — GAME SPOTLIGHT COMPONENT
 *
 * Randomly cycles through trending and popular cover-backed ports
 * on idle while offering manual Previous / Next navigation.
 */

import {
    getRepresentativePort,
    getPortDisplayName,
    getGamePlatformLabel,
} from "./game-card.js";
import { loadCoverImage } from "../lib/cover-fallback.js";
import {
    getCachedResolvedCoverUrl,
    getMemoryCachedImageSrc,
    isCacheableImageUrl,
    isCoverUrlFailed,
    getCachedOrFetchImageSrc,
} from "../lib/image-cache.js";
import {
    ensurePopularPeriod,
    ensureAllTimePopular,
    getPopularVisits,
} from "../lib/popularity.js";
import {
    parseDateAdded,
    parseLastUpdate,
    clearHeroViewTransitions,
} from "../lib/helpers.js";

const SPOTLIGHT_INTERVAL_MS = 8000;
const POPULARITY_RACE_MS = 1100;
const MAX_SPOTLIGHT_POOL = 28;
const MAX_FALLBACK_SCAN = 120;

function hasValidCoverUrl(game) {
    const url = String(game?.coverUrl || "").trim();
    return /^https?:\/\/\S+$/i.test(url) && !isCoverUrlFailed(url);
}

function shuffleInPlace(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

function buildFallbackPool(games) {
    const candidates = [];

    for (const game of games) {
        if (!hasValidCoverUrl(game)) continue;
        if (!Array.isArray(game.ports) || game.ports.length === 0) continue;

        const port = getRepresentativePort(game);
        if (!port) continue;

        const hasDescription = Boolean(String(game.description || "").trim());
        const portCount = game.ports.length;
        const latestDate = game.ports.reduce((latest, p) => {
            const d = parseLastUpdate(p?.lastUpdate) || parseDateAdded(p?.dateAdded);
            if (!d) return latest;
            return !latest || d > latest ? d : latest;
        }, null);

        const recencyScore = latestDate ? latestDate.getTime() / 1e12 : 0;
        const score =
            (hasDescription ? 10 : 0) +
            Math.min(portCount, 5) * 2 +
            recencyScore;

        candidates.push({
            game,
            port,
            score,
            isTrending: false,
        });
    }

    candidates.sort((a, b) => b.score - a.score);
    const pool = candidates.slice(0, MAX_FALLBACK_SCAN);
    shuffleInPlace(pool);
    return pool.slice(0, MAX_SPOTLIGHT_POOL);
}

function buildTrendingPool(games) {
    const scored = [];

    for (const game of games) {
        if (!hasValidCoverUrl(game)) continue;
        if (!Array.isArray(game.ports) || game.ports.length === 0) continue;

        const port = getRepresentativePort(game);
        if (!port) continue;

        const weeklyVisits = getPopularVisits(game.slug, "week");
        const allTimeVisits = getPopularVisits(game.slug, "alltime");
        if (weeklyVisits <= 0 && allTimeVisits <= 0) continue;

        const score = weeklyVisits * 4 + allTimeVisits;
        scored.push({
            game,
            port,
            score,
            isTrending: weeklyVisits > 0,
        });
    }

    if (scored.length === 0) {
        return [];
    }

    scored.sort((a, b) => b.score - a.score);
    const topTier = scored.slice(0, MAX_SPOTLIGHT_POOL);
    shuffleInPlace(topTier);
    return topTier;
}

function preloadSpotlightCover(game) {
    const rawUrl = String(game?.coverUrl || "").trim();
    if (!rawUrl || isCoverUrlFailed(rawUrl)) return;

    const effectiveUrl = getCachedResolvedCoverUrl(rawUrl) || rawUrl;
    if (getMemoryCachedImageSrc(effectiveUrl)) return;

    if (isCacheableImageUrl(effectiveUrl)) {
        getCachedOrFetchImageSrc(effectiveUrl);
        return;
    }

    const preloader = new Image();
    preloader.referrerPolicy = "no-referrer";
    preloader.decoding = "async";
    preloader.src = effectiveUrl;
}

export function createSpotlightController() {
    const section = document.getElementById("game-spotlight");
    const skeleton = document.getElementById("spotlight-skeleton");
    const card = document.getElementById("spotlight-card");
    const backdropImg = document.getElementById("spotlight-backdrop");
    const coverFrame = document.getElementById("spotlight-cover-frame");
    const coverImg = document.getElementById("spotlight-cover");
    const kickerEl = card?.querySelector(".spotlight-kicker") || null;
    const metaEl = document.getElementById("spotlight-meta");
    const titleLink = document.getElementById("spotlight-title-link");
    const portLineEl = document.getElementById("spotlight-port-line");
    const prevButton = document.getElementById("spotlight-prev");
    const nextButton = document.getElementById("spotlight-next");
    const progressTrack = document.getElementById("spotlight-progress");
    const progressBar = document.getElementById("spotlight-progress-bar");

    let catalogGames = [];
    let queue = [];
    let currentIndex = 0;
    let isVisible =
        document.documentElement.getAttribute("data-spotlight") !== "hidden";
    let isHovering = false;
    let hasFocusWithin = false;
    let isInViewport = true;
    let timerId = 0;
    let remainingMs = SPOTLIGHT_INTERVAL_MS;
    let cycleStartedAt = 0;
    let progressAnimation = null;
    let renderToken = 0;
    let popularityHydrated = false;
    let hasResolvedPool = false;
    let userManuallyStepped = false;
    let swapResetTimer = 0;

    const reducedMotionQuery = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
    );

    function syncProgressVisibility() {
        if (!progressTrack) return;
        const shouldHide = Boolean(
            !section ||
                !card ||
                card.hidden ||
                !isVisible ||
                queue.length <= 1 ||
                reducedMotionQuery?.matches
        );
        progressTrack.hidden = shouldHide;
        if (shouldHide) {
            progressTrack.classList.remove("is-paused");
        }
    }

    function stopProgressAnimation() {
        if (progressAnimation) {
            progressAnimation.cancel();
            progressAnimation = null;
        }
        if (progressBar) {
            progressBar.style.transform = "scaleX(0)";
        }
        progressTrack?.classList.remove("is-paused");
    }

    function startProgressAnimation(startFraction, durationMs) {
        if (!progressBar) return;
        if (progressAnimation) {
            progressAnimation.cancel();
            progressAnimation = null;
        }
        progressTrack?.classList.remove("is-paused");

        if (typeof progressBar.animate === "function") {
            progressAnimation = progressBar.animate(
                [
                    { transform: `scaleX(${startFraction})` },
                    { transform: "scaleX(1)" },
                ],
                {
                    duration: durationMs,
                    easing: "linear",
                    fill: "forwards",
                }
            );
        } else {
            progressBar.style.transform = `scaleX(${startFraction})`;
        }
    }

    function clearIdleTimer({ resetProgress = false } = {}) {
        if (timerId) {
            window.clearTimeout(timerId);
            timerId = 0;
        }
        cycleStartedAt = 0;
        if (resetProgress) {
            remainingMs = SPOTLIGHT_INTERVAL_MS;
            stopProgressAnimation();
        }
    }

    function pauseIdleCycle() {
        if (timerId && cycleStartedAt > 0) {
            const elapsed = performance.now() - cycleStartedAt;
            remainingMs = Math.max(250, remainingMs - elapsed);
        }
        clearIdleTimer();
        if (progressAnimation) {
            progressAnimation.pause();
        }
        if (progressTrack && !progressTrack.hidden) {
            progressTrack.classList.add("is-paused");
        }
    }

    function canAutoCycle() {
        return Boolean(
            section &&
                card &&
                !card.hidden &&
                isVisible &&
                !isHovering &&
                !hasFocusWithin &&
                isInViewport &&
                !document.hidden &&
                queue.length > 1 &&
                !reducedMotionQuery?.matches
        );
    }

    function scheduleIdleCycle() {
        clearIdleTimer();
        syncProgressVisibility();
        if (!canAutoCycle()) {
            if (reducedMotionQuery?.matches || queue.length <= 1 || !isVisible) {
                stopProgressAnimation();
                remainingMs = SPOTLIGHT_INTERVAL_MS;
            }
            return;
        }

        const waitMs = Math.max(
            250,
            Math.min(SPOTLIGHT_INTERVAL_MS, remainingMs)
        );
        const startFraction = Math.max(
            0,
            Math.min(1, 1 - waitMs / SPOTLIGHT_INTERVAL_MS)
        );

        cycleStartedAt = performance.now();
        startProgressAnimation(startFraction, waitMs);

        timerId = window.setTimeout(() => {
            timerId = 0;
            cycleStartedAt = 0;
            remainingMs = SPOTLIGHT_INTERVAL_MS;
            if (!canAutoCycle()) return;
            stepSlide(1, false);
        }, waitMs);
    }

    function syncNavButtons() {
        const disabled = queue.length <= 1;
        if (prevButton) prevButton.disabled = disabled;
        if (nextButton) nextButton.disabled = disabled;
        syncProgressVisibility();
    }

    function triggerSwapMotion(direction) {
        if (!card || reducedMotionQuery?.matches) return;

        if (swapResetTimer) {
            window.clearTimeout(swapResetTimer);
            swapResetTimer = 0;
        }

        card.classList.remove("is-swapping-next", "is-swapping-prev");
        // Force style flush so repeated rapid clicks replay cleanly
        void card.offsetWidth;
        card.classList.add(
            direction < 0 ? "is-swapping-prev" : "is-swapping-next"
        );
        swapResetTimer = window.setTimeout(() => {
            card.classList.remove("is-swapping-next", "is-swapping-prev");
            swapResetTimer = 0;
        }, 220);
    }

    function applyDetailTransition() {
        clearHeroViewTransitions();
        if (coverFrame) coverFrame.style.viewTransitionName = "napl-hero-cover";
        const titleHeading = card?.querySelector(".spotlight-title");
        if (titleHeading) {
            titleHeading.style.viewTransitionName = "napl-hero-title";
        }
    }

    function syncBackdropCover(src) {
        if (!backdropImg) return;
        if (src) {
            backdropImg.src = src;
            backdropImg.classList.add("is-loaded");
        } else {
            backdropImg.classList.remove("is-loaded");
            backdropImg.removeAttribute("src");
        }
    }

    function preloadAdjacentEntries() {
        if (queue.length <= 1) return;
        const prevIndex = (currentIndex - 1 + queue.length) % queue.length;
        const nextIndex = (currentIndex + 1) % queue.length;
        preloadSpotlightCover(queue[nextIndex]?.game);
        if (prevIndex !== nextIndex) {
            preloadSpotlightCover(queue[prevIndex]?.game);
        }
    }

    function handleBrokenCurrentEntry(failedSlug, direction) {
        const idx = queue.findIndex((entry) => entry.game.slug === failedSlug);
        if (idx !== -1) {
            queue.splice(idx, 1);
            if (currentIndex >= queue.length) {
                currentIndex = 0;
            }
        }

        if (queue.length === 0) {
            hasResolvedPool = true;
            if (section) section.hidden = true;
            clearIdleTimer({ resetProgress: true });
            syncProgressVisibility();
            return;
        }

        syncNavButtons();
        renderCurrentEntry(direction >= 0 ? 1 : -1, false);
    }

    function renderCurrentEntry(direction = 1, animate = true) {
        if (!section || !card || queue.length === 0) {
            if (skeleton) skeleton.hidden = true;
            if (card) card.hidden = true;
            if (section && hasResolvedPool) {
                section.hidden = true;
            }
            syncNavButtons();
            clearIdleTimer({ resetProgress: true });
            return;
        }

        const entry = queue[currentIndex];
        if (!entry) return;

        const { game, port } = entry;
        const gameUrl = new URL("./", window.location.href);
        gameUrl.searchParams.set("game", game.slug);

        if (coverFrame) {
            coverFrame.classList.remove("cover-unavailable", "is-loaded");
        }
        if (titleLink) {
            titleLink.href = gameUrl.href;
            titleLink.textContent = game.name;
        }
        if (kickerEl) {
            kickerEl.textContent = "Trending";
        }

        if (metaEl) {
            const parts = [];
            const platformLabel = getGamePlatformLabel(game, port);
            if (platformLabel) parts.push(platformLabel);

            const year = String(game.year || port?.year || "").trim();
            if (year) parts.push(year);

            metaEl.textContent = parts.join(" · ");
            metaEl.hidden = parts.length === 0;
        }

        if (portLineEl) {
            const portName = getPortDisplayName(port);
            const dev = String(port?.developer || "").trim();
            const hasDistinctDev =
                dev &&
                dev !== "-" &&
                dev.toLowerCase() !== "unknown" &&
                dev.toLowerCase() !== portName.toLowerCase();

            portLineEl.textContent = hasDistinctDev
                ? `Port: ${portName} · by ${dev}`
                : `Port: ${portName}`;
        }

        if (coverImg) {
            const token = ++renderToken;
            coverImg.alt = `${game.name} cover`;
            coverImg.hidden = false;
            coverImg.removeAttribute("src");
            syncBackdropCover("");

            const onLoaded = () => {
                if (token !== renderToken) return;
                coverFrame?.classList.add("is-loaded");
                syncBackdropCover(coverImg.currentSrc || coverImg.src);
            };
            coverImg.addEventListener("load", onLoaded, { once: true });

            loadCoverImage(coverImg, String(game.coverUrl || "").trim(), () => {
                if (token !== renderToken) return;
                coverImg.hidden = true;
                coverFrame?.classList.remove("is-loaded");
                coverFrame?.classList.add("cover-unavailable");
                syncBackdropCover("");
                if (queue.length > 1) {
                    handleBrokenCurrentEntry(game.slug, direction);
                }
            });

            if (coverImg.complete && coverImg.naturalWidth > 0) {
                coverFrame?.classList.add("is-loaded");
                syncBackdropCover(coverImg.currentSrc || coverImg.src);
            }
        }

        if (skeleton) skeleton.hidden = true;
        card.hidden = false;
        section.hidden = !isVisible;
        remainingMs = SPOTLIGHT_INTERVAL_MS;
        stopProgressAnimation();
        syncNavButtons();

        if (animate) {
            triggerSwapMotion(direction);
        }

        preloadAdjacentEntries();
        scheduleIdleCycle();
    }

    function stepSlide(delta, isManual = true) {
        if (queue.length <= 1) return;
        if (isManual) {
            userManuallyStepped = true;
        }
        currentIndex = (currentIndex + delta + queue.length) % queue.length;
        renderCurrentEntry(delta, true);
    }

    function mergeTrendingQueue(trendingPool) {
        if (!Array.isArray(trendingPool) || trendingPool.length === 0) return;

        hasResolvedPool = true;
        if (card?.hidden || queue.length === 0) {
            queue = trendingPool;
            currentIndex = 0;
            renderCurrentEntry(1, false);
            return;
        }

        const currentEntry = queue[currentIndex];
        const remaining = trendingPool.filter(
            (item) => item.game.slug !== currentEntry?.game?.slug
        );
        queue = currentEntry ? [currentEntry, ...remaining] : trendingPool;
        currentIndex = 0;
        syncNavButtons();
        preloadAdjacentEntries();
        if (!timerId && canAutoCycle()) {
            scheduleIdleCycle();
        }

        if (!userManuallyStepped && kickerEl && !currentEntry?.isTrending) {
            // Silently swap onto a true trending title if user hasn't interacted yet
            queue = trendingPool;
            currentIndex = 0;
            renderCurrentEntry(1, false);
        }
    }

    async function setGames(games) {
        catalogGames = Array.isArray(games) ? games : [];
        if (catalogGames.length === 0) {
            hasResolvedPool = true;
            queue = [];
            renderCurrentEntry(1, false);
            return;
        }

        if (popularityHydrated) {
            const trendingPool = buildTrendingPool(catalogGames);
            if (trendingPool.length > 0) {
                hasResolvedPool = true;
                if (queue.length === 0) {
                    queue = trendingPool;
                    currentIndex = 0;
                    renderCurrentEntry(1, false);
                } else {
                    mergeTrendingQueue(trendingPool);
                }
                return;
            }
        }

        const popularityPromise = Promise.allSettled([
            ensurePopularPeriod("week"),
            ensureAllTimePopular(),
        ]).then(() => {
            popularityHydrated = true;
            return buildTrendingPool(catalogGames);
        });

        const raceTimeout = new Promise((resolve) => {
            window.setTimeout(() => resolve(null), POPULARITY_RACE_MS);
        });

        const firstResult = await Promise.race([popularityPromise, raceTimeout]);
        if (Array.isArray(firstResult) && firstResult.length > 0) {
            hasResolvedPool = true;
            queue = firstResult;
            currentIndex = 0;
            renderCurrentEntry(1, false);
            return;
        }

        if (queue.length === 0) {
            queue = buildFallbackPool(catalogGames);
            currentIndex = 0;
            hasResolvedPool = true;
            renderCurrentEntry(1, false);
        }

        popularityPromise.then((trendingPool) => {
            if (Array.isArray(trendingPool) && trendingPool.length > 0) {
                mergeTrendingQueue(trendingPool);
            }
        });
    }

    function syncVisibility(shouldShow) {
        isVisible = Boolean(shouldShow);
        if (!section) return;

        if (isVisible) {
            document.documentElement.removeAttribute("data-spotlight");
            section.hidden = hasResolvedPool && queue.length === 0;
            syncProgressVisibility();
            scheduleIdleCycle();
        } else {
            document.documentElement.setAttribute("data-spotlight", "hidden");
            section.hidden = true;
            pauseIdleCycle();
            syncProgressVisibility();
        }
    }

    prevButton?.addEventListener("click", (event) => {
        event.stopPropagation();
        stepSlide(-1, true);
    });

    nextButton?.addEventListener("click", (event) => {
        event.stopPropagation();
        stepSlide(1, true);
    });

    titleLink?.addEventListener("click", (event) => {
        if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }
        applyDetailTransition();
    });

    card?.addEventListener("click", (event) => {
        if (event.target?.closest?.("button, .spotlight-nav, a")) return;
        if (event.button !== 0) return;
        if (window.getSelection?.()?.toString()) return;
        if (!titleLink?.getAttribute("href")) return;

        titleLink.dispatchEvent(
            new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
            })
        );
    });

    section?.addEventListener("pointerenter", () => {
        isHovering = true;
        pauseIdleCycle();
    });

    section?.addEventListener("pointerleave", () => {
        isHovering = false;
        scheduleIdleCycle();
    });

    section?.addEventListener("focusin", () => {
        hasFocusWithin = true;
        pauseIdleCycle();
    });

    section?.addEventListener("focusout", (event) => {
        const nextFocus = event.relatedTarget;
        hasFocusWithin = Boolean(nextFocus && section.contains(nextFocus));
        if (!hasFocusWithin) {
            scheduleIdleCycle();
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            pauseIdleCycle();
        } else {
            scheduleIdleCycle();
        }
    });

    if (
        section &&
        typeof window !== "undefined" &&
        typeof window.IntersectionObserver === "function"
    ) {
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                isInViewport = Boolean(entry?.isIntersecting);
                if (isInViewport) {
                    scheduleIdleCycle();
                } else {
                    pauseIdleCycle();
                }
            },
            { threshold: 0.15 }
        );
        observer.observe(section);
    }

    reducedMotionQuery?.addEventListener?.("change", () => {
        syncProgressVisibility();
        if (reducedMotionQuery.matches) {
            clearIdleTimer({ resetProgress: true });
        } else {
            scheduleIdleCycle();
        }
    });

    return {
        setGames,
        syncVisibility,
    };
}
