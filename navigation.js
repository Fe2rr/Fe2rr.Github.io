/*
 * NAPL — NAVIGATION
 * Builds the platform menu dynamically from Google Sheets.
 * Uses the redesigned compact game cards in category views.
 * Branch: Nuevo-Formato
 */


/* OPEN MENU */

function openMenu() {
    closeSearch();
    sideMenu.classList.add("open");
    menuOverlay.classList.add("visible");
}


/* CLOSE MENU */

function closeMenu() {
    sideMenu.classList.remove("open");
    menuOverlay.classList.remove("visible");
}


/* TOGGLE SEARCH */

function toggleSearch() {
    const isHidden = searchContainer.hasAttribute("hidden");

    if (isHidden) {
        searchContainer.removeAttribute("hidden");
        searchButton.setAttribute("aria-expanded", "true");
        searchInput.focus();
    } else {
        closeSearch();
    }
}


/* CLOSE SEARCH */

function closeSearch() {
    if (searchContainer.hasAttribute("hidden")) {
        return;
    }

    searchContainer.setAttribute("hidden", "");
    searchButton.setAttribute("aria-expanded", "false");

    searchInput.value = "";
    searchResults.replaceChildren();
    searchResults.hidden = true;

    if (currentView === "category") {
        displayFilteredGames();
    } else {
        gameList.replaceChildren();
        gameList.hidden = true;
        statusElement.textContent = "";
    }
}


/* CLOSE SEARCH WHEN CLICKING OUTSIDE */

document.addEventListener("click", event => {
    if (searchContainer.hasAttribute("hidden")) {
        return;
    }

    const clickedInsideSearch =
        searchContainer.contains(event.target);

    const clickedSearchButton =
        searchButton.contains(event.target);

    if (!clickedInsideSearch && !clickedSearchButton) {
        closeSearch();
    }
});


/* CLOSE SEARCH ON SCROLL */

window.addEventListener(
    "scroll",
    () => {
        closeSearch();
    },
    {
        passive: true
    }
);


/* RETURN HOME */

function goHome() {
    currentView = "home";
    selectedPlatform = "";
    selectedCategory = "";

    searchInput.value = "";
    searchResults.replaceChildren();
    searchResults.hidden = true;

    categorySearchInput.value = "";
    selectedCategorySort = "updated";
    categorySortDescending = false;

    updateCategorySortDirection();

    categorySortOptions.forEach(option => {
        option.classList.toggle(
            "active",
            option.dataset.sort === selectedCategorySort
        );
    });

    gameList.replaceChildren();
    gameList.hidden = true;
    statusElement.textContent = "";

    searchContainer.setAttribute("hidden", "");
    searchButton.setAttribute("aria-expanded", "false");

    showHomeSections();
    closeMenu();
}


/* SHOW ALL GAMES */

function showAllGames() {
    currentView = "category";
    selectedPlatform = "";
    selectedCategory = "all-games";

    resetCategoryControls();

    searchInput.value = "";
    searchResults.replaceChildren();
    searchResults.hidden = true;

    searchContainer.setAttribute("hidden", "");
    searchButton.setAttribute("aria-expanded", "false");

    showCategoryView();

    gameList.hidden = false;

    displayFilteredGames();

    closeMenu();
}


/* NORMALIZE PLATFORM LABELS */

function normalizePlatformLabel(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ");
}


/*
 * GET UNIQUE PLATFORMS FROM LOADED SHEET DATA
 *
 * Preserves the order of first appearance.
 * Removes duplicates without sorting alphabetically.
 */

function getAvailablePlatforms() {
    const uniquePlatforms = new Map();

    if (!Array.isArray(games)) {
        return [];
    }

    for (const game of games) {
        if (!Array.isArray(game.platforms)) {
            continue;
        }

        for (const rawPlatform of game.platforms) {
            const platform = normalizePlatformLabel(rawPlatform);

            if (!platform) {
                continue;
            }

            const key = normalizeText(platform);

            if (
                key === "multi-game apps" ||
                key === "multi game apps"
            ) {
                continue;
            }

            if (!uniquePlatforms.has(key)) {
                uniquePlatforms.set(key, platform);
            }
        }
    }

    return Array.from(uniquePlatforms.values());
}


/* GROUP PLATFORMS BY FAMILY */

function getPlatformGroup(platform) {
    const normalized = normalizeText(platform);

    if (
        normalized === "others" ||
        normalized === "other"
    ) {
        return "Others";
    }

    if (normalized.includes("playstation")) {
        return "PlayStation";
    }

    if (normalized.startsWith("xbox")) {
        return "Xbox";
    }

    if (
        normalized.includes("nintendo") ||
        normalized.includes("game boy") ||
        normalized.includes("gameboy") ||
        normalized.includes("gamecube") ||
        normalized === "nes"
    ) {
        return "Nintendo";
    }

    return "Other Platforms";
}


/* CREATE CATEGORY BUTTON */

function addCategoryButton(label, category) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "platform-button";
    button.textContent = label;

    button.addEventListener("click", () => {
        currentView = "category";
        selectedPlatform = "";
        selectedCategory = category;

        resetCategoryControls();

        searchInput.value = "";
        searchResults.replaceChildren();
        searchResults.hidden = true;

        searchContainer.setAttribute("hidden", "");
        searchButton.setAttribute("aria-expanded", "false");

        showCategoryView();
        displayFilteredGames();

        closeMenu();
    });

    platformList.appendChild(button);
}


