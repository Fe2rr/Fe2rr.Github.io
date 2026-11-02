/*
 * THE PORTS VAULT — MULTI-GAME APPS
 *
 * Groups games, detects shared projects and renders
 * the Multi-game Apps category.
 *
 * Uses shared helpers and state defined by the main
 * application scripts.
 */


/*
 * GROUP PORTS BY GAME
 */

function groupGames(rows) {

    const grouped = new Map();

    if (!Array.isArray(rows)) {
        return [];
    }

    for (const port of rows) {

        if (!port || !port.game) {
            continue;
        }

        const key = normalizeText(port.game);

        if (!grouped.has(key)) {

            grouped.set(key, {
                name: port.game,
                year: port.year || "",
                slug: createSlug(port.game),

                coverUrl: port.coverUrl || "",
                genre: port.genre || "",
                description: port.description || "",

                ports: [],
                platforms: new Set()
            });

        }

        const game = grouped.get(key);

        /*
         * Preserve the first available year.
         */

        if (!game.year && port.year) {
            game.year = port.year;
        }

        /*
         * Preserve game metadata.
         *
         * Some spreadsheet rows may not contain
         * all metadata, so fill only missing values.
         */

        if (!game.coverUrl && port.coverUrl) {
            game.coverUrl = port.coverUrl;
        }

        if (!game.genre && port.genre) {
            game.genre = port.genre;
        }

        if (!game.description && port.description) {
            game.description = port.description;
        }

        /*
         * Collect platforms and keep every port.
         */

        if (port.platform) {
            game.platforms.add(port.platform);
        }

        game.ports.push(port);

    }

    return Array.from(grouped.values()).map(game => ({

        ...game,

        platforms: Array.from(game.platforms)

    }));

}


/*
 * CHECK DUAL SCREEN
 */

function isDualScreen(game) {

    if (!game || !Array.isArray(game.ports)) {
        return false;
    }

    return game.ports.some(port =>
        normalizeText(port?.project).includes("dual screen")
    );

}


/*
 * BUILD MULTI-GAME APPS
 *
 * An app qualifies when it is explicitly marked as
 * Multi-game Apps or its project is used by more
 * than one distinct game.
 */

function getMultiGameApps() {

    if (!Array.isArray(games)) {
        return [];
    }

    const projects = new Map();

    for (const game of games) {

        if (!game || !Array.isArray(game.ports)) {
            continue;
        }

        for (const port of game.ports) {

            if (!port) {
                continue;
            }

            const projectName = String(
                port.project ?? ""
            ).trim();

            const normalizedProject =
                normalizeText(projectName);

            const isMarkedAsApp = [
                "multi-game apps",
                "multi game apps"
            ].includes(normalizeText(port.platform));

            /*
             * Ignore generic project types.
             */

            if (
                normalizedProject === "unofficial port" ||
                normalizedProject === "android port"
            ) {
                continue;
            }

            /*
             * Explicit app entries use GAME as the app name.
             * Normal entries use PROJECT as the app name.
             */

            const appName = isMarkedAsApp
                ? String(game.name ?? "").trim()
                : projectName;

            if (!appName) {
                continue;
            }

            const key = normalizeText(appName);

            if (!projects.has(key)) {

                projects.set(key, {
                    name: appName,
                    games: new Map(),
                    latestUpdate: null,
                    visits: 0,
                    explicitlyMarked: false
                });

            }

            const app = projects.get(key);

            if (isMarkedAsApp) {

                app.explicitlyMarked = true;

            } else if (projectName && game.name) {

                const gameKey = normalizeText(game.name);

                if (!app.games.has(gameKey)) {

                    app.games.set(gameKey, {
                        name: game.name,
                        year: game.year || ""
                    });

                }

            }

            /*
             * Keep the latest update associated with the app.
             */

            if (port.lastUpdate) {

                const updateDate = parseLastUpdate(
                    port.lastUpdate
                );

                if (
                    updateDate &&
                    (
                        !app.latestUpdate ||
                        updateDate > app.latestUpdate
                    )
                ) {

                    app.latestUpdate = updateDate;

                }

            }

        }

    }

    /*
     * Keep actual multi-game apps and explicitly
     * marked apps, even if they have one game.
     */

    const result = [];

    for (const app of projects.values()) {

        if (
            app.games.size <= 1 &&
            !app.explicitlyMarked
        ) {
            continue;
        }

        app.games = Array.from(
            app.games.values()
        ).sort((a, b) =>
            a.name.localeCompare(
                b.name,
                "en",
                { sensitivity: "base" }
            )
        );

        app.slug = createSlug(app.name);
        app.gameCount = app.games.length;

        /*
         * Sum the popularity of compatible games.
         */

        let totalVisits = 0;

        for (const compatibleGame of app.games) {

            const visits = allTimePopular.get(
                createSlug(compatibleGame.name)
            ) || 0;

            totalVisits += Number(visits) || 0;

        }

        app.visits = totalVisits;

        /*
         * Internal detection flag is no longer needed.
         */

        delete app.explicitlyMarked;

        result.push(app);

    }

    return result;

}


