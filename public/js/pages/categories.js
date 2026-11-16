/*
 * NAPL — ALL GAMES VIEW, FILTERS & SORTING
 */

import {
    normalizeText,
    normalizePlatformLabel,
    normalizeDeveloperName,
    getMatchingDeveloperPort,
    getMatchingPlatformPort,
    extractGameGenres,
    parseLastUpdate,
    parseDateAdded,
    getLatestUpdate,
    getDateAdded,
} from "../core/helpers.js?v=14";
import {
    ensurePopularPeriod,
    getPopularVisits,
    ensureAllTimePopular,
} from "../services/popularity.js?v=14";
import {
    createHomeGameCard,
    getRepresentativePort,
} from "../components/game-card.js?v=14";
import {
    isDualScreen,
    getMultiGameApps,
    sortMultiGameApps,
    createGamesUsingAppSection,
} from "../components/multi-game-apps.js?v=14";

export function createCategoryController(state, options = {}) {
    const { onFiltersChange = null, onClearFilters = null } = options;
    const gameList = document.getElementById("game-list");
    const statusElement = document.getElementById("status");
    const categoryControls = document.getElementById("category-controls");
    const categoryFiltersContainer = document.getElementById("category-filters");
    const platformFilterSelect = document.getElementById("filter-platform");
    const genreFilterSelect = document.getElementById("filter-genre");
    const developerFilterSelect = document.getElementById("filter-developer");
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

    function setSelectToMatchedValue(selectEl, targetValue, normalizer) {
        if (!selectEl) return;
        const normalizedTarget = normalizer(targetValue);
        if (!normalizedTarget) {
            selectEl.value = "";
            selectEl.classList.remove("is-active");
            return;
        }

        const matchedOption = Array.from(selectEl.options).find(
            (opt) => opt.value && normalizer(opt.value) === normalizedTarget
        );

        if (matchedOption) {
            selectEl.value = matchedOption.value;
        } else {
            const fallbackOption = document.createElement("option");
            fallbackOption.value = String(targetValue).trim();
            fallbackOption.textContent = String(targetValue).trim();
            fallbackOption.dataset.dynamicFallback = "1";
            selectEl.appendChild(fallbackOption);
            selectEl.value = fallbackOption.value;
        }
        selectEl.classList.add("is-active");
    }

    function populateFilterOptions(platformOrder, games) {
        if (platformFilterSelect) {
            platformFilterSelect.replaceChildren();
            const defaultOpt = document.createElement("option");
            defaultOpt.value = "";
            defaultOpt.textContent = "All Platforms";
            platformFilterSelect.appendChild(defaultOpt);

            const availablePlatforms = new Set();
            for (const game of games || []) {
                for (const raw of game?.platforms || []) {
                    const key = normalizeText(normalizePlatformLabel(raw));
                    if (key) availablePlatforms.add(key);
                }
            }

            const seenPlatforms = new Set();
            const orderedPlatforms = [];
            const sources = [
                ...(Array.isArray(platformOrder) ? platformOrder : []),
                ...(games || []).flatMap((g) => g?.platforms || []),
            ];

            for (const raw of sources) {
                const label = normalizePlatformLabel(raw);
                if (!label) continue;
                const key = normalizeText(label);
                if (
                    key === "multi-game apps" ||
                    key === "multi game apps" ||
                    !availablePlatforms.has(key) ||
                    seenPlatforms.has(key)
                ) {
                    continue;
                }
                seenPlatforms.add(key);
                orderedPlatforms.push(label);
            }

            for (const platform of orderedPlatforms) {
                const option = document.createElement("option");
                option.value = platform;
                option.textContent = platform;
                platformFilterSelect.appendChild(option);
            }
        }

        if (genreFilterSelect) {
            genreFilterSelect.replaceChildren();
            const defaultOpt = document.createElement("option");
            defaultOpt.value = "";
            defaultOpt.textContent = "All Genres";
            genreFilterSelect.appendChild(defaultOpt);

            const genreMap = new Map();
            for (const game of games || []) {
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

            const sortedGenres = Array.from(genreMap.values()).sort((a, b) =>
                a.label.localeCompare(b.label, "en", { sensitivity: "base" })
            );

            for (const entry of sortedGenres) {
                const option = document.createElement("option");
                option.value = entry.label;
                option.textContent = `${entry.label} (${entry.count})`;
                genreFilterSelect.appendChild(option);
            }
        }

        if (developerFilterSelect) {
            developerFilterSelect.replaceChildren();
            const defaultOpt = document.createElement("option");
            defaultOpt.value = "";
            defaultOpt.textContent = "All Developers";
            developerFilterSelect.appendChild(defaultOpt);

            const devMap = new Map();
            for (const game of games || []) {
                const seenInGame = new Set();
                for (const port of game?.ports || []) {
                    const display = String(port?.developer || "")
                        .trim()
                        .replace(/\s+/g, " ");
                    const key = normalizeDeveloperName(display);
                    if (!key || seenInGame.has(key)) continue;
                    seenInGame.add(key);

                    const entry = devMap.get(key);
                    if (entry) {
                        entry.count += 1;
                    } else {
                        devMap.set(key, { label: display, count: 1 });
                    }
                }
            }

            const sortedDevs = Array.from(devMap.values())
                .filter((entry) => entry.count > 1)
                .sort((a, b) =>
                    a.label.localeCompare(b.label, "en", { sensitivity: "base" })
                );

            for (const entry of sortedDevs) {
                const option = document.createElement("option");
                option.value = entry.label;
                option.textContent = `${entry.label} (${entry.count})`;
                developerFilterSelect.appendChild(option);
            }
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
                String(state.selectedDeveloper || "").trim()
        );
        const isMultiGameAppsView =
            state.selectedCategory === "multi-game-apps" && !hasAnyFilter;

        if (popularPeriodRow) {
            popularPeriodRow.hidden =
                state.selectedCategorySort !== "popular" || isMultiGameAppsView;
        }
    }

    function syncFilterControls() {
        const hasAnyFilter = Boolean(
            String(state.selectedPlatform || "").trim() ||
                String(state.selectedGenre || "").trim() ||
                String(state.selectedDeveloper || "").trim()
        );

        const isMultiGameAppsView =
            state.selectedCategory === "multi-game-apps" && !hasAnyFilter;

        if (categoryFiltersContainer) {
            categoryFiltersContainer.hidden = isMultiGameAppsView;
        }

        setSelectToMatchedValue(
            platformFilterSelect,
            state.selectedPlatform,
            (v) => normalizeText(normalizePlatformLabel(v))
        );
        setSelectToMatchedValue(
            genreFilterSelect,
            state.selectedGenre,
            normalizeText
        );
        setSelectToMatchedValue(
            developerFilterSelect,
            state.selectedDeveloper,
            normalizeDeveloperName
        );

        if (activeFilterClear) {
            activeFilterClear.hidden = !hasAnyFilter;
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
            fragment.appendChild(
                currentMode === "apps"
                    ? buildMultiGameAppElement(item)
                    : buildGameCardElement(item, returnUrl)
            );
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

    function displayFilteredGames() {
        visibleLimit = PAGE_SIZE;
        syncFilterControls();
        const query = normalizeText(categorySearchInput?.value || "");
        const hasAnyFilter = Boolean(
            state.selectedPlatform ||
                state.selectedGenre ||
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

        const devKey = normalizeDeveloperName(state.selectedDeveloper);
        const genreKey = normalizeText(state.selectedGenre);
        const platformKey = normalizePlatformForFilter(state.selectedPlatform);

        const filtered = state.games.filter((game) => {
            if (state.selectedCategory === "dual-screen" && !isDualScreen(game)) {
                return false;
            }

            if (state.selectedDeveloper) {
                if (!devKey) return false;
                const hasDeveloperPort = (game.ports || []).some(
                    (port) => normalizeDeveloperName(port?.developer) === devKey
                );
                if (!hasDeveloperPort) return false;
            }

            if (state.selectedGenre) {
                const gameGenres = extractGameGenres(game.genre);
                const hasGenre = gameGenres.some(
                    (g) => normalizeText(g) === genreKey
                );
                if (!hasGenre) return false;
            }

            if (
                state.selectedPlatform &&
                !(game.platforms || []).some(
                    (platform) =>
                        normalizePlatformForFilter(platform) === platformKey
                )
            ) {
                return false;
            }

            if (!query) return true;
            return normalizeText(game.name).includes(query);
        });

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

    function handleSelectChange() {
        state.selectedPlatform = platformFilterSelect?.value || "";
        state.selectedGenre = genreFilterSelect?.value || "";
        state.selectedDeveloper = developerFilterSelect?.value || "";

        if (!state.selectedCategory) {
            state.selectedCategory = "all-games";
        }

        onFiltersChange?.(buildActiveReturnUrl());
        displayFilteredGames();
    }

    platformFilterSelect?.addEventListener("change", handleSelectChange);
    genreFilterSelect?.addEventListener("change", handleSelectChange);
    developerFilterSelect?.addEventListener("change", handleSelectChange);

    activeFilterClear?.addEventListener("click", () => {
        if (typeof onClearFilters === "function") {
            onClearFilters();
            return;
        }
        state.selectedPlatform = "";
        state.selectedGenre = "";
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
    };
}
