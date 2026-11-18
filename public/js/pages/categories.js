/*
 * NAPL — ALL GAMES VIEW, FILTERS & SORTING
 */

import {
    normalizeText,
    normalizePlatformLabel,
    normalizeDeveloperName,
    normalizeYearValue,
    getMatchingDeveloperPort,
    getMatchingPlatformPort,
    extractGameGenres,
    parseLastUpdate,
    parseDateAdded,
    getLatestUpdate,
    getDateAdded,
} from "../core/helpers.js?v=15";
import {
    ensurePopularPeriod,
    getPopularVisits,
    ensureAllTimePopular,
} from "../services/popularity.js?v=14";
import {
    createHomeGameCard,
    getRepresentativePort,
} from "../components/game-card.js?v=18";
import {
    isDualScreen,
    getMultiGameApps,
    sortMultiGameApps,
    createGamesUsingAppSection,
} from "../components/multi-game-apps.js?v=15";

export function createCategoryController(state, options = {}) {
    const { onFiltersChange = null, onClearFilters = null } = options;
    const gameList = document.getElementById("game-list");
    const statusElement = document.getElementById("status");
    const categoryControls = document.getElementById("category-controls");
    const categoryFiltersAccordion = document.getElementById(
        "category-filters-accordion"
    );
    const categoryFiltersToggle = document.getElementById(
        "category-filters-toggle"
    );
    const categoryFiltersPanel = document.getElementById(
        "category-filters-panel"
    );
    const categoryFiltersActiveSummary = document.getElementById(
        "category-filters-active-summary"
    );
    const categoryFiltersContainer = document.getElementById("category-filters");
    const filterTriggerButtons = Array.from(
        document.querySelectorAll(".category-filter-trigger[data-filter-key]")
    );
    const filterSingleClearButtons = Array.from(
        document.querySelectorAll(".category-filter-single-clear[data-clear-filter]")
    );
    const filterValueElements = {
        platform: document.getElementById("filter-platform-value"),
        genre: document.getElementById("filter-genre-value"),
        year: document.getElementById("filter-year-value"),
        developer: document.getElementById("filter-developer-value"),
    };
    const filterTray = document.getElementById("category-filter-tray");
    const filterTrayTitle = document.getElementById("category-filter-tray-title");
    const filterTrayCount = document.getElementById("category-filter-tray-count");
    const filterTrayReset = document.getElementById("category-filter-tray-reset");
    const filterTrayClose = document.getElementById("category-filter-tray-close");
    const filterTraySearchWrap = document.getElementById(
        "category-filter-tray-search-wrap"
    );
    const filterTraySearch = document.getElementById("category-filter-tray-search");
    const filterTrayGrid = document.getElementById("category-filter-tray-grid");
    const activeFilterClear = document.getElementById("active-filter-clear");
    const categorySearchInput = document.getElementById("category-search");
    const categorySortOptions = document.querySelectorAll(".category-sort-option");
    const categorySortDirection = document.getElementById("category-sort-direction");
    const popularPeriodRow = document.getElementById("popular-period-row");
    const popularTabs = document.querySelectorAll(".popular-tab");
    const showMoreContainer = document.getElementById("show-more-container");
    const showMoreButton = document.getElementById("show-more-button");

    const PAGE_SIZE = 10;
    let visibleLimit = PAGE_SIZE;
    let currentList = [];
    let currentMode = "games";
    let renderedCount = 0;
    let catalogPlatformOrder = [];
    let catalogGames = [];
    let multiGameDevKeys = new Set();
    let multiGameDevIndexBuilt = false;
    let filterOptionsDirty = false;
    let idleFilterHandle = 0;
    let activePickerKey = "";
    const dynamicFilterOptions = {
        platform: [],
        genre: [],
        year: [],
        developer: [],
    };

    const FILTER_CONFIG = {
        platform: {
            stateKey: "selectedPlatform",
            defaultLabel: "All Platforms",
            trayTitle: "Select Platform",
            nounSingular: "platform",
            nounPlural: "platforms",
            searchable: true,
            searchPlaceholder: "Filter platforms...",
            normalizer: normalizePlatformForFilter,
        },
        genre: {
            stateKey: "selectedGenre",
            defaultLabel: "All Genres",
            trayTitle: "Select Genre",
            nounSingular: "genre",
            nounPlural: "genres",
            searchable: true,
            searchPlaceholder: "Filter genres...",
            normalizer: normalizeText,
        },
        year: {
            stateKey: "selectedYear",
            defaultLabel: "All Years",
            trayTitle: "Select Year",
            nounSingular: "year",
            nounPlural: "years",
            searchable: false,
            normalizer: normalizeYearForFilter,
        },
        developer: {
            stateKey: "selectedDeveloper",
            defaultLabel: "All Developers",
            trayTitle: "Select Developer",
            nounSingular: "developer",
            nounPlural: "developers",
            searchable: true,
            searchPlaceholder: "Filter developers...",
            normalizer: normalizeDeveloperName,
        },
    };

    function setFiltersOpen(isOpen) {
        const nextOpen = Boolean(isOpen);
        categoryFiltersAccordion?.classList.toggle("is-open", nextOpen);
        categoryFiltersToggle?.setAttribute("aria-expanded", String(nextOpen));
        if (categoryFiltersPanel) {
            categoryFiltersPanel.hidden = !nextOpen;
        }
        if (nextOpen && filterOptionsDirty && catalogGames.length > 0) {
            rebuildDynamicFilterOptions();
            syncTriggerStates();
            renderActiveFilterTray();
        }
        if (!nextOpen) {
            activePickerKey = "";
            renderActiveFilterTray();
            syncTriggerStates();
        }
    }

    function gameMatchesFilters(
        game,
        {
            category = state.selectedCategory,
            platform = "",
            genre = "",
            year = "",
            developer = "",
            query = "",
        } = {}
    ) {
        if (category === "dual-screen" && !isDualScreen(game)) {
            return false;
        }

        const devKey = normalizeDeveloperName(developer);
        const genreKey = normalizeText(genre);
        const yearKey = normalizeYearForFilter(year);
        const platformKey = normalizePlatformForFilter(platform);

        if (developer && !devKey) return false;

        if (devKey && platformKey) {
            const hasMatchingPort = (game.ports || []).some(
                (port) =>
                    normalizeDeveloperName(port?.developer) === devKey &&
                    normalizePlatformForFilter(port?.platform) === platformKey
            );
            if (!hasMatchingPort) return false;
        } else if (devKey) {
            const hasDeveloperPort = (game.ports || []).some(
                (port) => normalizeDeveloperName(port?.developer) === devKey
            );
            if (!hasDeveloperPort) return false;
        } else if (platformKey) {
            const hasPlatform =
                (game.platforms || []).some(
                    (p) => normalizePlatformForFilter(p) === platformKey
                ) ||
                (game.ports || []).some(
                    (port) =>
                        normalizePlatformForFilter(port?.platform) === platformKey
                );
            if (!hasPlatform) return false;
        }

        if (genreKey) {
            const gameGenres = extractGameGenres(game.genre);
            const hasGenre = gameGenres.some(
                (g) => normalizeText(g) === genreKey
            );
            if (!hasGenre) return false;
        }

        if (yearKey) {
            if (normalizeYearForFilter(game?.year) !== yearKey) {
                return false;
            }
        }

        if (query && !normalizeText(game.name).includes(query)) {
            return false;
        }

        return true;
    }

    function rebuildDynamicFilterOptions() {
        ensureMultiGameDevKeys();
        const games = Array.isArray(catalogGames) ? catalogGames : [];
        const query = normalizeText(categorySearchInput?.value || "");
        const selectedDevKey = normalizeDeveloperName(state.selectedDeveloper);
        const selectedPlatformKey = normalizePlatformForFilter(
            state.selectedPlatform
        );

        const gamesForPlatforms = games.filter((game) =>
            gameMatchesFilters(game, {
                category: state.selectedCategory,
                genre: state.selectedGenre,
                year: state.selectedYear,
                developer: state.selectedDeveloper,
                query,
            })
        );

        const platformCounts = new Map();
        for (const game of gamesForPlatforms) {
            const gamePlatformKeys = new Set();
            if (selectedDevKey) {
                for (const port of game?.ports || []) {
                    if (
                        normalizeDeveloperName(port?.developer) !==
                        selectedDevKey
                    ) {
                        continue;
                    }
                    const key = normalizePlatformForFilter(port?.platform);
                    if (key) gamePlatformKeys.add(key);
                }
            } else {
                for (const raw of game?.platforms || []) {
                    const key = normalizePlatformForFilter(raw);
                    if (key) gamePlatformKeys.add(key);
                }
            }
            for (const key of gamePlatformKeys) {
                platformCounts.set(key, (platformCounts.get(key) || 0) + 1);
            }
        }

        const seenPlatforms = new Set();
        const orderedPlatforms = [];
        const platformSources = [
            ...(Array.isArray(catalogPlatformOrder)
                ? catalogPlatformOrder
                : []),
            ...gamesForPlatforms.flatMap((g) => g?.platforms || []),
        ];

        for (const raw of platformSources) {
            const label = normalizePlatformLabel(raw);
            if (!label) continue;
            const key = normalizeText(label);
            if (
                key === "multi-game apps" ||
                key === "multi game apps" ||
                !platformCounts.has(key) ||
                seenPlatforms.has(key)
            ) {
                continue;
            }
            seenPlatforms.add(key);
            orderedPlatforms.push({
                value: label,
                label,
                count: platformCounts.get(key) || 0,
            });
        }
        dynamicFilterOptions.platform = orderedPlatforms;

        const gamesForGenres = games.filter((game) =>
            gameMatchesFilters(game, {
                category: state.selectedCategory,
                platform: state.selectedPlatform,
                year: state.selectedYear,
                developer: state.selectedDeveloper,
                query,
            })
        );

        const genreMap = new Map();
        for (const game of gamesForGenres) {
            for (const genre of extractGameGenres(game?.genre)) {
                const key = normalizeText(genre);
                if (!key) continue;
                const entry = genreMap.get(key);
                if (entry) {
                    entry.count += 1;
                } else {
                    genreMap.set(key, { label: genre, count: 1 });
                }
            }
        }

        dynamicFilterOptions.genre = Array.from(genreMap.values())
            .sort((a, b) =>
                a.label.localeCompare(b.label, "en", { sensitivity: "base" })
            )
            .map((entry) => ({
                value: entry.label,
                label: entry.label,
                count: entry.count,
            }));

        const gamesForYears = games.filter((game) =>
            gameMatchesFilters(game, {
                category: state.selectedCategory,
                platform: state.selectedPlatform,
                genre: state.selectedGenre,
                developer: state.selectedDeveloper,
                query,
            })
        );

        const yearMap = new Map();
        for (const game of gamesForYears) {
            const displayYear = normalizeYearValue(game?.year);
            const key = normalizeYearForFilter(displayYear);
            if (!key) continue;
            const entry = yearMap.get(key);
            if (entry) {
                entry.count += 1;
            } else {
                yearMap.set(key, { label: displayYear, count: 1 });
            }
        }

        dynamicFilterOptions.year = Array.from(yearMap.values())
            .sort((a, b) => {
                const numA = Number.parseInt(a.label, 10);
                const numB = Number.parseInt(b.label, 10);
                if (
                    Number.isFinite(numA) &&
                    Number.isFinite(numB) &&
                    numA !== numB
                ) {
                    return numB - numA;
                }
                return b.label.localeCompare(a.label, "en", {
                    numeric: true,
                    sensitivity: "base",
                });
            })
            .map((entry) => ({
                value: entry.label,
                label: entry.label,
                count: entry.count,
            }));

        const gamesForDevs = games.filter((game) =>
            gameMatchesFilters(game, {
                category: state.selectedCategory,
                platform: state.selectedPlatform,
                genre: state.selectedGenre,
                year: state.selectedYear,
                query,
            })
        );

        const devMap = new Map();
        for (const game of gamesForDevs) {
            const seenInGame = new Set();
            for (const port of game?.ports || []) {
                if (
                    selectedPlatformKey &&
                    normalizePlatformForFilter(port?.platform) !==
                        selectedPlatformKey
                ) {
                    continue;
                }
                const display = String(port?.developer || "")
                    .trim()
                    .replace(/\s+/g, " ");
                const key = normalizeDeveloperName(display);
                if (!key || !multiGameDevKeys.has(key) || seenInGame.has(key)) {
                    continue;
                }
                seenInGame.add(key);

                const entry = devMap.get(key);
                if (entry) {
                    entry.count += 1;
                } else {
                    devMap.set(key, { label: display, count: 1 });
                }
            }
        }

        dynamicFilterOptions.developer = Array.from(devMap.values())
            .sort((a, b) =>
                a.label.localeCompare(b.label, "en", { sensitivity: "base" })
            )
            .map((entry) => ({
                value: entry.label,
                label: entry.label,
                count: entry.count,
            }));
        filterOptionsDirty = false;
    }

    function ensureMultiGameDevKeys() {
        if (multiGameDevIndexBuilt) return;
        multiGameDevIndexBuilt = true;

        const globalDevCounts = new Map();
        for (const game of catalogGames) {
            const seenInGame = new Set();
            for (const port of game?.ports || []) {
                const key = normalizeDeveloperName(port?.developer);
                if (!key || seenInGame.has(key)) continue;
                seenInGame.add(key);
                globalDevCounts.set(key, (globalDevCounts.get(key) || 0) + 1);
            }
        }

        multiGameDevKeys = new Set(
            Array.from(globalDevCounts.entries())
                .filter(([, count]) => count > 1)
                .map(([key]) => key)
        );
    }

    function scheduleIdleFilterWarmup() {
        if (idleFilterHandle || !filterOptionsDirty || catalogGames.length === 0) {
            return;
        }
        const runWarmup = () => {
            idleFilterHandle = 0;
            if (!filterOptionsDirty || catalogGames.length === 0) return;
            rebuildDynamicFilterOptions();
            syncTriggerStates();
        };
        if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
            idleFilterHandle = window.requestIdleCallback(runWarmup, { timeout: 1200 });
        } else if (typeof window !== "undefined") {
            idleFilterHandle = window.setTimeout(runWarmup, 180);
        }
    }

    function populateFilterOptions(platformOrder, games) {
        catalogPlatformOrder = Array.isArray(platformOrder) ? platformOrder : [];
        catalogGames = Array.isArray(games) ? games : [];
        multiGameDevIndexBuilt = false;
        filterOptionsDirty = true;

        if (categoryFiltersAccordion?.classList.contains("is-open")) {
            rebuildDynamicFilterOptions();
        } else {
            scheduleIdleFilterWarmup();
        }
        syncFilterControls();
    }

    function syncSortControls() {
        categorySortOptions.forEach((option) => {
            option.classList.toggle(
                "active",
                option.dataset.sort === state.selectedCategorySort
            );
        });

        popularTabs.forEach((tab) => {
            const active = tab.dataset.period === state.selectedPopularPeriod;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-pressed", String(active));
        });

        const hasAnyFilter = Boolean(
            String(state.selectedPlatform || "").trim() ||
                String(state.selectedGenre || "").trim() ||
                String(state.selectedYear || "").trim() ||
                String(state.selectedDeveloper || "").trim()
        );
        const isMultiGameAppsView =
            state.selectedCategory === "multi-game-apps" && !hasAnyFilter;

        if (popularPeriodRow) {
            popularPeriodRow.hidden =
                state.selectedCategorySort !== "popular" || isMultiGameAppsView;
        }
    }

    function getDisplayValueForFilter(key) {
        const config = FILTER_CONFIG[key];
        if (!config) return "";
        const raw = String(state[config.stateKey] || "").trim();
        if (!raw) return "";

        const normalized = config.normalizer(raw);
        const match = (dynamicFilterOptions[key] || []).find(
            (opt) => config.normalizer(opt.value) === normalized
        );
        return match ? match.label : raw;
    }

    function syncTriggerStates() {
        for (const trigger of filterTriggerButtons) {
            const key = trigger.dataset.filterKey;
            const config = FILTER_CONFIG[key];
            if (!config) continue;

            const displayValue = getDisplayValueForFilter(key);
            const isActive = Boolean(displayValue);
            const isOpen = activePickerKey === key;

            trigger.classList.toggle("is-active", isActive);
            trigger.classList.toggle("is-open", isOpen);
            trigger.setAttribute("aria-expanded", String(isOpen));

            const valueEl = filterValueElements[key];
            if (valueEl) {
                valueEl.textContent = displayValue || config.defaultLabel;
            }
        }

        for (const clearBtn of filterSingleClearButtons) {
            const key = clearBtn.dataset.clearFilter;
            const config = FILTER_CONFIG[key];
            if (!config) continue;
            const hasValue = Boolean(String(state[config.stateKey] || "").trim());
            clearBtn.hidden = !hasValue;
        }
    }

    function renderActiveFilterTray() {
        if (!filterTray || !filterTrayGrid) return;

        if (
            !activePickerKey ||
            !FILTER_CONFIG[activePickerKey] ||
            categoryFiltersAccordion?.hidden ||
            categoryFiltersPanel?.hidden
        ) {
            filterTray.hidden = true;
            filterTrayGrid.replaceChildren();
            return;
        }

        const config = FILTER_CONFIG[activePickerKey];
        const optionsList = dynamicFilterOptions[activePickerKey] || [];
        const currentRaw = String(state[config.stateKey] || "").trim();
        const currentNormalized = config.normalizer(currentRaw);

        if (filterTrayTitle) {
            filterTrayTitle.textContent = config.trayTitle;
        }
        if (filterTrayCount) {
            filterTrayCount.textContent = `${optionsList.length} ${
                optionsList.length === 1
                    ? config.nounSingular
                    : config.nounPlural
            }`;
        }
        if (filterTrayReset) {
            filterTrayReset.hidden = !currentRaw;
        }
        if (filterTraySearchWrap) {
            filterTraySearchWrap.hidden = !config.searchable;
        }
        if (filterTraySearch && config.searchable) {
            const placeholder = config.searchPlaceholder || "Filter options...";
            filterTraySearch.placeholder = placeholder;
            filterTraySearch.setAttribute("aria-label", placeholder);
        }

        const filterQuery = config.searchable
            ? normalizeText(filterTraySearch?.value || "")
            : "";
        const visibleOptions = filterQuery
            ? optionsList.filter((opt) =>
                  normalizeText(opt.label).includes(filterQuery)
              )
            : optionsList;

        filterTrayGrid.dataset.picker = activePickerKey;
        filterTrayGrid.replaceChildren();

        if (visibleOptions.length === 0) {
            const empty = document.createElement("p");
            empty.className = "filter-grid-empty";
            empty.textContent = `No matching ${config.nounPlural}.`;
            filterTrayGrid.appendChild(empty);
            filterTray.hidden = false;
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const opt of visibleOptions) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "filter-grid-option";

            const isSelected = Boolean(
                currentNormalized &&
                    config.normalizer(opt.value) === currentNormalized
            );
            if (isSelected) {
                btn.classList.add("is-selected");
            }
            btn.setAttribute("aria-pressed", String(isSelected));

            const labelSpan = document.createElement("span");
            labelSpan.className = "filter-grid-option-label";
            labelSpan.textContent = opt.label;
            labelSpan.title = `${opt.label} (${opt.count})`;

            const countSpan = document.createElement("span");
            countSpan.className = "filter-grid-option-count";
            countSpan.textContent = String(opt.count);

            btn.append(labelSpan, countSpan);
            btn.addEventListener("click", () => {
                applyFilterSelection(
                    activePickerKey,
                    isSelected ? "" : opt.value,
                    true
                );
            });
            fragment.appendChild(btn);
        }

        filterTrayGrid.appendChild(fragment);
        filterTray.hidden = false;
    }

    function openFilterTray(key) {
        if (!FILTER_CONFIG[key]) return;
        activePickerKey = key;
        if (filterTraySearch) {
            filterTraySearch.value = "";
        }
        syncTriggerStates();
        renderActiveFilterTray();
    }

    function closeFilterTray(restoreFocus = false) {
        const previousKey = activePickerKey;
        activePickerKey = "";
        syncTriggerStates();
        renderActiveFilterTray();
        if (restoreFocus && previousKey) {
            const trigger = filterTriggerButtons.find(
                (btn) => btn.dataset.filterKey === previousKey
            );
            trigger?.focus({ preventScroll: true });
        }
    }

    function syncFilterControls() {
        const activeFilterCount = [
            state.selectedPlatform,
            state.selectedGenre,
            state.selectedYear,
            state.selectedDeveloper,
        ].filter((val) => Boolean(String(val || "").trim())).length;
        const hasAnyFilter = activeFilterCount > 0;

        const isMultiGameAppsView =
            state.selectedCategory === "multi-game-apps" && !hasAnyFilter;

        if (categoryFiltersAccordion) {
            categoryFiltersAccordion.hidden = isMultiGameAppsView;
        }
        if (categoryFiltersContainer) {
            categoryFiltersContainer.hidden = isMultiGameAppsView;
            categoryFiltersContainer.classList.toggle("has-clear", hasAnyFilter);
        }

        if (categoryFiltersActiveSummary) {
            categoryFiltersActiveSummary.hidden = !hasAnyFilter;
            categoryFiltersActiveSummary.textContent = hasAnyFilter
                ? `${activeFilterCount} active`
                : "";
        }

        const filtersVisible =
            Boolean(categoryFiltersAccordion?.classList.contains("is-open")) ||
            Boolean(activePickerKey);

        if (!isMultiGameAppsView && catalogGames.length > 0) {
            if (filtersVisible || hasAnyFilter) {
                rebuildDynamicFilterOptions();
            } else {
                filterOptionsDirty = true;
                scheduleIdleFilterWarmup();
            }
        } else {
            activePickerKey = "";
        }

        if (activeFilterClear) {
            activeFilterClear.hidden = !hasAnyFilter;
        }

        syncTriggerStates();
        if (activePickerKey) {
            renderActiveFilterTray();
        } else if (filterTray) {
            filterTray.hidden = true;
        }
        syncSortControls();
    }

    function updateCategorySortDirection() {
        if (!categorySortDirection) return;
        categorySortDirection.textContent = state.categorySortDescending ? "↑" : "↓";
    }

    function showCategoryView() {
        if (categoryControls) categoryControls.hidden = false;
        syncFilterControls();
    }

    function resetCategoryControls(defaultSort = "added") {
        if (categorySearchInput) categorySearchInput.value = "";
        activePickerKey = "";
        state.selectedCategorySort = defaultSort;
        state.categorySortDescending = false;
        updateCategorySortDirection();
        syncFilterControls();
    }

    function sortGames(list) {
        const sorted = [...list];

        switch (state.selectedCategorySort) {
            case "added":
                sorted.sort((a, b) => {
                    const matchedPortA = state.selectedDeveloper
                        ? getMatchingDeveloperPort(
                              a,
                              state.selectedDeveloper,
                              state.selectedPlatform
                          )
                        : state.selectedPlatform
                        ? getMatchingPlatformPort(a, state.selectedPlatform)
                        : null;
                    const matchedPortB = state.selectedDeveloper
                        ? getMatchingDeveloperPort(
                              b,
                              state.selectedDeveloper,
                              state.selectedPlatform
                          )
                        : state.selectedPlatform
                        ? getMatchingPlatformPort(b, state.selectedPlatform)
                        : null;
                    const dateA =
                        (matchedPortA
                            ? parseDateAdded(matchedPortA.dateAdded)
                            : null) || getDateAdded(a);
                    const dateB =
                        (matchedPortB
                            ? parseDateAdded(matchedPortB.dateAdded)
                            : null) || getDateAdded(b);
                    if (!dateA && !dateB) return 0;
                    if (!dateA) return 1;
                    if (!dateB) return -1;
                    const res = dateB - dateA;
                    return state.categorySortDescending ? -res : res;
                });
                break;

            case "updated":
                sorted.sort((a, b) => {
                    const matchedPortA = state.selectedDeveloper
                        ? getMatchingDeveloperPort(
                              a,
                              state.selectedDeveloper,
                              state.selectedPlatform
                          )
                        : state.selectedPlatform
                        ? getMatchingPlatformPort(a, state.selectedPlatform)
                        : null;
                    const matchedPortB = state.selectedDeveloper
                        ? getMatchingDeveloperPort(
                              b,
                              state.selectedDeveloper,
                              state.selectedPlatform
                          )
                        : state.selectedPlatform
                        ? getMatchingPlatformPort(b, state.selectedPlatform)
                        : null;
                    const dateA =
                        (matchedPortA
                            ? parseLastUpdate(matchedPortA.lastUpdate)
                            : null) || getLatestUpdate(a);
                    const dateB =
                        (matchedPortB
                            ? parseLastUpdate(matchedPortB.lastUpdate)
                            : null) || getLatestUpdate(b);
                    if (!dateA && !dateB) return 0;
                    if (!dateA) return 1;
                    if (!dateB) return -1;
                    const res = dateB - dateA;
                    return state.categorySortDescending ? -res : res;
                });
                break;

            case "name":
                sorted.sort((a, b) => {
                    const res = a.name.localeCompare(b.name, "en", {
                        sensitivity: "base",
                    });
                    return state.categorySortDescending ? -res : res;
                });
                break;

            case "popular":
                sorted.sort((a, b) => {
                    const visitsA = getPopularVisits(
                        a.slug,
                        state.selectedPopularPeriod
                    );
                    const visitsB = getPopularVisits(
                        b.slug,
                        state.selectedPopularPeriod
                    );
                    const res = visitsB - visitsA;
                    if (res !== 0) {
                        return state.categorySortDescending ? -res : res;
                    }
                    return a.name.localeCompare(b.name, "en", {
                        sensitivity: "base",
                    });
                });
                break;
        }

        return sorted;
    }

    function buildActiveReturnUrl() {
        const returnParams = new URLSearchParams();

        if (state.selectedCategory && state.selectedCategory !== "all-games") {
            returnParams.set("category", state.selectedCategory);
        } else if (
            state.selectedPlatform ||
            state.selectedGenre ||
            state.selectedYear ||
            state.selectedDeveloper
        ) {
            returnParams.set("view", "all-games");
        }

        if (state.selectedPlatform) {
            returnParams.set("platform", state.selectedPlatform);
        }
        if (state.selectedGenre) {
            returnParams.set("genre", state.selectedGenre);
        }
        if (state.selectedYear) {
            returnParams.set("year", state.selectedYear);
        }
        if (state.selectedDeveloper) {
            returnParams.set("dev", state.selectedDeveloper);
        }

        const qs = returnParams.toString();
        return qs ? `index.html?${qs}` : "index.html";
    }

    function buildGameCardElement(game, returnUrl) {
        const port = state.selectedDeveloper
            ? getMatchingDeveloperPort(
                  game,
                  state.selectedDeveloper,
                  state.selectedPlatform
              ) || getRepresentativePort(game)
            : state.selectedPlatform
            ? getMatchingPlatformPort(game, state.selectedPlatform) ||
              getRepresentativePort(game)
            : getRepresentativePort(game);
        return createHomeGameCard(game, port, { returnUrl });
    }

    function buildMultiGameAppElement(app) {
        const element = document.createElement("article");
        element.className = "game multi-game-app-card";

        const header = document.createElement("div");
        header.className = "multi-game-app-header";

        const name = document.createElement("h2");
        name.className = "game-name";
        name.textContent = app.name;

        const count = document.createElement("span");
        count.className = "multi-game-app-badge";
        count.textContent = `${app.gameCount} game${
            app.gameCount !== 1 ? "s" : ""
        }`;

        header.append(name, count);
        element.appendChild(header);

        const hasValidDate =
            app.latestUpdate instanceof Date &&
            !Number.isNaN(app.latestUpdate.getTime());

        if (hasValidDate) {
            const meta = document.createElement("div");
            meta.className = "multi-game-app-meta";
            meta.textContent = `Updated ${app.latestUpdate.toLocaleDateString(
                "en-US",
                { month: "short", day: "numeric", year: "numeric" }
            )}`;
            element.appendChild(meta);
        }

        if (Array.isArray(app.games) && app.games.length > 0) {
            const preview = document.createElement("p");
            preview.className = "multi-game-app-preview";
            const sample = app.games.slice(0, 3).map((g) => g.name);
            const remaining = app.games.length - sample.length;
            preview.textContent =
                remaining > 0
                    ? `${sample.join(" · ")} +${remaining} more`
                    : sample.join(" · ");
            element.appendChild(preview);
        }

        element.appendChild(
            createGamesUsingAppSection("Playable Games", app.games, {
                icon: "gamepad",
                showCount: false,
                searchable: true,
            })
        );
        return element;
    }

    function updatePaginationUI() {
        if (!statusElement) return;
        const total = currentList.length;
        const shown = Math.min(renderedCount, total);
        const noun = currentMode === "apps" ? "Multi-game App" : "game";
        const plural = total !== 1 ? "s" : "";

        if (total === 0) {
            statusElement.textContent = `0 ${noun}s`;
        } else if (shown < total) {
            statusElement.textContent = `Showing ${shown} of ${total} ${noun}${plural}`;
        } else {
            statusElement.textContent = `${total} ${noun}${plural}`;
        }

        if (showMoreContainer && showMoreButton) {
            const remaining = total - shown;
            if (remaining > 0) {
                showMoreContainer.hidden = false;
                showMoreButton.textContent = `Show more (${remaining} remaining)`;
            } else {
                showMoreContainer.hidden = true;
            }
        }
    }

    function appendNextBatch() {
        if (!gameList) return;
        const targetCount = Math.min(visibleLimit, currentList.length);
        if (targetCount <= renderedCount) {
            updatePaginationUI();
            return;
        }

        const fragment = document.createDocumentFragment();
        const returnUrl = currentMode === "games" ? buildActiveReturnUrl() : "";

        for (let i = renderedCount; i < targetCount; i++) {
            const item = currentList[i];
            const card =
                currentMode === "apps"
                    ? buildMultiGameAppElement(item)
                    : buildGameCardElement(item, returnUrl);
            const batchIndex = Math.min(i - renderedCount, 10);
            card.style.setProperty("--enter-index", String(batchIndex));
            card.classList.add("is-entering");
            card.addEventListener(
                "animationend",
                () => card.classList.remove("is-entering"),
                { once: true }
            );
            fragment.appendChild(card);
        }

        gameList.appendChild(fragment);
        renderedCount = targetCount;
        updatePaginationUI();
    }

    function displayGames(list) {
        if (!gameList || !statusElement) return;
        gameList.hidden = false;
        gameList.replaceChildren();

        currentMode = "games";
        currentList = Array.isArray(list) ? list : [];
        renderedCount = 0;

        if (currentList.length === 0) {
            const message = document.createElement("div");
            message.className = "no-results";
            message.textContent = "No games found.";
            gameList.appendChild(message);
            updatePaginationUI();
            return;
        }

        appendNextBatch();
    }

    function displayMultiGameApps(list) {
        if (!gameList || !statusElement) return;
        gameList.hidden = false;
        gameList.replaceChildren();

        currentMode = "apps";
        currentList = Array.isArray(list) ? list : [];
        renderedCount = 0;

        if (currentList.length === 0) {
            const message = document.createElement("div");
            message.className = "no-results";
            message.textContent = "No Multi-game Apps found.";
            gameList.appendChild(message);
            updatePaginationUI();
            return;
        }

        appendNextBatch();
    }

    function filterAndSortByQuery(items, getName, query) {
        return items
            .filter((item) => normalizeText(getName(item)).includes(query))
            .sort((a, b) => {
                const nameA = normalizeText(getName(a));
                const nameB = normalizeText(getName(b));
                const startsA = nameA.startsWith(query);
                const startsB = nameB.startsWith(query);
                if (startsA !== startsB) return startsA ? -1 : 1;
                return nameA.localeCompare(nameB, "en", { sensitivity: "base" });
            });
    }

    function normalizePlatformForFilter(value) {
        return normalizeText(normalizePlatformLabel(value));
    }

    function normalizeYearForFilter(value) {
        return normalizeText(normalizeYearValue(value));
    }

    function displayFilteredGames() {
        visibleLimit = PAGE_SIZE;
        syncFilterControls();
        const query = normalizeText(categorySearchInput?.value || "");
        const hasAnyFilter = Boolean(
            state.selectedPlatform ||
                state.selectedGenre ||
                state.selectedYear ||
                state.selectedDeveloper
        );

        if (state.selectedCategory === "multi-game-apps" && !hasAnyFilter) {
            const renderApps = () => {
                const apps = getMultiGameApps(state.games);
                if (query) {
                    displayMultiGameApps(
                        filterAndSortByQuery(apps, (a) => a.name, query)
                    );
                } else {
                    displayMultiGameApps(
                        sortMultiGameApps(
                            apps,
                            state.selectedCategorySort === "added"
                                ? "updated"
                                : state.selectedCategorySort,
                            state.categorySortDescending
                        )
                    );
                }
            };

            if (!query && state.selectedCategorySort === "popular") {
                ensureAllTimePopular().then(renderApps);
                return;
            }

            renderApps();
            return;
        }

        const filtered = state.games.filter((game) =>
            gameMatchesFilters(game, {
                category: state.selectedCategory,
                platform: state.selectedPlatform,
                genre: state.selectedGenre,
                year: state.selectedYear,
                developer: state.selectedDeveloper,
                query,
            })
        );

        const sortedByQuery = query
            ? filterAndSortByQuery(filtered, (g) => g.name, query)
            : null;

        if (!query && state.selectedCategorySort === "popular") {
            ensurePopularPeriod(state.selectedPopularPeriod).then(() => {
                displayGames(sortGames(filtered));
            });
            return;
        }

        displayGames(query ? sortedByQuery : sortGames(filtered));
    }

    function applyFilterSelection(key, value, shouldCloseTray = true) {
        const config = FILTER_CONFIG[key];
        if (!config) return;

        state[config.stateKey] = String(value || "").trim();

        if (!state.selectedCategory) {
            state.selectedCategory = "all-games";
        }

        if (shouldCloseTray) {
            activePickerKey = "";
        }

        onFiltersChange?.(buildActiveReturnUrl());
        displayFilteredGames();
    }

    categoryFiltersToggle?.addEventListener("click", () => {
        setFiltersOpen(Boolean(categoryFiltersPanel?.hidden));
    });

    for (const trigger of filterTriggerButtons) {
        trigger.addEventListener("click", () => {
            const key = trigger.dataset.filterKey;
            if (!key) return;
            if (activePickerKey === key) {
                closeFilterTray(false);
            } else {
                openFilterTray(key);
            }
        });
    }

    for (const clearBtn of filterSingleClearButtons) {
        clearBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            const key = clearBtn.dataset.clearFilter;
            if (!key) return;
            applyFilterSelection(key, "", activePickerKey === key);
        });
    }

    filterTrayReset?.addEventListener("click", () => {
        if (!activePickerKey) return;
        applyFilterSelection(activePickerKey, "", true);
    });

    filterTrayClose?.addEventListener("click", () => {
        closeFilterTray(false);
    });

    filterTraySearch?.addEventListener("input", () => {
        renderActiveFilterTray();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && activePickerKey) {
            closeFilterTray(true);
        }
    });

    activeFilterClear?.addEventListener("click", () => {
        activePickerKey = "";
        if (typeof onClearFilters === "function") {
            onClearFilters();
            return;
        }
        state.selectedPlatform = "";
        state.selectedGenre = "";
        state.selectedYear = "";
        state.selectedDeveloper = "";
        displayFilteredGames();
    });

    categorySearchInput?.addEventListener("input", displayFilteredGames);

    categorySortOptions.forEach((option) => {
        option.addEventListener("click", () => {
            const newSort = option.dataset.sort;
            if (state.selectedCategorySort === newSort) return;

            state.selectedCategorySort = newSort;
            state.categorySortDescending = false;

            syncSortControls();
            updateCategorySortDirection();
            displayFilteredGames();
        });
    });

    popularTabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const period = tab.dataset.period;
            if (!period || state.selectedPopularPeriod === period) return;
            state.selectedPopularPeriod = period;
            syncSortControls();
            displayFilteredGames();
        });
    });

    categorySortDirection?.addEventListener("click", () => {
        state.categorySortDescending = !state.categorySortDescending;
        updateCategorySortDirection();
        displayFilteredGames();
    });

    showMoreButton?.addEventListener("click", () => {
        visibleLimit += PAGE_SIZE;
        appendNextBatch();
    });

    updateCategorySortDirection();
    syncSortControls();

    return {
        populateFilterOptions,
        showCategoryView,
        resetCategoryControls,
        displayFilteredGames,
        setFiltersOpen,
    };
}
