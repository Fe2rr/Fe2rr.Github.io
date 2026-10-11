/*
 * Convert LAST UPDATE into a Date.
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

    const year = Number(match[1]);

    const monthName =
        match[2].toLowerCase();

    const day =
        match[3]
            ? Number(match[3])
            : 1;

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

    return new Date(
        year,
        months[monthName],
        day
    );
}

/*
 * Convert DATE ADDED into a Date.
 *
 * Supports formats such as:
 * 2026, October 10
 * 2026, October
 * 2026-10-10
 * 10/10/2026
 */

function parseDateAdded(value) {

    if (!value) {
        return null;
    }

    const text =
        String(value).trim();

    if (!text) {
        return null;
    }

    /*
     * Format: YYYY, Month DD
     * Also accepts: YYYY, Month
     */

    const monthMatch =
        text.match(
            /^(\d{4})\s*,\s*([A-Za-z]+)(?:\s+(\d{1,2}))?$/
        );

    if (monthMatch) {

        const year =
            Number(monthMatch[1]);

        const monthName =
            monthMatch[2].toLowerCase();

        const day =
            monthMatch[3]
                ? Number(monthMatch[3])
                : 1;

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

        const date =
            new Date(year, month, day);

        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month ||
            date.getDate() !== day
        ) {
            return null;
        }

        return date;
    }

    /*
     * Format: YYYY-MM-DD
     */

    const isoMatch =
        text.match(
            /^(\d{4})-(\d{1,2})-(\d{1,2})$/
        );

    if (isoMatch) {

        const year =
            Number(isoMatch[1]);

        const month =
            Number(isoMatch[2]) - 1;

        const day =
            Number(isoMatch[3]);

        const date =
            new Date(year, month, day);

        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month ||
            date.getDate() !== day
        ) {
            return null;
        }

        return date;
    }

    /*
     * Format: DD/MM/YYYY
     */

    const localMatch =
        text.match(
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
        );

    if (localMatch) {

        const day =
            Number(localMatch[1]);

        const month =
            Number(localMatch[2]) - 1;

        const year =
            Number(localMatch[3]);

        const date =
            new Date(year, month, day);

        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month ||
            date.getDate() !== day
        ) {
            return null;
        }

        return date;
    }

    return null;
}

/*
 * Get the latest update of a game.
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
 * Get the DATE ADDED of a game.
 *
 * If a game has multiple rows, use
 * its most recent DATE ADDED value.
 */

function getDateAdded(game) {

    const dates =
        game.ports
            .map(
                port =>
                    parseDateAdded(
                        port.dateAdded
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
 * Display Last Added.
 */

function displayLastAdded() {

    if (
        !lastAddedList ||
        !lastAddedMore
    ) {
        return;
    }

    const sortedGames =
        games
            .map(game => ({
                game: game,
                dateAdded: getDateAdded(game)
            }))
            .filter(
                item =>
                    item.dateAdded !== null
            )
            .sort(
                (a, b) =>
                    b.dateAdded - a.dateAdded
            );

    lastAddedList.innerHTML = "";

    if (sortedGames.length === 0) {

        lastAddedMore.hidden = true;

        return;
    }

    const visibleGames =
        showingAllLastAdded
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

        fragment.appendChild(element);
    }

    lastAddedList.appendChild(fragment);

    lastAddedMore.hidden =
        !(
            sortedGames.length > 10 &&
            !showingAllLastAdded
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
                lastUpdate: getLatestUpdate(game)
            }))
            .filter(
                item =>
                    item.lastUpdate !== null
            )
            .sort(
                (a, b) =>
                    b.lastUpdate - a.lastUpdate
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

        fragment.appendChild(element);
    }

    lastUpdatedList.appendChild(fragment);

    lastUpdatedMore.hidden =
        !(
            sortedGames.length > 10 &&
            !showingAllLastUpdated
        );
}

/*
 * Load Popular ranking.
 */

