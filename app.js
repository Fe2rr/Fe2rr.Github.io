async function loadGames() {
    try {
        statusElement.textContent = "Loading games...";

        const response = await fetch(SHEET_URL);

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }

        const csv = await response.text();
        const rows = parseCSV(csv);

        if (rows.length === 0) {
            throw new Error("The sheet contains no data.");
        }

        const processedRows = processRows(rows);

        games = groupGames(processedRows);

        games.sort((a, b) =>
            a.name.localeCompare(
                b.name,
                "en",
                { sensitivity: "base" }
            )
        );

        displayPlatformMenu();
        displayLastAdded();
        displayLastUpdated();
        loadPopular();

        statusElement.textContent = "";
    } catch (error) {
        console.error(error);

        statusElement.textContent = "";
        gameList.hidden = false;

        gameList.innerHTML = `
            <div class="error">
                <strong>Could not load the games.</strong>
                <br><br>
                ${error.message}
            </div>
        `;
    }
}

updateCategorySortDirection();

loadGames();
