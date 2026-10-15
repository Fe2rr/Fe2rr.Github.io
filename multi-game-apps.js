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
 * Build Multi-game Apps.
 *
 * Reuses the same relationship used by
 * "You can also play":
 *
 * GAME -> PROJECT
 *
 * A project becomes a Multi-game App when:
 *
 * 1. It is associated with more than one game.
 *
 * OR
 *
 * 2. It already has PLATFORM = Multi-game Apps.
 */

function getMultiGameApps() {

    const projects = new Map();


    for (const game of games) {

        for (const port of game.ports) {

            const projectName =
                port.project.trim();

            /*
             * Ignore generic project types.
             * These are not Multi-game Apps.
             */

            const normalizedProject =
                normalizeText(projectName);


            if (
                normalizedProject ===
                    "unofficial port" ||
                normalizedProject ===
                    "android port"
            ) {

                continue;
            }


            const isMarkedAsApp =
                normalizeText(
                    port.platform
                ) === "multi-game apps" ||
                normalizeText(
                    port.platform
                ) === "multi game apps";


            /*
             * A row explicitly marked as
             * Multi-game Apps uses GAME as
             * the app name.
             *
             * This allows existing Multi-game
             * Apps to appear even when they
             * do not have multiple PROJECT
             * references.
             */

            const appName =
                isMarkedAsApp
                    ? game.name
                    : projectName;


            if (!appName) {

                continue;
            }


            const key =
                normalizeText(appName);


            if (!projects.has(key)) {

                projects.set(
                    key,
                    {
                        name: appName,
                        games: new Map(),
                        latestUpdate: null,
                        visits: 0
                    }
                );
            }


            const app =
                projects.get(key);


            /*
             * A normal port belongs to the
             * project when PROJECT matches.
             */

            if (
                projectName &&
                !isMarkedAsApp
            ) {

                const gameKey =
                    normalizeText(game.name);


                if (
                    !app.games.has(gameKey)
                ) {

                    app.games.set(
                        gameKey,
                        {
                            name: game.name,
                            year: game.year
                        }
                    );
                }
            }


            /*
             * Keep the most recent update
             * associated with the app.
             */

            const updateDate =
                parseLastUpdate(
                    port.lastUpdate
                );


            if (
                updateDate &&
                (
                    !app.latestUpdate ||
                    updateDate > app.latestUpdate
                )
            ) {

                app.latestUpdate =
                    updateDate;
            }
        }
    }


    /*
     * Remove projects that are not actually
     * Multi-game Apps.
     *
     * Explicitly marked apps are kept even
     * when they have only one associated game.
     */

    const result = [];


    for (const app of projects.values()) {

        let explicitlyMarked = false;


        for (const game of games) {

            for (const port of game.ports) {

                const projectName =
                    port.project.trim();


                const normalizedProject =
                    normalizeText(projectName);


                if (
                    normalizedProject ===
                        "unofficial port" ||
                    normalizedProject ===
                        "android port"
                ) {

                    continue;
                }


                if (
                    normalizeText(port.platform) ===
                        "multi-game apps" &&
                    normalizeText(game.name) ===
                        normalizeText(app.name)
                ) {

                    explicitlyMarked = true;

                    break;
                }


                if (
                    normalizeText(port.platform) ===
                        "multi game apps" &&
                    normalizeText(game.name) ===
                        normalizeText(app.name)
                ) {

                    explicitlyMarked = true;

                    break;
                }
            }


            if (explicitlyMarked) {

                break;
            }
        }


        if (
            app.games.size > 1 ||
            explicitlyMarked
        ) {

            app.games =
                Array.from(
                    app.games.values()
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


            app.slug =
                createSlug(app.name);


            app.gameCount =
                app.games.length;


            /*
             * Use the popularity of the
             * associated games.
             */

            let totalVisits = 0;


            for (
                const compatibleGame
                of app.games
            ) {

                totalVisits +=
                    allTimePopular.get(
                        createSlug(
                            compatibleGame.name
                        )
                    ) || 0;
            }


            app.visits =
                totalVisits;


            result.push(app);
        }
    }


    return result;

}

/*
 * Sort Multi-game Apps.
 */

function sortMultiGameApps(list) {

    const sorted =
        [...list];


    switch (selectedCategorySort) {

        case "updated":

            sorted.sort(
                (a, b) => {

                    if (
                        !a.latestUpdate &&
                        !b.latestUpdate
                    ) {

                        return 0;
                    }

                    if (!a.latestUpdate) {

                        return 1;
                    }

                    if (!b.latestUpdate) {

                        return -1;
                    }


                    const result =
                        b.latestUpdate -
                        a.latestUpdate;


                    return categorySortDescending
                        ? -result
                        : result;
                }
            );

            break;


        case "name":

            sorted.sort(
                (a, b) => {

                    const result =
                        a.name.localeCompare(
                            b.name,
                            "en",
                            {
                                sensitivity: "base"
                            }
                        );


                    return categorySortDescending
                        ? -result
                        : result;
                }
            );

            break;


        case "popular":

            sorted.sort(
                (a, b) => {

                    const result =
                        b.visits -
                        a.visits;


                    if (result !== 0) {

                        return categorySortDescending
                            ? -result
                            : result;
                    }


                    return a.name.localeCompare(
                        b.name,
                        "en",
                        {
                            sensitivity: "base"
                        }
                    );
                }
            );

            break;
    }


    return sorted;

}

/*
 * Display a Multi-game App.
 *
 * Uses the same visual structure as
 * "You can also play".
 */

function displayMultiGameApp(
    app,
    parentElement
) {

    const section =
        document.createElement("section");


    section.className =
        "games-using-app";


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
        "You can also play:";


    const arrow =
        document.createElement("span");


    arrow.className =
        "games-using-app-arrow";


    arrow.textContent =
        "▼";


    toggle.appendChild(title);
    toggle.appendChild(arrow);


    const list =
        document.createElement("div");


    list.className =
        "games-using-app-list";


    list.hidden = true;


    for (
        const game
        of app.games
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
 * Display Multi-game Apps list.
 */

function displayMultiGameApps(list) {

    gameList.hidden = false;

    gameList.innerHTML = "";


    if (list.length === 0) {

        gameList.innerHTML = `
            <div class="no-results">
                No Multi-game Apps found.
            </div>
        `;


        statusElement.textContent =
            "0 Multi-game Apps";


        return;
    }


    statusElement.textContent =
        `${list.length} Multi-game App${list.length !== 1 ? "s" : ""}`;


    const fragment =
        document.createDocumentFragment();


    for (const app of list) {

        const element =
            document.createElement("div");


        element.className =
            "game";


        const name =
            document.createElement("h2");


        name.className =
            "game-name";


        name.textContent =
            app.name;


        const info =
            document.createElement("div");


        info.className =
            "game-info";


        const count =
            document.createElement("span");


        count.textContent =
            `${app.gameCount} game${app.gameCount !== 1 ? "s" : ""}`;


        info.appendChild(count);


        element.appendChild(name);

        element.appendChild(info);


        displayMultiGameApp(
            app,
            element
        );


        fragment.appendChild(element);
    }


    gameList.appendChild(
        fragment
    );

}
