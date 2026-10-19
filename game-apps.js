
/*
 * NAPL — MULTI-GAME APPS
 *
 * Detects multi-game apps and finds the games
 * compatible with each app.
 */


/*
 * NORMALIZE TEXT
 *
 * Makes comparisons case-insensitive and ignores
 * accents and surrounding whitespace.
 */

function normalizeText(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/*
 * CHECK WHETHER AN ENTRY IS A MULTI-GAME APP
 */

export function isMultiGameApp(game) {
    if (!game || !Array.isArray(game.ports)) {
        return false;
    }

    return game.ports.some(port => {
        return (
            normalizeText(port?.platform) ===
            "multi-game apps"
        );
    });
}


/*
 * CHECK WHETHER A PORT IS A MULTI-GAME APP
 *
 * A port is recognized as a multi-game app when
 * its project name matches an entry in the
 * Multi-game Apps platform.
 */

export function isMultiGameAppPort(port, allRows) {
    if (
        !port ||
        !port.project ||
        !Array.isArray(allRows)
    ) {
        return false;
    }

    const projectName = normalizeText(port.project);

    return allRows.some(row => {
        if (!row) {
            return false;
        }

        return (
            normalizeText(row.platform) ===
                "multi-game apps" &&
            normalizeText(row.game) === projectName
        );
    });
}


/*
 * FIND GAMES THAT USE A MULTI-GAME APP
 *
 * A game is associated with an app when its
 * PROJECT column matches the app name.
 *
 * Duplicate games are removed, and results are
 * sorted alphabetically.
 */

export function findGamesUsingApp(appName, allRows) {
    const appNameNormalized = normalizeText(appName);

    if (
        !appNameNormalized ||
        !Array.isArray(allRows)
    ) {
        return [];
    }

    const gamesUsingApp = new Map();

    for (const row of allRows) {
        if (
            !row ||
            !row.game ||
            !row.project
        ) {
            continue;
        }

        const gameName = String(row.game).trim();
        const projectName = normalizeText(row.project);
        const normalizedGameName = normalizeText(gameName);

        /*
         * Do not include the app itself.
         */

        if (normalizedGameName === appNameNormalized) {
            continue;
        }

        /*
         * The PROJECT column must match the app name.
         */

        if (projectName !== appNameNormalized) {
            continue;
        }

        /*
         * Avoid duplicate games, ignoring case and accents.
         */

        if (!gamesUsingApp.has(normalizedGameName)) {
            const year = String(row.year ?? "").trim();

            gamesUsingApp.set(normalizedGameName, {
                name: gameName,
                year: year
            });
        }
    }

    /*
     * Return games in alphabetical order.
     */

    return Array.from(gamesUsingApp.values()).sort(
        (a, b) =>
            a.name.localeCompare(
                b.name,
                "en",
                { sensitivity: "base" }
            )
    );
}
