/*
 * NAPL — SINGLE-PAGE APPLICATION CONTROLLER (ALL GAMES + GAME DETAIL + COMPATIBILITY)
 */

import { loadCatalog } from "./lib/data.js";
import { clearHeroViewTransitions } from "./lib/helpers.js";
import { initNavigation } from "./ui/navigation.js";
import { initSearch } from "./ui/search.js?v=2";
import { initThemeToggle } from "./ui/theme.js";
import { renderErrorBox, renderListSkeletons } from "./ui/loading.js";
import { createCategoryController } from "./ui/categories.js";
import { createSpotlightController } from "./ui/spotlight.js";
import { createGameViewController } from "./ui/game-view.js";
import { createCompatViewController } from "./ui/compat-view.js";

initThemeToggle();

const DEFAULT_TITLE = "NAPL — Native Android Port List";

const state = {
    catalog: null,
    games: [],
    platformOrder: [],
    currentView: "category",
    activePage: "home", // 'home' | 'game' | 'compatibility'
    savedHomeScrollY: 0,
    homeInitializedOnce: false,
    hasHydratedRoute: false,
    selectedPlatform: "",
    selectedCategory: "all-games",
    selectedGenre: "",
    selectedYear: "",
    selectedDeveloper: "",
    selectedCategorySort: "added",
    categorySortDescending: false,
    selectedPopularPeriod: "week",
};

const homeViewEl = document.getElementById("home-view");
const gameViewEl = document.getElementById("game-view");
const compatViewEl = document.getElementById("compat-view");
const gameBackButton = document.getElementById("game-back-button");
const compatBackButton = document.getElementById("compat-back-button");

const gameList = document.getElementById("game-list");
const statusElement = document.getElementById("status");
const categoryControls = document.getElementById("category-controls");
const categorySearchInput = document.getElementById("category-search");
const showMoreContainer = document.getElementById("show-more-container");

function updateHistoryUrl(relativeUrl, { push = false } = {}) {
    try {
        if (push) {
            window.history.pushState(null, "", relativeUrl);
        } else {
            window.history.replaceState(null, "", relativeUrl);
        }
    } catch {
        // Ignore history errors in restricted frames
    }
}

function setActiveSection(page) {
    const prevPage = state.activePage;
    if (prevPage === "home" && page !== "home") {
        state.savedHomeScrollY = window.scrollY || 0;
    }

    state.activePage = page;
    document.documentElement.removeAttribute("data-initial-view");

    if (homeViewEl) homeViewEl.hidden = page !== "home";
    if (gameViewEl) gameViewEl.hidden = page !== "game";
    if (compatViewEl) compatViewEl.hidden = page !== "compatibility";

    document.body.classList.toggle("home-page", page === "home");
    document.body.classList.toggle("compatibility-page", page === "compatibility");

    compatViewController.setActive(page === "compatibility");
    if (page !== "game") {
        gameViewController.clear();
    }
    if (page === "home") {
        clearHeroViewTransitions();
    }
    syncSpotlightVisibility();
}

function runWithViewTransition(updateFn, { animate = true } = {}) {
    const prefersReducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
    ).matches;

    if (
        animate &&
        !prefersReducedMotion &&
        typeof document.startViewTransition === "function"
    ) {
        const transition = document.startViewTransition(updateFn);
        transition?.ready?.catch?.(() => {});
        transition?.finished?.catch?.(() => {});
        return transition;
    }

    updateFn();
    return null;
}

const spotlightController = createSpotlightController();
const gameViewController = createGameViewController();
const compatViewController = createCompatViewController();

function syncSpotlightVisibility() {
    if (state.activePage !== "home") {
        spotlightController.syncVisibility(false);
        return;
    }

    const hasFilter = Boolean(
        state.selectedPlatform ||
            state.selectedGenre ||
            state.selectedYear ||
            state.selectedDeveloper
    );
    const isDefaultCategory =
        !state.selectedCategory || state.selectedCategory === "all-games";
    const hasCategorySearch = Boolean(
        String(categorySearchInput?.value || "").trim()
    );
    const searchContainer = document.getElementById("search-container");
    const globalSearchInput = document.getElementById("search");
    const hasHeaderSearch = Boolean(
        searchContainer &&
            !searchContainer.hidden &&
            String(globalSearchInput?.value || "").trim()
    );

    spotlightController.syncVisibility(
        isDefaultCategory &&
            !hasFilter &&
            !hasCategorySearch &&
            !hasHeaderSearch
    );
}

