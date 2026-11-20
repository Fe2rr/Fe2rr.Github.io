/*
 * NAPL — CATALOG JSON SCHEMA, CSV CONVERTER & HYDRATION
 *
 * Shared between Express server (Node.js) and browser modules.
 */

import {
    normalizeHeader,
    normalizeText,
    normalizePlatformLabel,
    createSlug,
    isMultiGameAppsPlatform,
} from "./helpers.js";

const CATALOG_SCHEMA_VERSION = 1;

const PORT_STRING_FIELDS = [
    "portId",
    "project",
    "platform",
    "developer",
    "year",
    "version",
    "controller",
    "files",
    "works",
    "link",
    "url",
    "dataUrl",
    "githubRepo",
    "githubStatus",
    "lastUpdate",
    "dateAdded",
    "notes",
];

function cleanStr(value) {
    return String(value ?? "").trim();
}

function compactPort(port, fallbackYear = "") {
    const out = {};
    for (const field of PORT_STRING_FIELDS) {
        const val = cleanStr(port?.[field]);
        if (val) {
            out[field] = val;
        }
    }
    if (!out.year && cleanStr(fallbackYear)) {
        out.year = cleanStr(fallbackYear);
    }
    return out;
}

function normalizeCatalogDocument(rawDoc, options = {}) {
    const { updatedAt = cleanStr(rawDoc?.updatedAt) || new Date().toISOString() } = options;

    if (!rawDoc || typeof rawDoc !== "object" || !Array.isArray(rawDoc.games)) {
        throw new Error("Invalid catalog document: expected games array.");
    }

    const platformOrderSet = new Map();
    if (Array.isArray(rawDoc.platformOrder)) {
        for (const rawPlat of rawDoc.platformOrder) {
            const label = normalizePlatformLabel(rawPlat);
            if (!label || isMultiGameAppsPlatform(label)) continue;
            const key = normalizeText(label);
            if (!platformOrderSet.has(key)) {
                platformOrderSet.set(key, label);
            }
        }
    }

    const usedSlugs = new Set();
    const normalizedGames = [];

    for (const rawGame of rawDoc.games) {
        if (!rawGame || typeof rawGame !== "object") continue;
        const name = cleanStr(rawGame.name);
        if (!name) continue;

        let baseSlug = createSlug(cleanStr(rawGame.slug) || name) || "game";
        let slug = baseSlug;
        let suffix = 2;
        while (usedSlugs.has(slug)) {
            slug = `${baseSlug}-${suffix++}`;
        }
        usedSlugs.add(slug);

        const year = cleanStr(rawGame.year);
        const coverUrl = cleanStr(rawGame.coverUrl);
        const genre = cleanStr(rawGame.genre);
        const description = cleanStr(rawGame.description);
        const launchboxUrl = cleanStr(rawGame.launchboxUrl);

        const rawPorts = Array.isArray(rawGame.ports) ? rawGame.ports : [];
        const ports = [];
        const gamePlatforms = new Set();

        for (const rawPort of rawPorts) {
            if (!rawPort || typeof rawPort !== "object") continue;
            const p = compactPort(rawPort, year);

            if (p.platform) {
                const platLabel = normalizePlatformLabel(p.platform);
                p.platform = platLabel;
                gamePlatforms.add(platLabel);

                const platKey = normalizeText(platLabel);
                if (
                    !isMultiGameAppsPlatform(platLabel) &&
                    !platformOrderSet.has(platKey)
                ) {
                    platformOrderSet.set(platKey, platLabel);
                }
            }

            ports.push(p);
        }

        const gameEntry = {
            name,
            slug,
        };
        if (year) gameEntry.year = year;
        if (coverUrl) gameEntry.coverUrl = coverUrl;
        if (genre) gameEntry.genre = genre;
        if (description) gameEntry.description = description;
        if (launchboxUrl) gameEntry.launchboxUrl = launchboxUrl;
        if (gamePlatforms.size > 0) {
            gameEntry.platforms = Array.from(gamePlatforms);
        }
        gameEntry.ports = ports;

        normalizedGames.push(gameEntry);
    }

    return {
        version: CATALOG_SCHEMA_VERSION,
        updatedAt,
        platformOrder: Array.from(platformOrderSet.values()),
        games: normalizedGames,
    };
}

