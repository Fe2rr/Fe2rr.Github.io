/*
 * THE PORTS VAULT — HOME PAGE
 *
 * Displays Last Added, Popular and Last Updated.
 * Preserves popularity ranking and date-based sorting.
 */


/*
 * CONVERT LAST UPDATE INTO A DATE
 */

function parseLastUpdate(value) {

    if (!value) {
        return null;
    }

    const match = String(value)
        .trim()
        .match(/^(\d{4})\s*,\s*([A-Za-z]+)(?:\s+(\d{1,2}))?$/);

    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const monthName = match[2].toLowerCase();
    const day = match[3] ? Number(match[3]) : 1;

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

    if (!Object.prototype.hasOwnProperty.call(months, monthName)) {
        return null;
    }

    const month = months[monthName];
    const date = new Date(year, month, day);

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
 * CONVERT DATE ADDED INTO A DATE
 *
 * Supports:
 * 2026, October 10
 * 2026, octubre 11
 * 2026, October
 * 2026-10-10
 * 10/10/2026
 */

function parseDateAdded(value) {

    if (!value) {
        return null;
    }

    const text = String(value).trim();

    if (!text) {
        return null;
    }

    const monthMatch = text.match(
        /^(\d{4})\s*,\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)(?:\s+(\d{1,2}))?$/i
    );

    if (monthMatch) {

        const year = Number(monthMatch[1]);

        const monthName = monthMatch[2]
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");

        const day = monthMatch[3]
            ? Number(monthMatch[3])
            : 1;

        const months = {
            january: 0,
            enero: 0,
            february: 1,
            febrero: 1,
            march: 2,
            marzo: 2,
            april: 3,
            abril: 3,
            may: 4,
            mayo: 4,
            june: 5,
            junio: 5,
            july: 6,
            julio: 6,
            august: 7,
            agosto: 7,
            september: 8,
            septiembre: 8,
            setiembre: 8,
            october: 9,
            octubre: 9,
            november: 10,
            noviembre: 10,
            december: 11,
            diciembre: 11
        };

        if (!Object.prototype.hasOwnProperty.call(months, monthName)) {
            return null;
        }

        const month = months[monthName];
        const date = new Date(year, month, day);

        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month ||
            date.getDate() !== day
        ) {
            return null;
        }

        return date;
    }

    const isoMatch = text.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    );

    if (isoMatch) {

        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]) - 1;
        const day = Number(isoMatch[3]);

        const date = new Date(year, month, day);

        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month ||
            date.getDate() !== day
        ) {
            return null;
        }

        return date;
    }

    const localMatch = text.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

    if (localMatch) {

        const day = Number(localMatch[1]);
        const month = Number(localMatch[2]) - 1;
        const year = Number(localMatch[3]);

        const date = new Date(year, month, day);

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
 * GET THE LATEST UPDATE OF A GAME
 */

function getLatestUpdate(game) {

    const dates = game.ports
        .map(port => parseLastUpdate(port.lastUpdate))
        .filter(date => date !== null);

    if (dates.length === 0) {
        return null;
    }

    return dates.reduce(
        (latest, current) => current > latest ? current : latest
    );
}


/*
 * GET THE DATE ADDED OF A GAME
 */

function getDateAdded(game) {

    const dates = game.ports
        .map(port => parseDateAdded(port.dateAdded))
        .filter(date => date !== null);

    if (dates.length === 0) {
        return null;
    }

    return dates.reduce(
        (latest, current) => current > latest ? current : latest
    );
}


/*
 * FIND THE PORT RESPONSIBLE FOR A DATE
 *
 * Last Added uses DATE ADDED.
 * Last Updated uses LAST UPDATE.
 *
 * This ensures the displayed port corresponds
 * to the date used to position the game.
 */

function getPortForDate(game, field, parser) {

    if (!game || !Array.isArray(game.ports)) {
        return null;
    }

    let selectedPort = null;
    let selectedDate = null;

    for (const port of game.ports) {

        if (!port) {
            continue;
        }

        const date = parser(port[field]);

        if (!date) {
            continue;
        }

        if (!selectedDate || date > selectedDate) {
            selectedDate = date;
            selectedPort = port;
        }

    }

    return selectedPort;
}


/*
 * GET A REPRESENTATIVE PORT
 *
 * Used for Popular, where the ranking is based
 * on visits rather than port dates.
 */

function getRepresentativePort(game) {

    if (!game || !Array.isArray(game.ports)) {
        return null;
    }

    return game.ports.find(port =>
        port &&
        String(port.project || "").trim()
    ) || game.ports.find(port =>
        port &&
        (
            String(port.platform || "").trim() ||
            String(port.developer || "").trim()
        )
    ) || null;
}


/*
 * GET THE PORT NAME
 */

function getPortDisplayName(port) {

    if (!port) {
        return "Android port";
    }

    const project = String(port.project || "").trim();

    if (project) {
        return project;
    }

    const platform = String(port.platform || "").trim();

    if (platform) {
        return platform;
    }

    const developer = String(port.developer || "").trim();

    if (developer) {
        return developer;
    }

    return "Android port";
}


/*
 * GET PLATFORM LABEL
 */

function getGamePlatformLabel(game, port) {

    let platforms = [];

    if (Array.isArray(game?.platforms)) {
        platforms = game.platforms;
    }

    if (
        platforms.length === 0 &&
        port?.platform
    ) {
        platforms = [port.platform];
    }

    platforms = [
        ...new Set(
            platforms
                .map(platform => String(platform || "").trim())
                .filter(Boolean)
        )
    ];

    if (platforms.length === 0) {
        return "";
    }

    if (platforms.length <= 2) {
        return platforms.join(" · ");
    }

    return `${platforms[0]} · ${platforms[1]} +${platforms.length - 2}`;
}


/*
 * CREATE A HOME GAME CARD
 *
 * Shared by Last Added, Popular and Last Updated.
 */

function createHomeGameCard(game, port, options = {}) {

    const element = document.createElement("a");

    element.className = "home-game";
    element.href =
        `game.html?game=${encodeURIComponent(game.slug)}`;

    const coverContainer = document.createElement("div");
    coverContainer.className = "home-game-cover-container";

    const coverUrl = String(game.coverUrl || "").trim();

    if (coverUrl) {

        const cover = document.createElement("img");

        cover.className = "home-game-cover";
        cover.src = coverUrl;
        cover.alt = `${game.name} cover`;
        cover.loading = "lazy";
        cover.decoding = "async";

        cover.addEventListener("error", () => {
            cover.remove();
            coverContainer.classList.add("cover-unavailable");
        }, { once: true });

        coverContainer.appendChild(cover);

    } else {

        coverContainer.classList.add("cover-unavailable");

    }

    const content = document.createElement("div");
    content.className = "home-game-content";

    /*
     * Optional ranking number for Popular.
     */

    if (Number.isFinite(options.rank)) {

        const rank = document.createElement("span");

        rank.className = "home-game-rank";
        rank.textContent = `#${options.rank}`;

        content.appendChild(rank);

    }

    /*
     * Game name.
     */

    const name = document.createElement("span");

    name.className = "home-game-name";
    name.textContent = game.name;

    /*
     * Platform and year.
     */

    const metadata = document.createElement("span");

    metadata.className = "home-game-metadata";

    const platformLabel = getGamePlatformLabel(game, port);
    const year = String(game.year || port?.year || "").trim();

    const metadataParts = [];

    if (platformLabel) {
        metadataParts.push(platformLabel);
    }

    if (year) {
        metadataParts.push(year);
    }

    metadata.textContent = metadataParts.join(" · ");

    /*
     * Port name.
     */

    const portName = document.createElement("span");

    portName.className = "home-game-port";
    portName.textContent = getPortDisplayName(port);

    content.append(name);

    if (metadataParts.length > 0) {
        content.appendChild(metadata);
    }

    content.appendChild(portName);

    element.append(coverContainer, content);

    return element;
}


/*
 * DISPLAY LAST ADDED
 */

function displayLastAdded() {

    if (!lastAddedList || !lastAddedMore) {
        return;
    }

    const sortedGames = games
        .map(game => ({
            game,
            dateAdded: getDateAdded(game),
            port: getPortForDate(
                game,
                "dateAdded",
                parseDateAdded
            )
        }))
        .filter(item => item.dateAdded !== null)
        .sort((a, b) => b.dateAdded - a.dateAdded);

    lastAddedList.replaceChildren();

    if (sortedGames.length === 0) {
        lastAddedMore.hidden = true;
        return;
    }

    const visibleGames = showingAllLastAdded
        ? sortedGames
        : sortedGames.slice(0, 10);

    const fragment = document.createDocumentFragment();

    for (const item of visibleGames) {

        const element = createHomeGameCard(
            item.game,
            item.port
        );

        fragment.appendChild(element);

    }

    lastAddedList.appendChild(fragment);

    lastAddedMore.hidden = !(
        sortedGames.length > 10 &&
        !showingAllLastAdded
    );
}


/*
 * DISPLAY LAST UPDATED
 */

function displayLastUpdated() {

    if (!lastUpdatedList || !lastUpdatedMore) {
        return;
    }

    const sortedGames = games
        .map(game => ({
            game,
            lastUpdate: getLatestUpdate(game),
            port: getPortForDate(
                game,
                "lastUpdate",
                parseLastUpdate
            )
        }))
        .filter(item => item.lastUpdate !== null)
        .sort((a, b) => b.lastUpdate - a.lastUpdate);

    lastUpdatedList.replaceChildren();

    if (sortedGames.length === 0) {
        lastUpdatedMore.hidden = true;
        return;
    }

    const visibleGames = showingAllLastUpdated
        ? sortedGames
        : sortedGames.slice(0, 10);

    const fragment = document.createDocumentFragment();

    for (const item of visibleGames) {

        const element = createHomeGameCard(
            item.game,
            item.port
        );

        fragment.appendChild(element);

    }

    lastUpdatedList.appendChild(fragment);

    lastUpdatedMore.hidden = !(
        sortedGames.length > 10 &&
        !showingAllLastUpdated
    );
}


/*
 * LOAD POPULAR RANKING
 */

function loadPopular(period = selectedPopularPeriod) {

    if (!popularList) {
        return;
    }

    popularList.innerHTML = `
        <div class="home-loading">
            Loading...
        </div>
    `;

    const callbackName = `popularCallback_${Date.now()}`;

    window[callbackName] = function(data) {

        try {

            if (!data.success || !Array.isArray(data.games)) {
                throw new Error(
                    data.error || "Could not load popular games."
                );
            }

            const gameMap = new Map(
                games.map(game => [game.slug, game])
            );

            const ranking = data.games
                .map(item => {

                    const game = gameMap.get(
                        createSlug(item.game)
                    );

                    if (!game) {
                        return null;
                    }

                    return {
                        game,
                        visits: Number(item.visits) || 0,
                        port: getRepresentativePort(game)
                    };

                })
                .filter(item => item !== null);

            displayPopular(ranking);

        } catch (error) {

            console.error("Could not load popular games:", error);

            popularList.innerHTML = `
                <div class="error">
                    Could not load popular games.
                </div>
            `;

            if (popularMore) {
                popularMore.hidden = true;
            }

        } finally {

            delete window[callbackName];

            const script = document.getElementById(callbackName);

            if (script) {
                script.remove();
            }

        }

    };

    const script = document.createElement("script");

    script.id = callbackName;
    script.src =
        `${POPULAR_URL}?popular=${encodeURIComponent(period)}&callback=${callbackName}`;

    script.onerror = function() {

        console.error("Could not load popular games.");

        popularList.innerHTML = `
            <div class="error">
                Could not load popular games.
            </div>
        `;

        if (popularMore) {
            popularMore.hidden = true;
        }

        delete window[callbackName];
        script.remove();

    };

    document.body.appendChild(script);
}


/*
 * LOAD ALL-TIME POPULARITY FOR CATEGORY SORTING
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

    const callbackName = `allTimePopularCallback_${Date.now()}`;

    window[callbackName] = function(data) {

        try {

            if (!data.success || !Array.isArray(data.games)) {
                throw new Error(
                    data.error || "Could not load All Time popularity."
                );
            }

            allTimePopular = new Map(
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

            const script = document.getElementById(callbackName);

            if (script) {
                script.remove();
            }

            const callbacks = allTimePopularCallbacks;
            allTimePopularCallbacks = [];

            callbacks.forEach(callback => callback());

        }

    };

    const script = document.createElement("script");

    script.id = callbackName;
    script.src =
        `${POPULAR_URL}?popular=alltime&callback=${callbackName}`;

    script.onerror = function() {

        console.error("Could not load All Time popularity.");

        allTimePopularLoading = false;

        delete window[callbackName];
        script.remove();

        const callbacks = allTimePopularCallbacks;
        allTimePopularCallbacks = [];

        callbacks.forEach(callback => callback());

    };

    document.body.appendChild(script);
}


/*
 * DISPLAY POPULAR
 *
 * The order returned by the popularity source is preserved.
 */

function displayPopular(ranking) {

    if (!popularList || !popularMore) {
        return;
    }

    popularList.replaceChildren();

    if (ranking.length === 0) {

        popularList.innerHTML = `
            <div class="no-results">
                No popular games found.
            </div>
        `;

        popularMore.hidden = true;

        return;
    }

    const visibleGames = showingAllPopular
        ? ranking
        : ranking.slice(0, 10);

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < visibleGames.length; i++) {

        const item = visibleGames[i];

        const element = createHomeGameCard(
            item.game,
            item.port,
            { rank: i + 1 }
        );

        fragment.appendChild(element);

    }

    popularList.appendChild(fragment);

    popularMore.hidden = !(
        ranking.length > 10 &&
        !showingAllPopular
    );
}


/*
 * POPULAR TABS
 */

popularTabs.forEach(tab => {

    tab.addEventListener("click", () => {

        popularTabs.forEach(otherTab => {

            otherTab.classList.remove("active");
            otherTab.setAttribute("aria-pressed", "false");

        });

        tab.classList.add("active");
        tab.setAttribute("aria-pressed", "true");

        selectedPopularPeriod = tab.dataset.period;
        showingAllPopular = false;

        loadPopular(selectedPopularPeriod);

    });

});


/*
 * LAST ADDED — VIEW MORE
 */

if (lastAddedMore) {

    lastAddedMore.addEventListener("click", () => {

        showingAllLastAdded = true;
        displayLastAdded();

    });

}


/*
 * POPULAR — VIEW MORE
 */

if (popularMore) {

    popularMore.addEventListener("click", () => {

        showingAllPopular = true;
        loadPopular(selectedPopularPeriod);

    });

}


/*
 * LAST UPDATED — VIEW MORE
 */

if (lastUpdatedMore) {

    lastUpdatedMore.addEventListener("click", () => {

        showingAllLastUpdated = true;
        displayLastUpdated();

    });

}
