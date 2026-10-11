/*
 * Open menu.
 */

function openMenu() {
    closeSearch();
    sideMenu.classList.add("open");
    menuOverlay.classList.add("open");
}

/*
 * Close menu.
 */

function closeMenu() {
    sideMenu.classList.remove("open");
    menuOverlay.classList.remove("open");
}

/*
 * Toggle search.
 */

function toggleSearch() {
    const isHidden =
        searchContainer.hasAttribute("hidden");

    if (isHidden) {
        searchContainer.removeAttribute("hidden");
        searchInput.focus();
    } else {
        closeSearch();
    }
}

/*
 * Close search.
 */

function closeSearch() {
    if (searchContainer.hasAttribute("hidden")) {
        return;
    }

    searchContainer.setAttribute("hidden", "");

    searchInput.value = "";
    searchResults.innerHTML = "";
    searchResults.hidden = true;

    if (currentView === "category") {
        displayFilteredGames();
    } else {
        gameList.innerHTML = "";
        gameList.hidden = true;
        statusElement.textContent = "";
    }
}

/*
 * Close search outside.
 */

document.addEventListener(
    "click",
    event => {
        if (searchContainer.hasAttribute("hidden")) {
            return;
        }

        const clickedInsideSearch =
            searchContainer.contains(event.target);

        const clickedSearchButton =
            searchButton.contains(event.target);

        if (
            !clickedInsideSearch &&
            !clickedSearchButton
        ) {
            closeSearch();
        }
    }
);

/*
 * Close search on scroll.
 */

window.addEventListener(
    "scroll",
    () => {
        closeSearch();
    },
    {
        passive: true
    }
);

/*
 * Return Home.
 */

function goHome() {
    currentView = "home";
    selectedPlatform = "";
    selectedCategory = "";

    searchInput.value = "";
    searchResults.innerHTML = "";
    searchResults.hidden = true;

    categorySearchInput.value = "";
    selectedCategorySort = "updated";
    categorySortDescending = false;

    updateCategorySortDirection();

    gameList.innerHTML = "";
    gameList.hidden = true;
    statusElement.textContent = "";

    searchContainer.setAttribute("hidden", "");

    showHomeSections();
    closeMenu();
}

/*
 * Show All Games.
 */

function showAllGames() {
    currentView = "category";
    selectedPlatform = "";
    selectedCategory = "all-games";

    resetCategoryControls();

    searchInput.value = "";
    searchResults.innerHTML = "";
    searchResults.hidden = true;

    searchContainer.setAttribute("hidden", "");

    showCategoryView();

    gameList.hidden = false;

    displayFilteredGames();

    closeMenu();
}

/*
 * Create category menu.
 */

function displayPlatformMenu() {
    platformList.innerHTML = "";

    const multiGameButton =
        document.createElement("button");

    multiGameButton.type = "button";
    multiGameButton.className = "platform-button";
    multiGameButton.textContent = "Multi-game Apps";

    multiGameButton.addEventListener(
        "click",
        () => {
            currentView = "category";
            selectedPlatform = "";
            selectedCategory = "multi-game-apps";

            resetCategoryControls();

            searchInput.value = "";
            searchResults.innerHTML = "";
            searchResults.hidden = true;

            searchContainer.setAttribute("hidden", "");

            showCategoryView();
            displayFilteredGames();
            closeMenu();
        }
    );

    platformList.appendChild(multiGameButton);

    const dualScreenButton =
        document.createElement("button");

    dualScreenButton.type = "button";
    dualScreenButton.className = "platform-button";
    dualScreenButton.textContent = "Dual Screen";

    dualScreenButton.addEventListener(
        "click",
        () => {
            currentView = "category";
            selectedPlatform = "";
            selectedCategory = "dual-screen";

            resetCategoryControls();

            searchInput.value = "";
            searchResults.innerHTML = "";
            searchResults.hidden = true;

            searchContainer.setAttribute("hidden", "");

            showCategoryView();
            displayFilteredGames();
            closeMenu();
        }
    );

    platformList.appendChild(dualScreenButton);

    addMenuSeparator("Nintendo");
    addPlatformButton("NES");
    addPlatformButton("Super Nintendo");
    addPlatformButton("Nintendo 64");
    addPlatformButton("GameCube / Wii");
    addPlatformButton("Gameboy / Gameboy Color");
    addPlatformButton("Gameboy Advance");
    addPlatformButton("Nintendo DS");
    addPlatformButton("Nintendo 3DS");

    addMenuSeparator("PlayStation");
    addPlatformButton("Playstation");
    addPlatformButton("Playstation Portable");

    addMenuSeparator("Xbox");
    addPlatformButton("Xbox");
    addPlatformButton("Xbox 360");

    addMenuSeparator("Others");
    addPlatformButton("Others");
}

