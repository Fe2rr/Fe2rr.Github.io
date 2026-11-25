/*
 * NAPL — SHARED HELPERS (TEXT, SLUG & DATES)
 *
 * Single source of truth shared across home and game pages.
 */

export function normalizeText(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

export function createSlug(name) {
    return normalizeText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function normalizeSearchText(value) {
    return normalizeText(value)
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

export function filterAndSortByQuery(
    items,
    getName,
    query,
    normalizeFn = normalizeText
) {
    const normalizedQuery = normalizeFn(query);
    if (!normalizedQuery) return [];
    return (Array.isArray(items) ? items : [])
        .filter((item) => normalizeFn(getName(item)).includes(normalizedQuery))
        .sort((a, b) => {
            const nameA = normalizeFn(getName(a));
            const nameB = normalizeFn(getName(b));
            const startsA = nameA.startsWith(normalizedQuery);
            const startsB = nameB.startsWith(normalizedQuery);
            if (startsA !== startsB) return startsA ? -1 : 1;
            return nameA.localeCompare(nameB, "en", { sensitivity: "base" });
        });
}

export function normalizePlatformLabel(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ");
}

const UNKNOWN_DEVELOPER_VALUES = new Set([
    "-",
    "unknown",
    "n/a",
    "na",
    "none",
    "?",
]);

export function normalizeDeveloperName(value) {
    const collapsed = String(value ?? "")
        .trim()
        .replace(/\s+/g, " ");
    const normalized = normalizeText(collapsed);
    if (!normalized || UNKNOWN_DEVELOPER_VALUES.has(normalized)) {
        return "";
    }
    return normalized;
}

export function isMultiGameAppsPlatform(platform) {
    const key = normalizeText(platform);
    return key === "multi-game apps" || key === "multi game apps";
}

export function clearHeroViewTransitions() {
    if (typeof document === "undefined") return;
    document
        .querySelectorAll(
            ".home-game-cover-container, .home-game-name, .search-result, .spotlight-cover-frame, .spotlight-title"
        )
        .forEach((el) => {
            if (
                el.style.viewTransitionName === "napl-hero-cover" ||
                el.style.viewTransitionName === "napl-hero-title"
            ) {
                el.style.viewTransitionName = "";
            }
        });
}

export function getDeveloperGameCounts(rows) {
    const gamesByDev = new Map();
    if (!Array.isArray(rows)) return new Map();

    for (const row of rows) {
        const devKey = normalizeDeveloperName(row?.developer);
        const gameKey = normalizeText(row?.game);
        if (!devKey || !gameKey) continue;

        let gameSet = gamesByDev.get(devKey);
        if (!gameSet) {
            gameSet = new Set();
            gamesByDev.set(devKey, gameSet);
        }
        gameSet.add(gameKey);
    }

    const counts = new Map();
    for (const [devKey, gameSet] of gamesByDev.entries()) {
        counts.set(devKey, gameSet.size);
    }
    return counts;
}

function pickLatestMatchingPort(ports) {
    if (!Array.isArray(ports) || ports.length === 0) return null;

    const namedPorts = ports.filter(
        (port) => String(port.project || "").trim() !== ""
    );
    const pool = namedPorts.length > 0 ? namedPorts : ports;

    let bestPort = pool[0];
    let bestDate = parseLastUpdate(bestPort.lastUpdate);

    for (let i = 1; i < pool.length; i++) {
        const candidate = pool[i];
        const candidateDate = parseLastUpdate(candidate.lastUpdate);
        if (candidateDate && (!bestDate || candidateDate > bestDate)) {
            bestPort = candidate;
            bestDate = candidateDate;
        }
    }

    return bestPort;
}

export function getMatchingDeveloperPort(game, developer, preferredPlatform = "") {
    const targetKey = normalizeDeveloperName(developer);
    if (!targetKey || !game || !Array.isArray(game.ports)) {
        return null;
    }

    const matchingPorts = game.ports.filter(
        (port) => port && normalizeDeveloperName(port.developer) === targetKey
    );
    if (matchingPorts.length === 0) return null;

    const platformKey = normalizeText(preferredPlatform);
    const platformMatched = platformKey
        ? matchingPorts.filter(
              (port) => normalizeText(port.platform) === platformKey
          )
        : [];

    return pickLatestMatchingPort(
        platformMatched.length > 0 ? platformMatched : matchingPorts
    );
}

export function getMatchingPlatformPort(game, platform) {
    const platformKey = normalizeText(platform);
    if (!platformKey || !game || !Array.isArray(game.ports)) {
        return null;
    }

    const matchingPorts = game.ports.filter(
        (port) => port && normalizeText(port.platform) === platformKey
    );
    return pickLatestMatchingPort(matchingPorts);
}

const UNKNOWN_YEAR_VALUES = new Set([
    "-",
    "unknown",
    "n/a",
    "na",
    "none",
    "?",
    "no information available",
    "tba",
    "tbd",
]);

export function normalizeYearValue(value) {
    const clean = String(value ?? "")
        .trim()
        .replace(/\s+/g, " ");
    const normalized = normalizeText(clean);
    if (!normalized || UNKNOWN_YEAR_VALUES.has(normalized)) {
        return "";
    }
    return clean;
}

const UNKNOWN_GENRE_VALUES = new Set([
    "-",
    "unknown",
    "n/a",
    "na",
    "none",
    "?",
    "no information available",
]);

export function extractGameGenres(genreValue) {
    const raw = String(genreValue ?? "").trim();
    if (!raw) return [];

    const seen = new Set();
    const genres = [];

    for (const part of raw.split(/\s*[,/|·•]+\s*/)) {
        const clean = part.trim().replace(/\s+/g, " ");
        const normalized = normalizeText(clean);
        if (!normalized || UNKNOWN_GENRE_VALUES.has(normalized)) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        genres.push(clean);
    }

    return genres;
}

export function restoreDescriptionLineBreaks(description) {
    return String(description ?? "")
        .replace(/\s*\|\|\|\s*/g, "\n")
        .trim();
}

export function parseLastUpdate(value) {
    return parseDateAdded(value);
}

export function parseDateAdded(value) {
    if (value === null || value === undefined) return null;

    const text = String(value).trim();
    if (!text) return null;

    let datePart = text;
    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    const timeMatch = text.match(
        /(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/i
    );

    if (timeMatch) {
        hours = Number(timeMatch[1]);
        minutes = Number(timeMatch[2]);
        seconds = Number(timeMatch[3] || 0);

        if (hours > 23 || minutes > 59 || seconds > 59) {
            return null;
        }

        datePart = text.slice(0, timeMatch.index).trim();
    }

    let year;
    let month;
    let day;

    const monthMatch = datePart.match(
        /^(\d{4})\s*,\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)(?:\s+(\d{1,2}))?$/i
    );

    if (monthMatch) {
        year = Number(monthMatch[1]);

        const monthName = monthMatch[2]
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");

        day = monthMatch[3] ? Number(monthMatch[3]) : 1;

        const months = {
            january: 0, enero: 0,
            february: 1, febrero: 1,
            march: 2, marzo: 2,
            april: 3, abril: 3,
            may: 4, mayo: 4,
            june: 5, junio: 5,
            july: 6, julio: 6,
            august: 7, agosto: 7,
            september: 8, septiembre: 8, setiembre: 8,
            october: 9, octubre: 9,
            november: 10, noviembre: 10,
            december: 11, diciembre: 11,
        };

        if (!Object.prototype.hasOwnProperty.call(months, monthName)) {
            return null;
        }

        month = months[monthName];
    } else {
        const localMatch = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

        if (localMatch) {
            day = Number(localMatch[1]);
            month = Number(localMatch[2]) - 1;
            year = Number(localMatch[3]);
        } else {
            const isoMatch = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (!isoMatch) return null;

            year = Number(isoMatch[1]);
            month = Number(isoMatch[2]) - 1;
            day = Number(isoMatch[3]);
        }
    }

    const date = new Date(year, month, day, hours, minutes, seconds);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month ||
        date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

export function getLatestUpdate(game) {
    const dates = game.ports
        .map((port) => parseLastUpdate(port.lastUpdate))
        .filter((date) => date !== null);

    if (dates.length === 0) return null;

    return dates.reduce((latest, current) =>
        current > latest ? current : latest
    );
}

export function getDateAdded(game) {
    const dates = game.ports
        .map((port) => parseDateAdded(port.dateAdded))
        .filter((date) => date !== null);

    if (dates.length === 0) return null;

    return dates.reduce((latest, current) =>
        current > latest ? current : latest
    );
}