export function hydrateCatalog(doc) {
    if (!doc || !Array.isArray(doc.games)) {
        throw new Error("Invalid JSON catalog payload.");
    }

    const platformOrder = Array.isArray(doc.platformOrder)
        ? doc.platformOrder.filter(Boolean)
        : [];
    const allRows = [];
    const games = [];

    for (const rawGame of doc.games) {
        if (!rawGame || !rawGame.name) continue;
        const gameName = String(rawGame.name);
        const gameYear = String(rawGame.year || "");
        const gameCover = String(rawGame.coverUrl || "");
        const gameGenre = String(rawGame.genre || "");
        const gameDescription = String(rawGame.description || "");
        const slug = String(rawGame.slug || createSlug(gameName));

        const platformSet = new Set(
            Array.isArray(rawGame.platforms) ? rawGame.platforms.filter(Boolean) : []
        );

        const rawPorts = Array.isArray(rawGame.ports) ? rawGame.ports : [];
        const hydratedPorts = [];

        for (const rawPort of rawPorts) {
            if (!rawPort) continue;
            const port = {
                game: gameName,
                year: String(rawPort.year || gameYear || ""),
                platform: String(rawPort.platform || ""),
                project: String(rawPort.project || ""),
                portId: String(rawPort.portId || ""),
                link: String(rawPort.link || ""),
                url: String(rawPort.url || ""),
                dataUrl: String(rawPort.dataUrl || ""),
                githubRepo: String(rawPort.githubRepo || ""),
                githubStatus: String(rawPort.githubStatus || ""),
                developer: String(rawPort.developer || ""),
                version: String(rawPort.version || ""),
                controller: String(rawPort.controller || ""),
                files: String(rawPort.files || ""),
                works: String(rawPort.works || ""),
                lastUpdate: String(rawPort.lastUpdate || ""),
                dateAdded: String(rawPort.dateAdded || ""),
                notes: String(rawPort.notes || ""),
                coverUrl: gameCover,
                genre: gameGenre,
                description: gameDescription,
            };

            if (port.platform) {
                platformSet.add(port.platform);
            }

            hydratedPorts.push(port);
            allRows.push(port);
        }

        games.push({
            name: gameName,
            year: gameYear,
            slug,
            coverUrl: gameCover,
            genre: gameGenre,
            description: gameDescription,
            platforms: Array.from(platformSet),
            ports: hydratedPorts,
        });
    }

    return {
        version: Number(doc.version) || CATALOG_SCHEMA_VERSION,
        updatedAt: String(doc.updatedAt || ""),
        platformOrder,
        games,
        allRows,
    };
}

function parseCSV(csv) {
    const rows = [];
    let row = [];
    let field = "";
    let insideQuotes = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];

        if (char === '"') {
            if (insideQuotes && csv[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
            continue;
        }

        if (char === "," && !insideQuotes) {
            row.push(field);
            field = "";
            continue;
        }

        if ((char === "\n" || char === "\r") && !insideQuotes) {
            if (char === "\r" && csv[i + 1] === "\n") {
                i++;
            }

            row.push(field);
            field = "";

            if (row.some((value) => value.trim() !== "")) {
                rows.push(row);
            }

            row = [];
            continue;
        }

        field += char;
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);

        if (row.some((value) => value.trim() !== "")) {
            rows.push(row);
        }
    }

    if (rows.length === 0) {
        return [];
    }

    const headers = rows.shift().map(normalizeHeader);

    return rows.map((values) => {
        const rowObject = {};
        headers.forEach((header, index) => {
            if (header) {
                rowObject[header] = String(values[index] || "").trim();
            }
        });
        return rowObject;
    });
}

function getColumn(row, possibleNames) {
    for (const name of possibleNames) {
        const normalizedName = normalizeHeader(name);
        if (Object.prototype.hasOwnProperty.call(row, normalizedName)) {
            return String(row[normalizedName] || "").trim();
        }
    }
    return "";
}

function extractPlatformOrder(rows) {
    const uniquePlatforms = new Map();

    for (const row of rows) {
        const platform = normalizePlatformLabel(
            getColumn(row, ["PLATFORM", "PLATAFORM", "PLATAFORMA"])
        );
        if (!platform || isMultiGameAppsPlatform(platform)) {
            continue;
        }

        const key = normalizeText(platform);
        if (!uniquePlatforms.has(key)) {
            uniquePlatforms.set(key, platform);
        }
    }

    return Array.from(uniquePlatforms.values());
}