const categoryController = createCategoryController(state, {
    onFiltersChange: (nextUrl) => {
        if (state.activePage === "home") {
            updateHistoryUrl(nextUrl);
        }
    },
    onViewStateChange: () => {
        syncSpotlightVisibility();
    },
    onClearFilters: () => {
        if (state.selectedCategory === "dual-screen") {
            openCategory("dual-screen");
            updateHistoryUrl("./?category=dual-screen");
            return;
        }
        openCategory("all-games");
        updateHistoryUrl("./");
    },
});

const searchController = initSearch({
    onCloseFallback: () => {
        if (state.activePage === "home") {
            categoryController.displayFilteredGames();
        }
    },
    onQueryChange: () => {
        syncSpotlightVisibility();
    },
});

function openCategory(category, defaultSort = "added") {
    state.currentView = "category";
    state.selectedPlatform = "";
    state.selectedCategory = category;
    state.selectedGenre = "";
    state.selectedYear = "";
    state.selectedDeveloper = "";
    categoryController.resetCategoryControls(defaultSort);
    categoryController.showCategoryView();
    if (gameList) gameList.hidden = false;
    categoryController.displayFilteredGames();
    state.homeInitializedOnce = true;
}

function openPlatform(platform) {
    state.currentView = "category";
    state.selectedPlatform = platform;
    state.selectedCategory = "all-games";
    state.selectedGenre = "";
    state.selectedYear = "";
    state.selectedDeveloper = "";
    categoryController.resetCategoryControls("added");
    categoryController.showCategoryView();
    if (gameList) gameList.hidden = false;
    categoryController.displayFilteredGames();
    state.homeInitializedOnce = true;
}

function goHome() {
    openCategory("all-games", "added");
}

function showHomeRoute(params = new URLSearchParams(), { restoreScroll = false } = {}) {
    document.title = DEFAULT_TITLE;
    const platform = params.get("platform") || "";
    const category = params.get("category") || "";
    const genre = params.get("genre") || "";
    const year = params.get("year") || "";
    const dev = params.get("dev") || "";
    const view = params.get("view") || "";
    const period = params.get("period") || "";

    const hasDefaultAllGamesOnly =
        !platform &&
        !genre &&
        !year &&
        !dev &&
        (!category || category === "all-games") &&
        (!view || view === "all-games");

    const applyHomeDom = () => {
        setActiveSection("home");

        if (hasDefaultAllGamesOnly) {
            if (
                !state.homeInitializedOnce ||
                state.selectedPlatform ||
                state.selectedGenre ||
                state.selectedYear ||
                state.selectedDeveloper ||
                (state.selectedCategory && state.selectedCategory !== "all-games")
            ) {
                goHome();
            } else {
                syncSpotlightVisibility();
            }

            if (
                window.location.pathname.endsWith("/index.html") ||
                category === "all-games" ||
                view === "all-games"
            ) {
                updateHistoryUrl("./" + window.location.hash);
            }
        } else {
            if (window.location.pathname.endsWith("/index.html")) {
                updateHistoryUrl(
                    "./" + window.location.search + window.location.hash
                );
            }

            searchController.resetSearchBar();

            if (
                category === "multi-game-apps" &&
                !platform &&
                !genre &&
                !year &&
                !dev
            ) {
                openCategory("multi-game-apps", "updated");
            } else {
                let initialSort = "added";
                if (view === "last-updated") {
                    initialSort = "updated";
                } else if (view === "popular") {
                    initialSort = "popular";
                }

                if (
                    view === "popular" &&
                    (period === "week" ||
                        period === "month" ||
                        period === "alltime")
                ) {
                    state.selectedPopularPeriod = period;
                }

                state.currentView = "category";
                state.selectedCategory =
                    category === "dual-screen" ? "dual-screen" : "all-games";
                state.selectedPlatform = platform.trim();
                state.selectedGenre = genre.trim();
                state.selectedYear = year.trim();
                state.selectedDeveloper = dev.trim();
                if (
                    state.selectedPlatform ||
                    state.selectedGenre ||
                    state.selectedYear ||
                    state.selectedDeveloper
                ) {
                    categoryController.setFiltersOpen(true);
                }
                categoryController.resetCategoryControls(initialSort);
                categoryController.showCategoryView();
                if (gameList) gameList.hidden = false;
                categoryController.displayFilteredGames();
                state.homeInitializedOnce = true;
            }
        }

        window.scrollTo({
            top: restoreScroll ? state.savedHomeScrollY : 0,
            behavior: "auto",
        });
    };

    const shouldAnimate =
        state.hasHydratedRoute && state.activePage !== "home" && !restoreScroll;
    state.hasHydratedRoute = true;
    runWithViewTransition(applyHomeDom, { animate: shouldAnimate });
}