/*
 * SORT MULTI-GAME APPS
 */

function sortMultiGameApps(list) {

    const sorted = Array.isArray(list)
        ? [...list]
        : [];

    switch (selectedCategorySort) {

        case "updated":

            sorted.sort((a, b) => {

                if (!a.latestUpdate && !b.latestUpdate) {
                    return 0;
                }

                if (!a.latestUpdate) {
                    return 1;
                }

                if (!b.latestUpdate) {
                    return -1;
                }

                const result =
                    b.latestUpdate - a.latestUpdate;

                return categorySortDescending
                    ? -result
                    : result;

            });

            break;

        case "name":

            sorted.sort((a, b) => {

                const result = a.name.localeCompare(
                    b.name,
                    "en",
                    { sensitivity: "base" }
                );

                return categorySortDescending
                    ? -result
                    : result;

            });

            break;

        case "popular":

            sorted.sort((a, b) => {

                const result =
                    (Number(b.visits) || 0) -
                    (Number(a.visits) || 0);

                if (result !== 0) {

                    return categorySortDescending
                        ? -result
                        : result;

                }

                return a.name.localeCompare(
                    b.name,
                    "en",
                    { sensitivity: "base" }
                );

            });

            break;

    }

    return sorted;

}


/*
 * DISPLAY A MULTI-GAME APP'S COMPATIBLE GAMES
 */

function displayMultiGameApp(app, parentElement) {

    const section = document.createElement("section");
    section.className = "games-using-app";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "games-using-app-toggle";
    toggle.setAttribute("aria-expanded", "false");

    const title = document.createElement("span");
    title.textContent = "You can also play:";

    const arrow = document.createElement("span");
    arrow.className = "games-using-app-arrow";
    arrow.textContent = "▼";
    arrow.setAttribute("aria-hidden", "true");

    toggle.append(title, arrow);

    const list = document.createElement("div");
    list.className = "games-using-app-list";
    list.hidden = true;

    for (const game of app.games) {

        const link = document.createElement("a");

        link.className = "games-using-app-item";

        link.href =
            `game.html?game=${encodeURIComponent(
                createSlug(game.name)
            )}`;

        link.textContent = game.name;

        if (game.year) {

            const year = document.createElement("span");
            year.textContent = ` (${game.year})`;

            link.appendChild(year);

        }

        list.appendChild(link);

    }

    toggle.addEventListener("click", () => {

        const isOpen =
            toggle.getAttribute("aria-expanded") === "true";

        toggle.setAttribute(
            "aria-expanded",
            String(!isOpen)
        );

        list.hidden = isOpen;
        arrow.textContent = isOpen ? "▼" : "▲";

    });

    section.append(toggle, list);
    parentElement.appendChild(section);

}


/*
 * DISPLAY THE MULTI-GAME APPS CATEGORY
 */

function displayMultiGameApps(list) {

    if (!gameList || !statusElement) {

        console.error(
            "The Ports Vault: Multi-game Apps elements are missing."
        );

        return;

    }

    gameList.hidden = false;
    gameList.replaceChildren();

    const apps = Array.isArray(list) ? list : [];

    if (apps.length === 0) {

        const message = document.createElement("div");

        message.className = "no-results";
        message.textContent = "No Multi-game Apps found.";

        gameList.appendChild(message);
        statusElement.textContent = "0 Multi-game Apps";

        return;

    }

    statusElement.textContent =
        `${apps.length} Multi-game App${apps.length !== 1 ? "s" : ""}`;

    const fragment = document.createDocumentFragment();

    for (const app of apps) {

        const element = document.createElement("div");
        element.className = "game";

        const name = document.createElement("h2");
        name.className = "game-name";
        name.textContent = app.name;

        const info = document.createElement("div");
        info.className = "game-info";

        const count = document.createElement("span");

        count.textContent =
            `${app.gameCount} game${app.gameCount !== 1 ? "s" : ""}`;

        info.appendChild(count);
        element.append(name, info);

        displayMultiGameApp(app, element);

        fragment.appendChild(element);

    }

    gameList.appendChild(fragment);

}