/* CREATE THE PLATFORM MENU DYNAMICALLY */

function displayPlatformMenu() {
    if (!platformList) {
        console.error(
            "NAPL: platform menu element was not found."
        );
        return;
    }

    platformList.replaceChildren();

    addCategoryButton(
        "Multi-Game Apps",
        "multi-game-apps"
    );

    addCategoryButton(
        "Dual Screen",
        "dual-screen"
    );

    const platforms = getAvailablePlatforms();

    const groupOrder = [
        "Nintendo",
        "PlayStation",
        "Xbox",
        "Others",
        "Other Platforms"
    ];

    const groupedPlatforms = new Map(
        groupOrder.map(group => [group, []])
    );

    for (const platform of platforms) {
        const group = getPlatformGroup(platform);

        if (!groupedPlatforms.has(group)) {
            groupedPlatforms.set(group, []);
            groupOrder.push(group);
        }

        groupedPlatforms.get(group).push(platform);
    }

    for (const group of groupOrder) {
        const groupPlatforms = groupedPlatforms.get(group);

        if (!groupPlatforms || groupPlatforms.length === 0) {
            continue;
        }

        addMenuSeparator(group);

        for (const platform of groupPlatforms) {
            addPlatformButton(platform);
        }
    }

    if (platforms.length === 0) {
        const message = document.createElement("div");

        message.className = "menu-separator";
        message.textContent = "No platforms available";

        platformList.appendChild(message);
    }
}


/* MENU SEPARATOR */

function addMenuSeparator(title) {
    const separator = document.createElement("div");

    separator.className = "menu-separator";
    separator.textContent = "── " + title + " ──";

    platformList.appendChild(separator);
}


/* PLATFORM BUTTON */

function addPlatformButton(platform) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "platform-button";
    button.textContent = platform;

    button.addEventListener("click", () => {
        currentView = "category";
        selectedPlatform = platform;
        selectedCategory = "";

        resetCategoryControls();

        searchInput.value = "";
        searchResults.replaceChildren();
        searchResults.hidden = true;

        searchContainer.setAttribute("hidden", "");
        searchButton.setAttribute("aria-expanded", "false");

        showCategoryView();
        displayFilteredGames();

        closeMenu();
    });

    platformList.appendChild(button);
}


/*
 * DISPLAY GAMES
 *
 * Uses the same compact cards as the home page.
 * Keeps the game links and category result count.
 */

function displayGames(list) {
    gameList.hidden = false;
    gameList.replaceChildren();

    if (!Array.isArray(list) || list.length === 0) {
        const message = document.createElement("div");

        message.className = "no-results";
        message.textContent = "No games found.";

        gameList.appendChild(message);
        statusElement.textContent = "0 games";

        return;
    }

    statusElement.textContent =
        `${list.length} game${list.length !== 1 ? "s" : ""}`;

    const fragment = document.createDocumentFragment();

    for (const game of list) {
        const port = typeof getRepresentativePort === "function"
            ? getRepresentativePort(game)
            : null;

        const card = createHomeGameCard(game, port);

        fragment.appendChild(card);
    }

    gameList.appendChild(fragment);
}


/* GLOBAL SEARCH SUGGESTIONS */

function searchGames() {
    const query = normalizeText(searchInput.value);

    searchResults.replaceChildren();

    if (!query) {
        searchResults.hidden = true;
        return;
    }

    const filtered = games
        .filter(game =>
            normalizeText(game.name).includes(query)
        )
        .sort((a, b) => {
            const nameA = normalizeText(a.name);
            const nameB = normalizeText(b.name);

            const startsA = nameA.startsWith(query);
            const startsB = nameB.startsWith(query);

            if (startsA && !startsB) {
                return -1;
            }

            if (!startsA && startsB) {
                return 1;
            }

            return nameA.localeCompare(
                nameB,
                "en",
                {
                    sensitivity: "base"
                }
            );
        })
        .slice(0, 5);

    if (filtered.length === 0) {
        searchResults.hidden = true;
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const game of filtered) {
        const element = document.createElement("a");

        element.className = "search-result";
        element.href =
            `game.html?game=${encodeURIComponent(game.slug)}`;

        element.textContent = game.name;

        fragment.appendChild(element);
    }

    searchResults.appendChild(fragment);
    searchResults.hidden = false;
}


/* SEARCH WHILE TYPING */

searchInput.addEventListener(
    "input",
    searchGames
);


/* SEARCH BUTTON */

searchButton.addEventListener(
    "click",
    event => {
        event.stopPropagation();
        toggleSearch();
    }
);


/* HOME BUTTON */

homeButton.addEventListener(
    "click",
    goHome
);


/* MENU EVENTS */

menuButton.addEventListener(
    "click",
    openMenu
);

menuClose.addEventListener(
    "click",
    closeMenu
);

menuOverlay.addEventListener(
    "click",
    closeMenu
);


/* ALL GAMES BUTTON */

allGamesButton.addEventListener(
    "click",
    showAllGames
);