function showGameRoute(slug) {
    const shouldAnimate = state.hasHydratedRoute && state.activePage !== "game";
    state.hasHydratedRoute = true;
    runWithViewTransition(
        () => {
            setActiveSection("game");
            window.scrollTo({ top: 0, behavior: "auto" });
            if (state.catalog) {
                gameViewController.openGame(slug, state.catalog);
            }
        },
        { animate: shouldAnimate }
    );
}

function showCompatRoute(params = new URLSearchParams()) {
    const shouldAnimate =
        state.hasHydratedRoute && state.activePage !== "compatibility";
    state.hasHydratedRoute = true;
    runWithViewTransition(
        () => {
            setActiveSection("compatibility");
            window.scrollTo({ top: 0, behavior: "auto" });
            compatViewController.open(state.catalog, params);
        },
        { animate: shouldAnimate }
    );
}

function applyRouteFromLocation({ restoreHomeScroll = false } = {}) {
    const params = new URLSearchParams(window.location.search);
    const requestedGame = params.get("game");
    const requestedPage = params.get("page");
    const hasCompatParams =
        requestedPage === "compatibility" ||
        Boolean(params.get("device") || params.get("soc"));

    if (requestedGame) {
        showGameRoute(requestedGame);
        return;
    }

    if (hasCompatParams) {
        showCompatRoute(params);
        return;
    }

    showHomeRoute(params, { restoreScroll: restoreHomeScroll });
}

function navigateToRelativeUrl(relativeUrl, { push = true, restoreHomeScroll = false } = {}) {
    const target = new URL(relativeUrl, window.location.href);
    const nextUrl = target.pathname + target.search + target.hash;
    const currentUrl =
        window.location.pathname + window.location.search + window.location.hash;

    if (nextUrl !== currentUrl) {
        updateHistoryUrl(nextUrl, { push });
    }

    applyRouteFromLocation({ restoreHomeScroll });
}

function handleSubpageBack() {
    const params = new URLSearchParams(window.location.search);
    const returnPath = params.get("return");

    if (returnPath) {
        try {
            const target = new URL(returnPath, window.location.href);
            const baseDirPathname = new URL("./", window.location.href).pathname;
            const isHomeReturn =
                target.pathname === baseDirPathname ||
                target.pathname === `${baseDirPathname}index.html` ||
                target.pathname.endsWith("/index.html");
            if (target.origin === window.location.origin && isHomeReturn) {
                const normalizedReturn =
                    "./" + target.search + target.hash;
                navigateToRelativeUrl(normalizedReturn, {
                    push: true,
                    restoreHomeScroll: state.homeInitializedOnce,
                });
                return;
            }
        } catch {
            // Fall through to clean home navigation
        }
    }

    if (state.homeInitializedOnce && window.history.length > 1) {
        window.history.back();
        return;
    }

    navigateToRelativeUrl("./", {
        push: true,
        restoreHomeScroll: state.homeInitializedOnce,
    });
}

gameBackButton?.addEventListener("click", handleSubpageBack);
compatBackButton?.addEventListener("click", handleSubpageBack);