function processRows(rows) {
    let currentGame = "";
    let currentYear = "";
    const result = [];

    for (const row of rows) {
        const gameValue = getColumn(row, ["GAME", "GAME NAME", "NAME", "JUEGO"]);
        const yearValue = getColumn(row, ["YEAR", "ANO", "AÑO"]);
        const platformValue = getColumn(row, ["PLATFORM", "PLATAFORM", "PLATAFORMA"]);
        const projectValue = getColumn(row, ["PROJECT", "PROYECTO"]);

        if (gameValue) currentGame = gameValue;
        if (yearValue) currentYear = yearValue;

        const platform = platformValue;
        const project = projectValue;
        const rawPortId = getColumn(row, ["PORTS_ID", "PORT ID", "PORT_ID"]);
        const portId =
            /^unofficial-port(?:-\d+)?$/i.test(rawPortId) && currentGame
                ? `${createSlug(currentGame)}-${rawPortId.toLowerCase()}`
                : rawPortId;
        const link = getColumn(row, ["LINK", "PROJECT LINK", "ENLACE"]);
        const url = getColumn(row, ["URL", "PORT URL", "PORT LINK"]);
        const dataUrl = getColumn(row, ["DATA URL", "DATA LINK", "GAME FILES URL"]);
        const developer = getColumn(row, [
            "DEVELOPER",
            "DEVELOPER/PUBLISHER",
            "DESARROLLADOR",
        ]);
        const version = getColumn(row, ["VERSION", "VERSIÓN"]);
        const controller = getColumn(row, [
            "CONTROLLER SUPPORT",
            "CONTROLLER",
            "GAMEPAD",
            "MANDO",
        ]);
        const files = getColumn(row, [
            "NEEDS GAME FILES?",
            "NEEDS GAME FILES",
            "GAME FILES",
            "NECESITA ARCHIVOS",
        ]);
        const works = getColumn(row, ["WORKS?", "WORKS", "FUNCIONA"]);
        const lastUpdate = getColumn(row, [
            "LAST UPDATE",
            "LAST UPDATED",
            "ÚLTIMA ACTUALIZACIÓN",
        ]);
        const dateAdded = getColumn(row, ["DATE ADDED"]);
        const notes = getColumn(row, ["NOTES", "NOTE", "NOTAS"]);
        const coverUrl = getColumn(row, [
            "COVER_URL",
            "COVER URL",
            "COVER",
            "COVER IMAGE",
            "IMAGE URL",
            "PORTADA",
        ]);
        const genre = getColumn(row, ["GENRE", "GÉNERO", "GENERO"]);
        const description = getColumn(row, [
            "DESCRIPTION",
            "DESCRIPCIÓN",
            "DESCRIPCION",
        ]);

        const hasPortData = [
            project,
            link,
            url,
            dataUrl,
            developer,
            version,
            controller,
            files,
            works,
            lastUpdate,
            dateAdded,
            notes,
        ].some((value) => String(value || "").trim() !== "");

        if (!currentGame || !hasPortData) {
            continue;
        }

        result.push({
            game: currentGame,
            year: currentYear,
            platform,
            project,
            portId,
            link,
            url,
            dataUrl,
            developer,
            version,
            controller,
            files,
            works,
            lastUpdate,
            dateAdded,
            notes,
            coverUrl,
            genre,
            description,
        });
    }

    return result;
}

function groupGames(rows) {
    const grouped = new Map();
    if (!Array.isArray(rows)) return [];

    for (const port of rows) {
        if (!port || !port.game) continue;
        const key = normalizeText(port.game);
        if (!key) continue;

        if (!grouped.has(key)) {
            grouped.set(key, {
                name: port.game,
                year: port.year || "",
                slug: createSlug(port.game),
                coverUrl: port.coverUrl || "",
                genre: port.genre || "",
                description: port.description || "",
                ports: [],
                platforms: new Set(),
            });
        }

        const game = grouped.get(key);
        if (!game.year && port.year) game.year = port.year;
        if (!game.coverUrl && port.coverUrl) game.coverUrl = port.coverUrl;
        if (!game.genre && port.genre) game.genre = port.genre;
        if (!game.description && port.description) {
            game.description = port.description;
        }
        if (port.platform) {
            game.platforms.add(port.platform);
        }

        game.ports.push(port);
    }

    return Array.from(grouped.values()).map((game) => ({
        ...game,
        platforms: Array.from(game.platforms),
    }));
}

export function csvToCatalogDocument(csvText, updatedAt = new Date().toISOString()) {
    const rows = parseCSV(csvText);
    if (!rows.length) {
        throw new Error("Google Sheets returned an empty catalog.");
    }

    const allRows = processRows(rows);
    if (!allRows.length) {
        throw new Error(
            "The Community Ports sheet was read, but no valid ports were found."
        );
    }

    const games = groupGames(allRows);
    const platformOrder = extractPlatformOrder(rows);

    return normalizeCatalogDocument(
        {
            version: CATALOG_SCHEMA_VERSION,
            updatedAt,
            platformOrder,
            games,
        },
        { updatedAt }
    );
}
