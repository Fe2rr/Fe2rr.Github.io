/*
 * NAPL — GAME SPOTLIGHT COMPONENT
 *
 * Randomly cycles through trending and popular cover-backed ports
 * on idle while offering manual Previous / Next navigation.
 */

import {
    getRepresentativePort,
    getGamePlatformLabel,
} from "./game-card.js";
import {
    loadOptimizedCoverImage,
    getOptimizedCoverUrl,
} from "../lib/cover-fallback.js";
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
    getLatestUpdate,
    getDateAdded,
    clearHeroViewTransitions,
    extractGameGenres,
} from "../lib/helpers.js";

const SPOTLIGHT_INTERVAL_MS = 8000;
const MAX_SPOTLIGHT_POOL = 28;

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

function buildEligibleEntries(games) {
    return games.flatMap((game) => {
        if (!hasValidCoverUrl(game) || !Array.isArray(game.ports) || game.ports.length === 0) return [];
        const port = getRepresentativePort(game);
        return port ? [{ game, port }] : [];
    });
}

function withCategory(items, category) {
    return items.map((item) => ({ ...item, category }));
}

function interleaveCategories(groups) {
    const maxLength = Math.max(0, ...groups.map((group) => group.length));
    const interleaved = [];
    for (let i = 0; i < maxLength; i++) {
        for (const group of groups) {
            if (i < group.length) {
                interleaved.push(group[i]);
            }
        }
    }
    return interleaved;
}

function buildSpotlightQueue(games) {
    const eligible = buildEligibleEntries(games);
    const visits = (item, period) => getPopularVisits(item.game.popularityKey || item.game.name, period);
    const score = (item) => visits(item, "week") * 4 + visits(item, "alltime");

    // Trending: los cinco mejores según visitas semanales (x4) + históricas.
    const trending = [...eligible]
        .map((item) => ({ ...item, score: score(item) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    // Rising: ranking de los últimos 50 juegos agregados, ponderando semana y mes.
    const newest50 = [...eligible]
        .map((item) => ({ ...item, addedAt: getDateAdded(item.game) }))
        .filter((item) => item.addedAt)
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, 50);
    const rising = newest50
        .map((item) => ({
            ...item,
            score: visits(item, "week") * 4 + visits(item, "month"),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    // Top 100 histórico (Popular usa los primeros 50; Recently Updated evalúa los 100).
    const top100 = [...eligible]
        .map((item) => ({ ...item, score: visits(item, "alltime") }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 100);
    const popular = shuffleInPlace(top100.slice(0, 50)).slice(0, 5);

    // Recently Updated: solo juegos del Top 100 histórico; ventana 24 h y fallback hasta 48 h.
    const now = Date.now();
    const updatedCandidates = top100
        .map((item) => ({ ...item, updatedAt: getLatestUpdate(item.game) }))
        .filter((item) => item.updatedAt && item.updatedAt.getTime() <= now)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    const within24h = updatedCandidates.filter((item) => now - item.updatedAt.getTime() <= 24 * 60 * 60 * 1000);
    const recentlyUpdated = (within24h.length >= 5
        ? within24h
        : updatedCandidates.filter((item) => now - item.updatedAt.getTime() <= 48 * 60 * 60 * 1000)
    ).slice(0, 5);

    return interleaveCategories([
        withCategory(trending, "Trending"),
        withCategory(rising, "Rising"),
        withCategory(popular, "Popular"),
        withCategory(recentlyUpdated, "Recently Updated"),
    ]);
}

function buildFallbackPool(games) {
    const candidates = buildEligibleEntries(games).map((item) => {
        const hasDescription = Boolean(String(item.game.description || "").trim());
        const portCount = item.game.ports.length;
        const latestDate = getLatestUpdate(item.game) || getDateAdded(item.game);
        const recencyScore = latestDate ? latestDate.getTime() / 1e12 : 0;
        return {
            ...item,
            score: (hasDescription ? 10 : 0) + Math.min(portCount, 5) * 2 + recencyScore,
        };
    });
    candidates.sort((a, b) => b.score - a.score);
    return withCategory(candidates.slice(0, MAX_SPOTLIGHT_POOL), "Featured");
}

function preloadSpotlightCover(game) {
    const rawUrl = String(game?.coverUrl || "").trim();
    if (!rawUrl || isCoverUrlFailed(rawUrl)) return;

    const effectiveUrl =
        getOptimizedCoverUrl(rawUrl, 280) ||
        getCachedResolvedCoverUrl(rawUrl) ||
        rawUrl;
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
    let hasResolvedPool = false;
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
            stepSlide(1);
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
            kickerEl.textContent = entry.category || "Trending";
        }

        if (metaEl) {
            const parts = [];
            const platformLabel = getGamePlatformLabel(game, port);
            if (platformLabel) parts.push(platformLabel);

            const year = String(game.year || port?.year || "").trim();
            if (year) parts.push(year);

            const primaryGenre = extractGameGenres(game.genre)[0];
            if (primaryGenre) parts.push(primaryGenre);

            metaEl.textContent = parts.join(" · ");
            metaEl.hidden = parts.length === 0;
        }

        if (portLineEl) {
            const portCount = Array.isArray(game.ports) ? game.ports.length : 0;
            portLineEl.textContent = `${portCount} ${
                portCount === 1 ? "port available" : "ports available"
            }`;
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

            loadOptimizedCoverImage(
                coverImg,
                String(game.coverUrl || "").trim(),
                () => {
                    if (token !== renderToken) return;
                    coverImg.hidden = true;
                    coverFrame?.classList.remove("is-loaded");
                    coverFrame?.classList.add("cover-unavailable");
                    syncBackdropCover("");
                    if (queue.length > 1) {
                        handleBrokenCurrentEntry(game.slug, direction);
                    }
                },
                280
            );

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

    function stepSlide(delta) {
        if (queue.length <= 1) return;
        currentIndex = (currentIndex + delta + queue.length) % queue.length;
        renderCurrentEntry(delta, true);
    }


    async function setGames(games) {
        catalogGames = Array.isArray(games) ? games : [];
        if (catalogGames.length === 0) {
            hasResolvedPool = true;
            queue = [];
            renderCurrentEntry(1, false);
            return;
        }

        // Load all periods required by the four Spotlight categories.
        await Promise.allSettled([
            ensurePopularPeriod("week"),
            ensurePopularPeriod("month"),
            ensureAllTimePopular(),
        ]);

        const categoryQueue = buildSpotlightQueue(catalogGames);
        queue = categoryQueue.length > 0 ? categoryQueue : buildFallbackPool(catalogGames);
        currentIndex = 0;
        hasResolvedPool = true;
        renderCurrentEntry(1, false);
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
        stepSlide(-1);
    });

    nextButton?.addEventListener("click", (event) => {
        event.stopPropagation();
        stepSlide(1);
    });

    section?.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        stepSlide(event.key === "ArrowLeft" ? -1 : 1);
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