const navController = initNavigation({
    onGoHome: () => {
        if (state.activePage !== "home") {
            navigateToRelativeUrl("./", { push: true });
            return;
        }
        goHome();
        updateHistoryUrl("./");
    },
    onSelectAllGames: () => {
        if (state.activePage !== "home") {
            navigateToRelativeUrl("./", { push: true });
            return;
        }
        openCategory("all-games", "added");
        updateHistoryUrl("./");
    },
    onSelectCategory: (category) => {
        const nextUrl =
            category === "all-games"
                ? "./"
                : `./?category=${encodeURIComponent(category)}`;
        if (state.activePage !== "home") {
            navigateToRelativeUrl(nextUrl, { push: true });
            return;
        }
        openCategory(
            category,
            category === "multi-game-apps" ? "updated" : "added"
        );
        updateHistoryUrl(nextUrl);
    },
    onSelectPlatform: (platform) => {
        const nextUrl = `./?platform=${encodeURIComponent(platform)}`;
        if (state.activePage !== "home") {
            navigateToRelativeUrl(nextUrl, { push: true });
            return;
        }
        openPlatform(platform);
        updateHistoryUrl(nextUrl);
    },
    onOpenCompatibility: () => {
        navigateToRelativeUrl("./?page=compatibility", { push: true });
    },
    onBeforeOpenMenu: () => searchController.closeSearch(false),
    onActionResetSearch: () => searchController.resetSearchBar(),
});

// Intercept all same-origin SPA links (game cards, search results, spotlight, metadata filters, compatibility links)
document.addEventListener("click", (event) => {
    if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return;
    }

    const link = event.target?.closest?.("a[href]");
    if (!link) return;
    if (link.target && link.target !== "_self") return;
    if (link.hasAttribute("download")) return;

    let targetUrl;
    try {
        targetUrl = new URL(link.href, window.location.href);
    } catch {
        return;
    }

    if (targetUrl.origin !== window.location.origin) return;

    const baseDirPathname = new URL("./", window.location.href).pathname;
    const isRootAppLink =
        targetUrl.pathname === baseDirPathname ||
        targetUrl.pathname === `${baseDirPathname}index.html` ||
        targetUrl.pathname.endsWith("/index.html");

    if (!isRootAppLink) return;

    event.preventDefault();
    searchController.closeSearch(false);
    navigateToRelativeUrl("./" + targetUrl.search + targetUrl.hash, {
        push: true,
    });
});

window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const isReturningHome =
        !params.get("game") &&
        params.get("page") !== "compatibility" &&
        !params.get("device") &&
        !params.get("soc");
    applyRouteFromLocation({
        restoreHomeScroll: isReturningHome && state.homeInitializedOnce,
    });
});

async function initHomePage() {
    if (!statusElement || !gameList) return;

    statusElement.textContent = "";
    gameList.hidden = false;
    if (showMoreContainer) showMoreContainer.hidden = true;
    if (!gameList.querySelector(".skeleton-card")) {
        renderListSkeletons(gameList, 10);
    }

    try {
        const applyCatalog = (catalog, { isBackgroundUpdate = false } = {}) => {
            state.catalog = catalog;
            state.games = catalog.games;
            state.platformOrder = catalog.platformOrder;

            searchController.setGames(state.games);
            categoryController.populateFilterOptions(
                state.platformOrder,
                state.games
            );
            compatViewController.syncCatalog(catalog);

            if (!isBackgroundUpdate) {
                applyRouteFromLocation();
            } else if (state.activePage === "home" && state.homeInitializedOnce) {
                categoryController.displayFilteredGames();
            }

            spotlightController.setGames(state.games);
            syncSpotlightVisibility();

            if (typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(() => {
                    navController.renderPlatforms(
                        state.platformOrder,
                        state.games
                    );
                });
            } else {
                navController.renderPlatforms(state.platformOrder, state.games);
            }
        };

        const catalog = await loadCatalog();
        applyCatalog(catalog);
    } catch (error) {
        console.error("NAPL: could not load games.", error);
        document.documentElement.removeAttribute("data-initial-view");
        statusElement.textContent = "";
        if (showMoreContainer) showMoreContainer.hidden = true;
        renderErrorBox(
            gameList,
            "Could not load the games.",
            error instanceof Error
                ? error.message
                : "An unexpected error occurred.",
            initHomePage
        );
    }
}

const COMPAT_BANNER_STORAGE_KEY = "napl_compat_banner_dismissed_v2";
const RATE_BANNER_STORAGE_KEY = "napl_rate_banner_dismissed_v2";

const homeBannersContainer = document.getElementById("home-banners");
const homeFeatureBanner = document.getElementById("home-feature-banner");
const homeFeatureDismiss = document.getElementById("home-feature-dismiss");
const homeRateBanner = document.getElementById("home-rate-banner");
const homeRateDismiss = document.getElementById("home-rate-dismiss");
const homeRateCta = document.getElementById("home-rate-cta");