function loadPopular(
    period = selectedPopularPeriod
) {

    if (!popularList) {
        return;
    }

    popularList.innerHTML = `
        <div class="home-loading">
            Loading...
        </div>
    `;

    const callbackName =
        `popularCallback_${Date.now()}`;

    window[callbackName] =
        function(data) {

            try {

                if (
                    !data.success ||
                    !Array.isArray(data.games)
                ) {
                    throw new Error(
                        data.error ||
                        "Could not load popular games."
                    );
                }

                const gameMap =
                    new Map(
                        games.map(game => [
                            game.slug,
                            game
                        ])
                    );

                const ranking =
                    data.games
                        .map(item => {

                            const game =
                                gameMap.get(
                                    createSlug(item.game)
                                );

                            if (!game) {
                                return null;
                            }

                            return {
                                game: game,
                                visits:
                                    Number(item.visits) || 0
                            };

                        })
                        .filter(
                            item =>
                                item !== null
                        );

                displayPopular(ranking);

            } catch (error) {

                console.error(
                    "Could not load popular games:",
                    error
                );

                popularList.innerHTML = `
                    <div class="error">
                        Could not load popular games.
                    </div>
                `;

                popularMore.hidden = true;

            } finally {

                delete window[callbackName];

                const script =
                    document.getElementById(
                        callbackName
                    );

                if (script) {
                    script.remove();
                }
            }
        };

    const script =
        document.createElement("script");

    script.id =
        callbackName;

    script.src =
        `${POPULAR_URL}?popular=${encodeURIComponent(
            period
        )}&callback=${callbackName}`;

    script.onerror =
        function() {

            console.error(
                "Could not load popular games."
            );

            popularList.innerHTML = `
                <div class="error">
                    Could not load popular games.
                </div>
            `;

            popularMore.hidden = true;

            delete window[callbackName];

            script.remove();
        };

    document.body.appendChild(script);
}

/*
 * Load All Time Popular for category sorting.
 */

function loadAllTimePopular(callback) {

    if (allTimePopularLoaded) {

        callback();

        return;
    }

    allTimePopularCallbacks.push(callback);

    if (allTimePopularLoading) {
        return;
    }

    allTimePopularLoading = true;

    const callbackName =
        `allTimePopularCallback_${Date.now()}`;

    window[callbackName] =
        function(data) {

            try {

                if (
                    !data.success ||
                    !Array.isArray(data.games)
                ) {
                    throw new Error(
                        data.error ||
                        "Could not load All Time popularity."
                    );
                }

                allTimePopular =
                    new Map(
                        data.games.map(item => [
                            createSlug(item.game),
                            Number(item.visits) || 0
                        ])
                    );

                allTimePopularLoaded = true;

            } catch (error) {

                console.error(
                    "Could not load All Time popularity:",
                    error
                );

            } finally {

                allTimePopularLoading = false;

                delete window[callbackName];

                const script =
                    document.getElementById(
                        callbackName
                    );

                if (script) {
                    script.remove();
                }

                const callbacks =
                    allTimePopularCallbacks;

                allTimePopularCallbacks = [];

                callbacks.forEach(
                    callback => callback()
                );
            }
        };

    const script =
        document.createElement("script");

    script.id =
        callbackName;

    script.src =
        `${POPULAR_URL}?popular=alltime&callback=${callbackName}`;

    script.onerror =
        function() {

            console.error(
                "Could not load All Time popularity."
            );

            allTimePopularLoading = false;

            delete window[callbackName];

            script.remove();

            const callbacks =
                allTimePopularCallbacks;

            allTimePopularCallbacks = [];

            callbacks.forEach(
                callback => callback()
            );
        };

    document.body.appendChild(script);
}

/*
 * Display Popular.
 */

function displayPopular(ranking) {

    popularList.innerHTML = "";

    if (ranking.length === 0) {

        popularList.innerHTML = `
            <div class="no-results">
                No popular games found.
            </div>
        `;

        popularMore.hidden = true;

        return;
    }

    const visibleGames =
        showingAllPopular
            ? ranking
            : ranking.slice(0, 10);

    const fragment =
        document.createDocumentFragment();

    for (
        let i = 0;
        i < visibleGames.length;
        i++
    ) {

        const item =
            visibleGames[i];

        const element =
            document.createElement("a");

        element.className =
            "home-game";

        element.href =
            `game.html?game=${encodeURIComponent(
                item.game.slug
            )}`;

        element.textContent =
            `${i + 1}. ${item.game.name}`;

        fragment.appendChild(element);
    }

    popularList.appendChild(fragment);

    popularMore.hidden =
        !(
            ranking.length > 10 &&
            !showingAllPopular
        );
}

/*
 * Popular tabs.
 */

popularTabs.forEach(
    tab => {

        tab.addEventListener(
            "click",
            () => {

                popularTabs.forEach(
                    otherTab => {
                        otherTab.classList.remove(
                            "active"
                        );
                    }
                );

                tab.classList.add("active");

                selectedPopularPeriod =
                    tab.dataset.period;

                showingAllPopular = false;

                loadPopular(
                    selectedPopularPeriod
                );
            }
        );
    }
);

/*
 * Last Added View More.
 */

if (lastAddedMore) {

    lastAddedMore.addEventListener(
        "click",
        () => {

            showingAllLastAdded = true;

            displayLastAdded();
        }
    );
}

/*
 * Popular View More.
 */

popularMore.addEventListener(
    "click",
    () => {

        showingAllPopular = true;

        loadPopular(
            selectedPopularPeriod
        );
    }
);

/*
 * Last Updated View More.
 */

lastUpdatedMore.addEventListener(
    "click",
    () => {

        showingAllLastUpdated = true;

        displayLastUpdated();
    }
);
