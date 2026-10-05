/*
 * GOOGLE SHEETS
 */

const SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";


const gameList =
    document.getElementById("game-list");

const searchInput =
    document.getElementById("search");

const searchContainer =
    document.getElementById("search-container");

const searchButton =
    document.getElementById("search-button");

const homeButton =
    document.getElementById("home-button");

const lastUpdatedList =
    document.getElementById("last-updated-list");

const lastUpdatedMore =
    document.getElementById("last-updated-more");

const statusElement =
    document.getElementById("status");

const menuButton =
    document.getElementById("menu-button");

const menuClose =
    document.getElementById("menu-close");

const sideMenu =
    document.getElementById("side-menu");

const menuOverlay =
    document.getElementById("menu-overlay");

const platformList =
    document.getElementById("platform-list");

const allGamesButton =
    document.getElementById("all-games-button");


let games = [];

let selectedPlatform = "";

let selectedCategory = "";

let showingAllLastUpdated = false;


/*
 * Normalize column names.
 */
function normalizeHeader(value) {

    return value
        .replace(/^\uFEFF/, "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/*
 * Normalize text.
 */
function normalizeText(value) {

    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/*
 * Create game slug.
 */
function createSlug(name) {

    return normalizeText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


/*
 * CSV parser.
 */
function parseCSV(csv) {

    const rows = [];

    let row = [];
    let field = "";
    let insideQuotes = false;


    for (let i = 0; i < csv.length; i++) {

        const char = csv[i];


        if (char === '"') {

            if (
                insideQuotes &&
                csv[i + 1] === '"'
            ) {

                field += '"';

                i++;

            } else {

                insideQuotes = !insideQuotes;
            }

            continue;
        }


        if (
            char === "," &&
            !insideQuotes
        ) {

            row.push(field);

            field = "";

            continue;
        }


        if (
            (char === "\n" || char === "\r") &&
            !insideQuotes
        ) {

            if (
                char === "\r" &&
                csv[i + 1] === "\n"
            ) {
                i++;
            }


            row.push(field);

            field = "";


            if (
                row.some(
                    value =>
                        value.trim() !== ""
                )
            ) {

                rows.push(row);
            }


            row = [];

            continue;
        }


        field += char;
    }


    if (
        field.length > 0 ||
        row.length > 0
    ) {

        row.push(field);


        if (
            row.some(
                value =>
                    value.trim() !== ""
            )
        ) {

            rows.push(row);
        }
    }


    if (rows.length === 0) {
        return [];
    }


    const headers =
        rows.shift().map(
            normalizeHeader
        );


    return rows.map(values => {

        const rowObject = {};


        headers.forEach(
            (header, index) => {

                rowObject[header] =
                    (values[index] || "").trim();

            }
        );


        return rowObject;
    });
}


/*
 * Find a column.
 */
function getColumn(
    row,
    possibleNames
) {

    for (const name of possibleNames) {

        const normalizedName =
            normalizeHeader(name);


        if (
            Object.prototype.hasOwnProperty.call(
                row,
                normalizedName
            )
        ) {

            return row[normalizedName];
        }
    }


    return "";
}


/*
 * Convert CSV rows.
 */
function processRows(rows) {

    let currentGame = "";

    let currentYear = "";

    const result = [];


    for (const row of rows) {

        const gameValue =
            getColumn(row, [
                "GAME",
                "GAME NAME",
                "NAME",
                "JUEGO"
            ]).trim();


        const yearValue =
            getColumn(row, [
                "YEAR",
                "ANO",
                "AÑO"
            ]).trim();


        if (gameValue) {
            currentGame = gameValue;
        }


        if (yearValue) {
            currentYear = yearValue;
        }


        const platform =
            getColumn(row, [
                "PLATFORM",
                "PLATAFORM",
                "PLATAFORMA"
            ]).trim();


        const project =
            getColumn(row, [
                "PROJECT",
                "PROYECTO"
            ]);


        const link =
            getColumn(row, [
                "LINK",
                "PROJECT LINK",
                "ENLACE"
            ]);


        const url =
            getColumn(row, [
                "URL"
            ]);


        const developer =
            getColumn(row, [
                "DEVELOPER",
                "DEVELOPER/PUBLISHER",
                "DESARROLLADOR"
            ]);


        const version =
            getColumn(row, [
                "VERSION",
                "VERSIÓN"
            ]);


        const controller =
            getColumn(row, [
                "CONTROLLER SUPPORT",
                "CONTROLLER",
                "GAMEPAD",
                "MANDO"
            ]);


        const files =
            getColumn(row, [
                "NEEDS GAME FILES?",
                "NEEDS GAME FILES",
                "GAME FILES",
                "NECESITA ARCHIVOS"
            ]);


        const works =
            getColumn(row, [
                "WORKS?",
                "WORKS",
                "FUNCIONA"
            ]);


        const lastUpdate =
            getColumn(row, [
                "LAST UPDATE",
                "LAST UPDATED",
                "ÚLTIMA ACTUALIZACIÓN"
            ]);


        const notes =
            getColumn(row, [
                "NOTES",
                "NOTE",
                "NOTAS"
            ]);


        const hasPortData =
            project ||
            link ||
            url ||
            developer ||
            version ||
            controller ||
            files ||
            works ||
            lastUpdate ||
            notes;


        if (
            !currentGame ||
            !hasPortData
        ) {
            continue;
        }


        result.push({

            game: currentGame,

            year: currentYear,

            platform: platform,

            project: project.trim(),

            link: link.trim(),

            url: url.trim(),

            developer: developer.trim(),

            version: version.trim(),

            controller: controller.trim(),

            files: files.trim(),

            works: works.trim(),

            lastUpdate: lastUpdate.trim(),

            notes: notes.trim()

        });
    }


    return result;
}


/*
 * Convert LAST UPDATE into a Date.
 *
 * Supported:
 *
 * 2026, October 2
 * 2026, October
 *
 * If the day is missing, the last
 * day of the month is used only
 * for sorting.
 */
function parseLastUpdate(value) {

    if (!value) {
        return null;
    }


    const match =
        String(value)
            .trim()
            .match(
                /^(\d{4})\s*,\s*([A-Za-z]+)(?:\s+(\d{1,2}))?$/
            );


    if (!match) {
        return null;
    }


    const year =
        Number(match[1]);


    const monthName =
        match[2].toLowerCase();


    const day =
        match[3]
            ? Number(match[3])
            : 0;


    const months = {

        january: 0,
        february: 1,
        march: 2,
        april: 3,
        may: 4,
        june: 5,
        july: 6,
        august: 7,
        september: 8,
        october: 9,
        november: 10,
        december: 11

    };


    if (
        !Object.prototype.hasOwnProperty.call(
            months,
            monthName
        )
    ) {
        return null;
    }


    const month =
        months[monthName];


    const actualDay =
        day ||
        new Date(
            year,
            month + 1,
            0
        ).getDate();


    return new Date(
        year,
        month,
        actualDay
    );
}


/*
 * Get latest update of a game.
 */
function getLatestUpdate(game) {

    const dates =
        game.ports
            .map(
                port =>
                    parseLastUpdate(
                        port.lastUpdate
                    )
            )
            .filter(
                date =>
                    date !== null
            );


    if (dates.length === 0) {
        return null;
    }


    return dates.reduce(
        (latest, current) =>
            current > latest
                ? current
                : latest
    );
}


/*
 * Display Last Updated.
 */
function displayLastUpdated() {

    const sortedGames =
        games
            .map(game => ({

                game: game,

                lastUpdate:
                    getLatestUpdate(game)

            }))
            .filter(
                item =>
                    item.lastUpdate !== null
            )
            .sort(
                (a, b) =>
                    b.lastUpdate -
                    a.lastUpdate
            );


    lastUpdatedList.innerHTML = "";


    if (sortedGames.length === 0) {

        lastUpdatedMore.hidden = true;

        return;
    }


    const visibleGames =
        showingAllLastUpdated
            ? sortedGames
            : sortedGames.slice(0, 10);


    const fragment =
        document.createDocumentFragment();


    for (const item of visibleGames) {

        const element =
            document.createElement("a");


        element.className =
            "home-game";


        element.href =
            `game.html?game=${encodeURIComponent(
                item.game.slug
            )}`;


        element.textContent =
            item.game.name;


        fragment.appendChild(
            element
        );
    }


    lastUpdatedList.appendChild(
        fragment
    );


    if (
        sortedGames.length > 10 &&
        !showingAllLastUpdated
    ) {

        lastUpdatedMore.hidden = false;

    } else {

        lastUpdatedMore.hidden = true;
    }
}


/*
 * View more button.
 */
lastUpdatedMore.addEventListener(
    "click",
    () => {

        showingAllLastUpdated = true;

        displayLastUpdated();
    }
);


/*
 * Group ports by game.
 */
function groupGames(rows) {

    const grouped = new Map();


    for (const port of rows) {

        const key =
            normalizeText(port.game);


        if (!grouped.has(key)) {

            grouped.set(
                key,
                {
                    name: port.game,
                    year: port.year,
                    slug: createSlug(port.game),
                    ports: [],
                    platforms: new Set()
                }
            );
        }


        const game =
            grouped.get(key);


        if (
            !game.year &&
            port.year
        ) {
            game.year = port.year;
        }


        if (port.platform) {

            game.platforms.add(
                port.platform
            );
        }


        game.ports.push(port);
    }


    return Array.from(
        grouped.values()
    ).map(game => {

        game.platforms =
            Array.from(
                game.platforms
            );

        return game;
    });
}


/*
 * Check Dual Screen.
 */
function isDualScreen(game) {

    return game.ports.some(
        port =>
            normalizeText(port.project)
                .includes("dual screen")
    );
}


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
        searchContainer.hasAttribute(
            "hidden"
        );


    if (isHidden) {

        searchContainer.removeAttribute(
            "hidden"
        );

        searchInput.focus();

    } else {

        closeSearch();
    }
}


/*
 * Close search.
 */
function closeSearch() {

    if (
        searchContainer.hasAttribute(
            "hidden"
        )
    ) {

        return;
    }


    searchContainer.setAttribute(
        "hidden",
        ""
    );


    searchInput.value = "";


    displayFilteredGames();
}


/*
 * Close search outside.
 */
document.addEventListener(
    "click",
    event => {

        if (
            searchContainer.hasAttribute(
                "hidden"
            )
        ) {

            return;
        }


        const clickedInsideSearch =
            searchContainer.contains(
                event.target
            );


        const clickedSearchButton =
            searchButton.contains(
                event.target
            );


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

    selectedPlatform = "";

    selectedCategory = "";

    searchInput.value = "";

    gameList.innerHTML = "";

    gameList.hidden = true;

    statusElement.textContent = "";

    searchContainer.setAttribute(
        "hidden",
        ""
    );

    closeMenu();
}


/*
 * Show All Games.
 */
function showAllGames() {

    selectedPlatform = "";

    selectedCategory = "";

    searchInput.value = "";

    gameList.hidden = false;

    displayFilteredGames();

    closeMenu();
}


/*
 * Create category menu.
 */
function displayPlatformMenu() {

    platformList.innerHTML = "";


    const allButton =
        document.createElement("button");


    allButton.type =
        "button";


    allButton.className =
        "platform-button";


    allButton.textContent =
        "All Categories";


    allButton.addEventListener(
        "click",
        () => {

            selectedPlatform = "";

            selectedCategory = "";

            displayFilteredGames();

            closeMenu();
        }
    );


    platformList.appendChild(
        allButton
    );


    const multiGameButton =
        document.createElement("button");


    multiGameButton.type =
        "button";


    multiGameButton.className =
        "platform-button";


    multiGameButton.textContent =
        "Multi-game Apps";


    multiGameButton.addEventListener(
        "click",
        () => {

            selectedPlatform = "";

            selectedCategory =
                "multi-game-apps";

            displayFilteredGames();

            closeMenu();
        }
    );


    platformList.appendChild(
        multiGameButton
    );


    const dualScreenButton =
        document.createElement("button");


    dualScreenButton.type =
        "button";


    dualScreenButton.className =
        "platform-button";


    dualScreenButton.textContent =
        "Dual Screen";


    dualScreenButton.addEventListener(
        "click",
        () => {

            selectedPlatform = "";

            selectedCategory =
                "dual-screen";

            displayFilteredGames();

            closeMenu();
        }
    );


    platformList.appendChild(
        dualScreenButton
    );


    addMenuSeparator(
        "Nintendo"
    );

    addPlatformButton(
        "NES"
    );

    addPlatformButton(
        "Super Nintendo"
    );

    addPlatformButton(
        "Nintendo 64"
    );

    addPlatformButton(
        "GameCube / Wii"
    );

    addPlatformButton(
        "Gameboy / Gameboy Color"
    );

    addPlatformButton(
        "Gameboy Advance"
    );

    addPlatformButton(
        "Nintendo DS"
    );

    addPlatformButton(
        "Nintendo 3DS"
    );


    addMenuSeparator(
        "PlayStation"
    );

    addPlatformButton(
        "Playstation"
    );

    addPlatformButton(
        "Playstation Portable"
    );


    addMenuSeparator(
        "Xbox"
    );

    addPlatformButton(
        "Xbox"
    );

    addPlatformButton(
        "Xbox 360"
    );


    addMenuSeparator(
        "Others"
    );

    addPlatformButton(
        "Others"
    );
}


/*
 * Menu separator.
 */
function addMenuSeparator(title) {

    const separator =
        document.createElement("div");


    separator.className =
        "menu-separator";


    separator.textContent =
        "── " + title + " ──";


    platformList.appendChild(
        separator
    );
}


/*
 * Platform button.
 */
function addPlatformButton(platform) {

    const button =
        document.createElement("button");


    button.type =
        "button";


    button.className =
        "platform-button";


    button.textContent =
        platform;


    button.addEventListener(
        "click",
        () => {

            selectedPlatform =
                platform;

            selectedCategory = "";

            displayFilteredGames();

            closeMenu();
        }
    );


    platformList.appendChild(
        button
    );
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


        statusElement.textContent =
            "0 games";


        return;
    }


    statusElement.textContent =
        `${list.length} game${list.length !== 1 ? "s" : ""}`;


    const fragment =
        document.createDocumentFragment();


    for (const game of list) {

        const element =
            document.createElement("a");


        element.className =
            "game";


        element.href =
            `game.html?game=${encodeURIComponent(game.slug)}`;


        const name =
            document.createElement("h2");


        name.className =
            "game-name";


        name.textContent =
            game.name;


        const info =
            document.createElement("div");


        info.className =
            "game-info";


        if (game.year) {

            const span =
                document.createElement("span");


            span.textContent =
                game.year;


            info.appendChild(
                span
            );
        }


        const portCount =
            document.createElement("span");


        portCount.textContent =
            `${game.ports.length} port${game.ports.length !== 1 ? "s" : ""}`;


        info.appendChild(
            portCount
        );


        element.appendChild(
            name
        );


        element.appendChild(
            info
        );


        fragment.appendChild(
            element
        );
    }


    gameList.appendChild(
        fragment
    );
}


/*
 * Filter games.
 */
function displayFilteredGames() {

    const query =
        normalizeText(
            searchInput.value
        );


    const filtered =
        games.filter(game => {

            if (
                selectedCategory !== "multi-game-apps" &&
                game.platforms.some(
                    platform =>
                        normalizeText(platform) ===
                        "multi-game apps"
                )
            ) {

                return false;
            }


            if (
                selectedCategory === "multi-game-apps" &&
                !game.platforms.some(
                    platform =>
                        normalizeText(platform) ===
                        "multi-game apps"
                )
            ) {

                return false;
            }


            if (
                selectedCategory === "dual-screen" &&
                !isDualScreen(game)
            ) {

                return false;
            }


            if (
                selectedPlatform &&
                !game.platforms.some(
                    platform =>
                        normalizeText(platform) ===
                        normalizeText(selectedPlatform)
                )
            ) {

                return false;
            }


            if (!query) {
                return true;
            }


            const searchableText = [

                game.name,

                game.year,

                ...game.ports.map(port => [

                    port.project,

                    port.developer,

                    port.version,

                    port.notes

                ].join(" "))

            ]
                .join(" ")
                .toLowerCase();


            return normalizeText(
                searchableText
            ).includes(query);
        });


    displayGames(
        filtered
    );
}


/*
 * Search.
 */
function searchGames() {

    displayFilteredGames();
}


/*
 * Load Google Sheets.
 */
async function loadGames() {

    try {

        statusElement.textContent =
            "Loading games...";


        const response =
            await fetch(SHEET_URL);


        if (!response.ok) {

            throw new Error(
                `HTTP error ${response.status}`
            );
        }


        const csv =
            await response.text();


        const rows =
            parseCSV(csv);


        if (rows.length === 0) {

            throw new Error(
                "The sheet contains no data."
            );
        }


        const processedRows =
            processRows(rows);


        games =
            groupGames(processedRows);


        games.sort(
            (a, b) =>
                a.name.localeCompare(
                    b.name,
                    "en",
                    {
                        sensitivity: "base"
                    }
                )
        );


        displayPlatformMenu();

        displayLastUpdated();


        statusElement.textContent = "";


    } catch (error) {

        console.error(error);


        statusElement.textContent = "";


        gameList.hidden = false;


        gameList.innerHTML = `
            <div class="error">

                <strong>
                    Could not load the games.
                </strong>

                <br><br>

                ${error.message}

            </div>
        `;
    }
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


/*
 * Start.
 */
loadGames();