function syncHomeBannersContainer() {
    if (!homeBannersContainer) return;
    const anyVisible = Array.from(
        homeBannersContainer.querySelectorAll(".home-feature-banner")
    ).some((banner) => !banner.hidden);
    homeBannersContainer.hidden = !anyVisible;
    if (anyVisible) {
        document.documentElement.removeAttribute("data-all-banners");
    } else {
        document.documentElement.setAttribute("data-all-banners", "dismissed");
    }
}

function applyBannerDismissedState(bannerEl, storageKey, rootAttr) {
    if (!bannerEl) return;
    let dismissed = false;
    try {
        dismissed = localStorage.getItem(storageKey) === "1";
    } catch {
        // Ignore storage read errors
    }

    if (dismissed) {
        bannerEl.dataset.dismissed = "true";
        bannerEl.hidden = true;
        if (rootAttr) {
            document.documentElement.setAttribute(rootAttr, "dismissed");
        }
    }
}

function setupDismissibleBanner(bannerEl, dismissBtn, storageKey, rootAttr) {
    if (!bannerEl) return;
    applyBannerDismissedState(bannerEl, storageKey, rootAttr);

    dismissBtn?.addEventListener("click", () => {
        bannerEl.dataset.dismissed = "true";
        bannerEl.hidden = true;
        if (rootAttr) {
            document.documentElement.setAttribute(rootAttr, "dismissed");
        }
        syncHomeBannersContainer();
        try {
            localStorage.setItem(storageKey, "1");
        } catch {
            // Ignore storage write errors
        }
    });
}

function syncAllFeatureBannersFromStorage() {
    applyBannerDismissedState(
        homeFeatureBanner,
        COMPAT_BANNER_STORAGE_KEY,
        "data-compat-banner"
    );
    applyBannerDismissedState(
        homeRateBanner,
        RATE_BANNER_STORAGE_KEY,
        "data-rate-banner"
    );
    syncHomeBannersContainer();
}

function initFeatureBanners() {
    setupDismissibleBanner(
        homeFeatureBanner,
        homeFeatureDismiss,
        COMPAT_BANNER_STORAGE_KEY,
        "data-compat-banner"
    );
    setupDismissibleBanner(
        homeRateBanner,
        homeRateDismiss,
        RATE_BANNER_STORAGE_KEY,
        "data-rate-banner"
    );
    syncHomeBannersContainer();

    window.addEventListener("pageshow", () => {
        clearHeroViewTransitions();
        syncAllFeatureBannersFromStorage();
    });

    homeRateCta?.addEventListener("click", () => {
        if (state.selectedCategory === "multi-game-apps") {
            openCategory("all-games", "added");
            updateHistoryUrl("./");
        }
        categoryControls?.scrollIntoView({ behavior: "smooth", block: "start" });
        categorySearchInput?.focus({ preventScroll: true });
    });
}

function initScrollTopButton() {
    const scrollTopButton = document.getElementById("scroll-top-button");
    if (!scrollTopButton) return;

    const SCROLL_TOP_THRESHOLD = 420;
    let rafId = 0;

    function updateVisibility() {
        rafId = 0;
        const isVisible = window.scrollY >= SCROLL_TOP_THRESHOLD;
        scrollTopButton.classList.toggle("is-visible", isVisible);
        scrollTopButton.setAttribute("aria-hidden", String(!isVisible));
        if (isVisible) {
            scrollTopButton.removeAttribute("tabindex");
        } else {
            scrollTopButton.setAttribute("tabindex", "-1");
        }
    }

    function scheduleUpdate() {
        if (rafId) return;
        rafId = window.requestAnimationFrame(updateVisibility);
    }

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("pageshow", updateVisibility);

    scrollTopButton.addEventListener("click", () => {
        const prefersReducedMotion = window.matchMedia?.(
            "(prefers-reduced-motion: reduce)"
        ).matches;
        window.scrollTo({
            top: 0,
            behavior: prefersReducedMotion ? "auto" : "smooth",
        });
    });

    updateVisibility();
}

initFeatureBanners();
initScrollTopButton();
initHomePage();
