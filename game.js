/*
 * GOOGLE SHEETS
 */

const SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";


/*
 * VISIT COUNTER
 */
const VISITS_URL =
    "https://script.google.com/macros/s/AKfycbyBIziL3y23bPeAkNdMVtNPvLO-fmiPsnxcmUlg3Y7NR_ZXQ4sJIv5sdu9dqLkOBr5l/exec";


const gameTitle =
    document.getElementById("game-title");

const gameYear =
    document.getElementById("game-year");

const portList =
    document.getElementById("port-list");

const statusElement =
    document.getElementById("status");


/*
 * Normalize headers.
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
 * Create the same slug used by app.js.
 */
function createSlug(name) {

    return normalizeText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


/*
 * Register a game visit.
 */
function registerVisit(gameSlug) {

    if (!gameSlug) {
        return;
    }


    const url =
        `${VISITS_URL}?game=${encodeURIComponent(gameSlug)}`;


    fetch(
        url,
        {
            method: "GET",
            mode: "no-cors",
            keepalive: true
        }
    ).catch(
        error => {
            console.error(
                "Could not register game visit:",
                error
            );
        }
    );
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


        /*
         * Quotes.
         */
        if (char === '"') {

            if (
                insideQuotes &&
                csv[i + 1] === '"'
            ) {

                field += '"';
                i++;

            } else {

                insideQuotes =
                    !insideQuotes;
            }

            continue;
        }


        /*
         * Comma outside quotes.
         */
        if (
            char === "," &&
            !insideQuotes
        ) {

            row.push(field);
            field = "";

            continue;
        }


        /*
         * End of row.
         */
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


    /*
     * Last field.
     */
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


    /*
     * First row = headers.
     */
    const headers =
        rows.shift().map(
            normalizeHeader
        );


    /*
     * Convert rows into objects.
     */
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
function getColumn(row, possibleNames) {

    for (const name of possibleNames) {

        const key =
            normalizeHeader(name);


        if (
            Object.prototype.hasOwnProperty.call(
                row,
                key
            )
        ) {

            return row[key];
        }
    }


    return "";
}


/*
 * Process rows.
 *
 * GAME and YEAR can be merged in Google Sheets.
 *
 * If GAME is empty, the game from the
 * previous row is inherited.
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


        /*
         * Update current game.
         */
        if (gameValue) {
            currentGame = gameValue;
        }


        /*
         * Update current year.
         */
        if (yearValue) {
            currentYear = yearValue;
        }


        /*
         * PLATFORM.
         */
        const platform =
            getColumn(row, [
                "PLATFORM",
                "PLATAFORM",
                "PLATAFORMA"
            ]);


        /*
         * Project name.
         */
        const project =
            getColumn(row, [
                "PROJECT",
                "PROYECTO"
            ]);


        /*
         * LINK = text displayed on the button.
         */
        const link =
            getColumn(row, [
                "LINK",
                "PROJECT LINK",
                "ENLACE"
            ]);


        /*
         * URL = actual destination.
         */
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


        /*
         * Determine whether this row contains
         * port information.
         */
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

            platform: platform.trim(),

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
 * Get the requested game from the URL.
 */
function getRequestedGame() {

    const params =
        new URLSearchParams(
            window.location.search
        );


    return params.get("game") || "";
}


/*
 * Display an information row.
 */
function createInfoRow(
    label,
    value
) {

    if (!value) {
        return null;
    }


    const row =
        document.createElement("div");


    row.className =
        "port-info-row";


    const labelElement =
        document.createElement("span");


    labelElement.className =
        "port-info-label";


    labelElement.textContent =
        label;


    const valueElement =
        document.createElement("span");


    valueElement.className =
        "port-info-value";


    valueElement.textContent =
        value;


    row.appendChild(labelElement);
    row.appendChild(valueElement);


    return row;
}


/*
 * Check whether the selected entry is
 * a Multi-game App.
 */
function isMultiGameApp(game) {

    return game.ports.some(
        port =>
            normalizeText(port.platform) ===
            "multi-game apps"
    );
}


/*
 * Check whether a specific port uses
 * a Multi-game App.
 */
function isMultiGameAppPort(
    port,
    allRows
) {

    if (!port.project) {
        return false;
    }


    const projectName =
        normalizeText(port.project);


    return allRows.some(
        row =>
            normalizeText(row.platform) ===
            "multi-game apps" &&
            normalizeText(row.game) ===
            projectName
    );
}


/*
 * Find games that use this Multi-game App.
 *
 * A game uses the app when its PROJECT
 * matches the app name.
 */
function findGamesUsingApp(
    appName,
    allRows
) {

    const appNameNormalized =
        normalizeText(appName);


    const gamesUsingApp =
        new Map();


    for (const row of allRows) {

        if (
            !row.game ||
            !row.project
        ) {
            continue;
        }


        /*
         * Do not include the app itself.
         */
        if (
            normalizeText(row.game) ===
            appNameNormalized
        ) {
            continue;
        }


        /*
         * PROJECT must match the app name.
         */
        if (
            normalizeText(row.project) !==
            appNameNormalized
        ) {
            continue;
        }


        const key =
            normalizeText(row.game);


        if (
            !gamesUsingApp.has(key)
        ) {

            gamesUsingApp.set(
                key,
                {
                    name: row.game,
                    year: row.year
                }
            );
        }
    }


    return Array.from(
        gamesUsingApp.values()
    ).sort(
        (a, b) =>
            a.name.localeCompare(
                b.name,
                "en",
                {
                    sensitivity: "base"
                }
            )
    );
}


/*
 * Display the list of games that use
 * a Multi-game App.
 *
 * parentElement allows the list to be
 * placed inside a specific port card.
 */
function displayGamesUsingApp(
    appName,
    allRows,
    parentElement = portList
) {

    const gamesUsingApp =
        findGamesUsingApp(
            appName,
            allRows
        );


    if (
        gamesUsingApp.length === 0
    ) {
        return;
    }


    const section =
        document.createElement("section");


    section.className =
        "games-using-app";


    /*
     * Collapsible header.
     */
    const toggle =
        document.createElement("button");


    toggle.type =
        "button";


    toggle.className =
        "games-using-app-toggle";


    toggle.setAttribute(
        "aria-expanded",
        "false"
    );


    const title =
        document.createElement("span");


    title.textContent =
        "With this port you can also play:";


    const arrow =
        document.createElement("span");


    arrow.className =
        "games-using-app-arrow";


    arrow.textContent =
        "▼";


    toggle.appendChild(title);
    toggle.appendChild(arrow);


    /*
     * Game list.
     */
    const list =
        document.createElement("div");


    list.className =
        "games-using-app-list";


    list.hidden = true;


    for (
        const game
        of gamesUsingApp
    ) {

        const link =
            document.createElement("a");


        link.className =
            "games-using-app-item";


        link.href =
            `game.html?game=${encodeURIComponent(
                createSlug(game.name)
            )}`;


        link.textContent =
            game.name;


        if (game.year) {

            const year =
                document.createElement("span");


            year.textContent =
                ` (${game.year})`;


            link.appendChild(year);
        }


        list.appendChild(link);
    }


    /*
     * Toggle open / closed.
     */
    toggle.addEventListener(
        "click",
        () => {

            const isOpen =
                toggle.getAttribute(
                    "aria-expanded"
                ) === "true";


            toggle.setAttribute(
                "aria-expanded",
                String(!isOpen)
            );


            list.hidden =
                isOpen;


            arrow.textContent =
                isOpen
                    ? "▼"
                    : "▲";
        }
    );


    section.appendChild(toggle);
    section.appendChild(list);


    parentElement.appendChild(section);
}


/*
 * Display the selected game.
 */
function displayGame(
    game,
    allRows
) {

    gameTitle.textContent =
        game.name;


    gameYear.textContent =
        game.year || "";


    statusElement.textContent =
        `${game.ports.length} port${game.ports.length !== 1 ? "s" : ""}`;


    portList.innerHTML = "";


    for (
        let index = 0;
        index < game.ports.length;
        index++
    ) {

        const port =
            game.ports[index];


        const card =
            document.createElement("div");


        card.className =
            "port";


        /*
         * Port title.
         */
        const title =
            document.createElement("h2");


        title.className =
            "port-title";


        title.textContent =
            port.project ||
            `Port ${index + 1}`;


        card.appendChild(title);


        /*
         * Port information.
         */
        const info =
            document.createElement("div");


        info.className =
            "port-info";


        const fields = [

            ["Developer", port.developer],

            ["Version", port.version],

            ["Supported Inputs", port.controller],

            ["Needs Game Files?", port.files],

            ["Works?", port.works],

            ["Last Update", port.lastUpdate]

        ];


        for (
            const [label, value]
            of fields
        ) {

            const row =
                createInfoRow(
                    label,
                    value
                );


            if (row) {
                info.appendChild(row);
            }
        }


        card.appendChild(info);


        /*
         * Notes.
         */
        if (port.notes) {

            const notes =
                document.createElement("div");


            notes.className =
                "port-notes";


            const notesTitle =
                document.createElement("strong");


            notesTitle.textContent =
                "Notes";


            const notesText =
                document.createElement("p");


            notesText.textContent =
                port.notes;


            notes.appendChild(notesTitle);
            notes.appendChild(notesText);


            card.appendChild(notes);
        }


        /*
         * Port link.
         *
         * LINK = button text.
         * URL = destination.
         */
        if (port.url) {

            const link =
                document.createElement("a");


            link.className =
                "port-link";


            link.href =
                port.url;


            link.target =
                "_blank";


            link.rel =
                "noopener noreferrer";


            link.textContent =
                port.link ||
                "Open Port →";


            card.appendChild(link);
        }


        /*
         * Add the port card to the page.
         */
        portList.appendChild(card);


        /*
         * If this specific port uses a
         * Multi-game App, display the
         * other games supported by it.
         */
        if (
            isMultiGameAppPort(
                port,
                allRows
            )
        ) {

            displayGamesUsingApp(
                port.project,
                allRows,
                card
            );
        }
    }


    /*
     * If this is a Multi-game App,
     * display the games that use it.
     */
    if (
        isMultiGameApp(game)
    ) {

        /*
         * Keep the original behavior
         * for the Multi-game App page.
         */
        const gamesUsingApp =
            findGamesUsingApp(
                game.name,
                allRows
            );


        if (
            gamesUsingApp.length > 0
        ) {

            const section =
                document.createElement("section");


            section.className =
                "games-using-app";


            /*
             * Collapsible header.
             */
            const toggle =
                document.createElement("button");


            toggle.type =
                "button";


            toggle.className =
                "games-using-app-toggle";


            toggle.setAttribute(
                "aria-expanded",
                "false"
            );


            const title =
                document.createElement("span");


            title.textContent =
                "Games using this app";


            const arrow =
                document.createElement("span");


            arrow.className =
                "games-using-app-arrow";


            arrow.textContent =
                "▼";


            toggle.appendChild(title);
            toggle.appendChild(arrow);


            /*
             * Game list.
             */
            const list =
                document.createElement("div");


            list.className =
                "games-using-app-list";


            list.hidden = true;


            for (
                const compatibleGame
                of gamesUsingApp
            ) {

                const link =
                    document.createElement("a");


                link.className =
                    "games-using-app-item";


                link.href =
                    `game.html?game=${encodeURIComponent(
                        createSlug(
                            compatibleGame.name
                        )
                    )}`;


                link.textContent =
                    compatibleGame.name;


                if (
                    compatibleGame.year
                ) {

                    const year =
                        document.createElement("span");


                    year.textContent =
                        ` (${compatibleGame.year})`;


                    link.appendChild(year);
                }


                list.appendChild(link);
            }


            /*
             * Toggle open / closed.
             */
            toggle.addEventListener(
                "click",
                () => {

                    const isOpen =
                        toggle.getAttribute(
                            "aria-expanded"
                        ) === "true";


                    toggle.setAttribute(
                        "aria-expanded",
                        String(!isOpen)
                    );


                    list.hidden =
                        isOpen;


                    arrow.textContent =
                        isOpen
                            ? "▼"
                            : "▲";
                }
            );


            section.appendChild(toggle);
            section.appendChild(list);


            portList.appendChild(section);
        }
    }
}


/*
 * Load the selected game.
 */
async function loadGame() {

    try {

        const requestedGame =
            getRequestedGame();


        /*
         * Make sure a game was specified.
         */
        if (!requestedGame) {

            throw new Error(
                "No game was specified."
            );
        }


        /*
         * Register the visit.
         */
        registerVisit(requestedGame);


        statusElement.textContent =
            "Loading ports...";


        /*
         * Abort the request if Google Sheets
         * does not respond within 15 seconds.
         */
        const controller =
            new AbortController();


        const timeout =
            setTimeout(
                () => controller.abort(),
                15000
            );


        let response;


        try {

            response =
                await fetch(
                    SHEET_URL,
                    {
                        signal:
                            controller.signal
                    }
                );

        } finally {

            clearTimeout(timeout);
        }


        if (!response.ok) {

            throw new Error(
                `HTTP error ${response.status}`
            );
        }


        /*
         * Read CSV.
         */
        const csv =
            await response.text();


        if (
            !csv ||
            !csv.trim()
        ) {

            throw new Error(
                "Google Sheets returned an empty response."
            );
        }


        /*
         * Parse CSV.
         */
        const rows =
            parseCSV(csv);


        if (rows.length === 0) {

            throw new Error(
                "The Google Sheet contains no data."
            );
        }


        /*
         * Process ports.
         */
        const processedRows =
            processRows(rows);


        if (
            processedRows.length === 0
        ) {

            throw new Error(
                "No ports were found in the Google Sheet."
            );
        }


        /*
         * Find the requested game.
         */
        const matchingRows =
            processedRows.filter(
                row =>
                    createSlug(row.game) ===
                    requestedGame
            );


        if (
            matchingRows.length === 0
        ) {

            throw new Error(
                `Game not found: ${requestedGame}`
            );
        }


        /*
         * Build game object.
         */
        const game = {

            name:
                matchingRows[0].game,

            year:
                matchingRows[0].year,

            ports:
                matchingRows

        };


        /*
         * Update browser title.
         */
        document.title =
            `${game.name} - Community Android Ports`;


        /*
         * Display game.
         */
        displayGame(
            game,
            processedRows
        );


    } catch (error) {

        console.error(
            "Could not load game:",
            error
        );


        gameTitle.textContent =
            "Error";


        gameYear.textContent =
            "";


        statusElement.textContent =
            "";


        let message =
            error.message;


        /*
         * Special message for a timeout.
         */
        if (
            error.name === "AbortError"
        ) {

            message =
                "Google Sheets did not respond within 15 seconds.";
        }


        portList.innerHTML = `
            <div class="error">

                <strong>
                    Could not load the game.
                </strong>

                <br><br>

                ${message}

            </div>
        `;
    }
}


/*
 * Start.
 */
loadGame();