/*
 * Menu separator.
 */

function addMenuSeparator(title) {
    const separator =
        document.createElement("div");

    separator.className = "menu-separator";
    separator.textContent = "── " + title + " ──";

    platformList.appendChild(separator);
}

/*
 * Platform button.
 */

function addPlatformButton(platform) {
    const button =
        document.createElement("button");

    button.type = "button";
    button.className = "platform-button";
    button.textContent = platform;

    button.addEventListener(
        "click",
        () => {
            currentView = "category";
            selectedPlatform = platform;
            selectedCategory = "";

            resetCategoryControls();

            searchInput.value = "";
            searchResults.innerHTML = "";
            searchResults.hidden = true;

            searchContainer.setAttribute("hidden", "");

            showCategoryView();
            displayFilteredGames();
            closeMenu();
        }
    );

    platformList.appendChild(button);
}

/*
 * Display games.
 */

function displayGames(list) {
    gameList.hidden = false;
    gameList.innerHTML = "";

    if (list.length === 0) {
        gameList.innerHTML = `
            <div class="no-results">
                No games found.
            </div>
        `;

        statusElement.textContent = "0 games";

        return;
    }

    statusElement.textContent =
        `${list.length} game${list.length !== 1 ? "s" : ""}`;

    const fragment =
        document.createDocumentFragment();

    for (const game of list) {
        const element =
            document.createElement("a");

        element.className = "game";

        element.href =
            `game.html?game=${encodeURIComponent(game.slug)}`;

        const name =
            document.createElement("h2");

        name.className = "game-name";
        name.textContent = game.name;

        const info =
            document.createElement("div");

        info.className = "game-info";

        if (game.year) {
            const span =
                document.createElement("span");

            span.textContent = game.year;
            info.appendChild(span);
        }

        const portCount =
            document.createElement("span");

        portCount.textContent =
            `${game.ports.length} port${game.ports.length !== 1 ? "s" : ""}`;

        info.appendChild(portCount);

        element.appendChild(name);
        element.appendChild(info);

        fragment.appendChild(element);
    }

    gameList.appendChild(fragment);
}

/*
 * Global search suggestions.
 */

function searchGames() {
    const query =
        normalizeText(searchInput.value);

    searchResults.innerHTML = "";

    if (!query) {
        searchResults.hidden = true;
        return;
    }

    const filtered =
        games
            .filter(game =>
                normalizeText(game.name).includes(query)
            )
            .sort(
                (a, b) => {
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
                }
            )
            .slice(0, 5);

    if (filtered.length === 0) {
        searchResults.hidden = true;
        return;
    }

    const fragment =
        document.createDocumentFragment();

    for (const game of filtered) {
        const element =
            document.createElement("a");

        element.className = "search-result";

        element.href =
            `game.html?game=${encodeURIComponent(game.slug)}`;

        element.textContent = game.name;

        fragment.appendChild(element);
    }

    searchResults.appendChild(fragment);
    searchResults.hidden = false;
}

/*
 * Search while typing.
 */

searchInput.addEventListener(
    "input",
    searchGames
);

/*
 * Search button.
 */

searchButton.addEventListener(
    "click",
    event => {
        event.stopPropagation();
        toggleSearch();
    }
);

/*
 * Home button.
 */

homeButton.addEventListener(
    "click",
    goHome
);

/*
 * Menu events.
 */

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

/*
 * All Games.
 */

allGamesButton.addEventListener(
    "click",
    showAllGames
);
