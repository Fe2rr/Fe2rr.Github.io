
/*
 * NAPL — MAIN APPLICATION
 *
 * Loads games from Google Sheets, groups the ports
 * and initializes the home page sections.
 * Supports opening categories through URL parameters.
 */


/*
 * LOAD GAMES
 */

/*
 * API GAME -> HOME MODEL
 */

function toGameModel(game) {
    const ports = game.ports.map(port => ({
        game: game.name,
        year: game.year,
        platform: port.platform,
        project: port.project,
        developer: port.developer,
        portId: port.port_id,
        lastUpdate: port.last_update,
        dateAdded: port.date_added,
        coverUrl: game.cover_url,
        genre: game.genre,
        description: ""
    }));

    return {
        name: game.name,
        year: game.year,
        slug: game.slug,
        coverUrl: game.cover_url,
        genre: game.genre,
        description: "",
        ports,
        platforms: [...new Set(ports.map(port => port.platform).filter(Boolean))]
    };
}


async function loadGames() {

    if (!statusElement || !gameList) {
        console.error(
            "The Ports Vault: required elements for loading games are missing."
        );
        return;
    }

    statusElement.textContent = "Loading games...";
    gameList.replaceChildren();
    gameList.hidden = false;

    try {

        const response = await fetch(`${API_BASE}/api/games`);

        if (!response.ok) {
            throw new Error(
                `The catalog returned HTTP ${response.status}.`
            );
        }

        const data = await response.json();

        if (!Array.isArray(data.games) || data.games.length === 0) {
            throw new Error("The catalog returned no games.");
        }

        platformOrder = data.platforms.filter(platform => {
            const key = normalizeText(platform);
            return key !== "multi-game apps" && key !== "multi game apps";
        });

        games = data.games.map(toGameModel);

        allTimePopular = new Map(
            data.games.map(game => [game.slug, Number(game.visits) || 0])
        );
        allTimePopularLoaded = true;

        /*
         * Render the menu and home page sections.
         */

        displayPlatformMenu();
        displayLastAdded();
        displayLastUpdated();
        loadPopular();

        /*
         * Clear the loading message before displaying
         * the selected category or platform.
         */

        statusElement.textContent = "";

        /*
         * Open the requested view, if the URL contains
         * a supported parameter.
         */

        applyInitialRouteFromUrl();

    } catch (error) {

        console.error(
            "The Ports Vault: could not load games.",
            error
        );

        statusElement.textContent = "";
        gameList.hidden = false;
        gameList.replaceChildren();

        const errorContainer =
            document.createElement("div");

        errorContainer.className = "error";

        const errorTitle =
            document.createElement("strong");

        errorTitle.textContent =
            "Could not load the games.";

        const errorMessage =
            document.createElement("p");

        errorMessage.textContent =
            error instanceof Error
                ? error.message
                : "An unexpected error occurred.";

        const retryButton =
            document.createElement("button");

        retryButton.type = "button";
        retryButton.className = "retry-button";
        retryButton.textContent = "Try again";

        retryButton.addEventListener("click", () => {
            loadGames();
        });

        errorContainer.append(
            errorTitle,
            errorMessage,
            retryButton
        );

        gameList.appendChild(errorContainer);
    }
}


/*
 * APPLY INITIAL VIEW FROM URL
 *
 * Supported examples:
 * index.html?platform=NES
 * index.html?platform=Super%20Nintendo
 * index.html?category=multi-game-apps
 * index.html?category=dual-screen
 * index.html?view=all-games
 */

function applyInitialRouteFromUrl() {

    const params = new URLSearchParams(
        window.location.search
    );

    const platform = params.get("platform");
    const category = params.get("category");
    const view = params.get("view");

    /*
     * No supported route parameter:
     * leave the normal home page unchanged.
     */

    if (!platform && !category && !view) {
        return false;
    }

    /*
     * Reset search fields and hide global search.
     */

    if (typeof searchInput !== "undefined") {
        searchInput.value = "";
    }

    if (typeof searchResults !== "undefined") {
        searchResults.innerHTML = "";
        searchResults.hidden = true;
    }

    if (typeof searchContainer !== "undefined") {
        searchContainer.setAttribute("hidden", "");
    }

    if (typeof categorySearchInput !== "undefined") {
        categorySearchInput.value = "";
    }

    /*
     * Show all games.
     */

    if (view === "all-games") {
        showAllGames();
        return true;
    }

    /*
     * Open a special category.
     */

    if (
        category === "multi-game-apps" ||
        category === "dual-screen"
    ) {

        currentView = "category";
        selectedPlatform = "";
        selectedCategory = category;

        resetCategoryControls();
        showCategoryView();

        gameList.hidden = false;
        displayFilteredGames();

        return true;
    }

    /*
     * Open a platform.
     */

    if (platform) {

        currentView = "category";
        selectedPlatform = platform;
        selectedCategory = "";

        resetCategoryControls();
        showCategoryView();

        gameList.hidden = false;
        displayFilteredGames();

        return true;
    }

    return false;
}


/*
 * INITIALIZE CATEGORY SORT DIRECTION
 */

updateCategorySortDirection();


/*
 * START THE APPLICATION
 */

loadGames();
