/*
 * MULTI-GAME APPS
 *
 * Handles the detection of Multi-game Apps
 * and the games compatible with each app.
 */


/*
 * Normalize text for comparisons.
 */

function normalizeText(value) {

    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/*
 * Check whether the selected entry is
 * a Multi-game App.
 */

export function isMultiGameApp(game) {

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

export function isMultiGameAppPort(
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

export function findGamesUsingApp(
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

        /*
         * Avoid duplicate games.
         */

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

    /*
     * Return games in alphabetical order.
     */

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
