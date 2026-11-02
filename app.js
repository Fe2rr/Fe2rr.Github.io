
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

        const response = await fetch(SHEET_URL, {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(
                `The spreadsheet returned HTTP ${response.status}.`
            );
        }

        const csv = await response.text();

        if (!csv || !csv.trim()) {
            throw new Error(
                "The spreadsheet returned an empty response."
            );
        }

        const rows = parseCSV(csv);

        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error(
                "No rows were found in the spreadsheet."
            );
        }

        /*
         * Preserve the order of first appearance of platforms
         * in the original spreadsheet, before processing games
         * or sorting them alphabetically.
         */

        const uniquePlatforms = new Map();

        for (const row of rows) {

            const platform = getColumn(row, [
                "PLATFORM",
                "PLATAFORM",
                "PLATAFORMA"
            ]).trim();

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

        platformOrder = Array.from(
            uniquePlatforms.values()
        );

        const processedRows = processRows(rows);

        if (
            !Array.isArray(processedRows) ||
            processedRows.length === 0
        ) {
            throw new Error(
                "No valid game entries were found. Check the spreadsheet column names and data."
            );
        }

        /*
         * Group all ports belonging to the same game.
         */

        const groupedGames = groupGames(processedRows);

        if (groupedGames.length === 0) {
            throw new Error(
                "The spreadsheet could not be grouped into games."
            );
        }

        /*
         * Update shared application state.
         */

        games = groupedGames;

        /*
         * Keep the home page game ordering alphabetical.
         * The platform menu uses platformOrder separately.
         */

        games.sort((a, b) =>
            a.name.localeCompare(
                b.name,
                "en",
                { sensitivity: "base" }
            )
        );

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
