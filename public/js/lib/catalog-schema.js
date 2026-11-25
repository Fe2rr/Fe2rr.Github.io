/*
 * NAPL — CATALOG JSON HYDRATION
 */

import { createSlug } from "./helpers.js";

const CATALOG_SCHEMA_VERSION = 1;

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
        const popularityKey = createSlug(
            String(rawGame.popularityKey ?? "").trim() || gameName
        );

        const platform = String(rawGame.platform || rawGame.platforms?.[0] || "");

        const rawPorts = Array.isArray(rawGame.ports) ? rawGame.ports : [];
        const hydratedPorts = [];

        for (const rawPort of rawPorts) {
            if (!rawPort) continue;
            const port = {
                game: gameName,
                platform: String(rawGame.platform || rawPort.platform || platform || ""),
                year: String(rawPort.year || gameYear || ""),
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

            hydratedPorts.push(port);
            allRows.push(port);
        }

        games.push({
            name: gameName,
            year: gameYear,
            slug,
            popularityKey,
            coverUrl: gameCover,
            genre: gameGenre,
            description: gameDescription,
            platform,
            platforms: Array.isArray(rawGame.platforms)
                ? rawGame.platforms.filter(Boolean)
                : platform
                  ? [platform]
                  : [],
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
