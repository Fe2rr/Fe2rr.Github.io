
/*
 * NAPL — MAIN APPLICATION
 *
 * Loads the games from Google Sheets, groups the
 * ports and initializes the home page sections.
 */


/*
 * LOAD GAMES
 */

async function loadGames() {
    if (!statusElement || !gameList) {
        console.error(
            "NAPL: required elements for loading games are missing."
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

        games.sort((a, b) =>
            a.name.localeCompare(
                b.name,
                "en",
                { sensitivity: "base" }
            )
        );

        /*
         * Render the home page after the data is ready.
         */

        displayPlatformMenu();
        displayLastAdded();
        displayLastUpdated();
        loadPopular();

        statusElement.textContent = "";

    } catch (error) {
        console.error("NAPL: could not load games.", error);

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
 * INITIALIZE CATEGORY SORT DIRECTION
 */

updateCategorySortDirection();


/*
 * START THE APPLICATION
 */

loadGames();
