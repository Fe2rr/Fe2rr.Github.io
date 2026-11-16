/*
 * NAPL — HOME PAGE CONTROLLER (ALL GAMES + BANNERS)
 */

import { loadCatalog } from "../core/data.js?v=14";
import { initNavigation } from "../components/navigation.js?v=17";
import { initSearch } from "../components/search.js?v=14";
import { initThemeToggle } from "../components/theme.js?v=14";
import {
    renderErrorBox,
    renderListSkeletons,
} from "../components/loading.js?v=14";
import { createCategoryController } from "./categories.js?v=20";

initThemeToggle();

const state = {
    games: [],
    platformOrder: [],
    currentView: "category",
    selectedPlatform: "",
    selectedCategory: "all-games",
    selectedGenre: "",
    selectedDeveloper: "",
    selectedCategorySort: "added",
    categorySortDescending: false,
    selectedPopularPeriod: "week",
};

const gameList = document.getElementById("game-list");
const statusElement = document.getElementById("status");
const categoryControls = document.getElementById("category-controls");
const categorySearchInput = document.getElementById("category-search");
const showMoreContainer = document.getElementById("show-more-container");

function replaceRouteUrl(relativeUrl) {
    try {
        window.history.replaceState(null, "", relativeUrl);
    } catch {
        // Ignore history errors in restricted frames
    }
}

const categoryController = createCategoryController(state, {
    onFiltersChange: (nextUrl) => {
        replaceRouteUrl(nextUrl);
    },
    onClearFilters: () => {
        if (state.selectedCategory === "dual-screen") {
            openCategory("dual-screen");
            replaceRouteUrl("index.html?category=dual-screen");
            return;
        }
        openCategory("all-games");
        replaceRouteUrl("index.html");
    },
});

const searchController = initSearch({
    onCloseFallback: () => {
        categoryController.displayFilteredGames();
    },
});

function openCategory(category, defaultSort = "added") {
    state.currentView = "category";
    state.selectedPlatform = "";
    state.selectedCategory = category;
    state.selectedGenre = "";
    state.selectedDeveloper = "";
    categoryController.resetCategoryControls(defaultSort);
    categoryController.showCategoryView();
    if (gameList) gameList.hidden = false;
    categoryController.displayFilteredGames();
}

function openPlatform(platform) {
    state.currentView = "category";
    state.selectedPlatform = platform;
    state.selectedCategory = "all-games";
    state.selectedGenre = "";
    state.selectedDeveloper = "";
    categoryController.resetCategoryControls("added");
    categoryController.showCategoryView();
    if (gameList) gameList.hidden = false;
    categoryController.displayFilteredGames();
}

function goHome() {
    openCategory("all-games", "added");
}

const navController = initNavigation({
    mode: "home",
    onGoHome: () => {
        goHome();
        replaceRouteUrl("index.html");
    },
    onSelectAllGames: () => {
        openCategory("all-games", "added");
        replaceRouteUrl("index.html");
    },
    onSelectCategory: (category) => {
        openCategory(
            category,
            category === "multi-game-apps" ? "updated" : "added"
        );
        replaceRouteUrl(`index.html?category=${encodeURIComponent(category)}`);
    },
    onSelectPlatform: (platform) => {
        openPlatform(platform);
        replaceRouteUrl(`index.html?platform=${encodeURIComponent(platform)}`);
    },
    onBeforeOpenMenu: () => searchController.closeSearch(false),
    onActionResetSearch: () => searchController.resetSearchBar(),
});

function applyInitialRouteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const platform = params.get("platform") || "";
    const category = params.get("category") || "";
    const genre = params.get("genre") || "";
    const dev = params.get("dev") || "";
    const view = params.get("view") || "";
    const period = params.get("period") || "";

    if (!platform && !category && !genre && !dev && !view) {
        goHome();
        return;
    }

    searchController.resetSearchBar();

    if (category === "multi-game-apps" && !platform && !genre && !dev) {
        openCategory("multi-game-apps", "updated");
        return;
    }

    let initialSort = "added";
    if (view === "last-updated") {
        initialSort = "updated";
    } else if (view === "popular") {
        initialSort = "popular";
    }

    if (
        view === "popular" &&
        (period === "week" || period === "month" || period === "alltime")
    ) {
        state.selectedPopularPeriod = period;
    }

    state.currentView = "category";
    state.selectedCategory =
        category === "dual-screen" ? "dual-screen" : "all-games";
    state.selectedPlatform = platform.trim();
    state.selectedGenre = genre.trim();
    state.selectedDeveloper = dev.trim();
    categoryController.resetCategoryControls(initialSort);
    categoryController.showCategoryView();
    if (gameList) gameList.hidden = false;
    categoryController.displayFilteredGames();
}

async function initHomePage() {
    if (!statusElement || !gameList) return;

    statusElement.textContent = "";
    gameList.hidden = false;
    if (showMoreContainer) showMoreContainer.hidden = true;
    renderListSkeletons(gameList, 8);

    try {
        const catalog = await loadCatalog();
        state.games = catalog.games;
        state.platformOrder = catalog.platformOrder;

        searchController.setGames(state.games);
        navController.renderPlatforms(state.platformOrder, state.games);
        categoryController.populateFilterOptions(
            state.platformOrder,
            state.games
        );

        applyInitialRouteFromUrl();
    } catch (error) {
        console.error("NAPL: could not load games.", error);
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
}

function setupDismissibleBanner(bannerEl, dismissBtn, storageKey) {
    if (!bannerEl) return;
    try {
        if (localStorage.getItem(storageKey) === "1") {
            bannerEl.dataset.dismissed = "true";
            bannerEl.hidden = true;
        }
    } catch {
        // Ignore storage read errors
    }

    dismissBtn?.addEventListener("click", () => {
        bannerEl.dataset.dismissed = "true";
        bannerEl.hidden = true;
        syncHomeBannersContainer();
        try {
            localStorage.setItem(storageKey, "1");
        } catch {
            // Ignore storage write errors
        }
    });
}

function initFeatureBanners() {
    setupDismissibleBanner(
        homeFeatureBanner,
        homeFeatureDismiss,
        COMPAT_BANNER_STORAGE_KEY
    );
    setupDismissibleBanner(
        homeRateBanner,
        homeRateDismiss,
        RATE_BANNER_STORAGE_KEY
    );
    syncHomeBannersContainer();

    homeRateCta?.addEventListener("click", () => {
        if (state.selectedCategory === "multi-game-apps") {
            openCategory("all-games", "added");
            replaceRouteUrl("index.html");
        }
        categoryControls?.scrollIntoView({ behavior: "smooth", block: "start" });
        categorySearchInput?.focus({ preventScroll: true });
    });
}

initFeatureBanners();
initHomePage();
