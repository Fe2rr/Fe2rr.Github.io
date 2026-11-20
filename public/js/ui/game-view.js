/*
 * NAPL — GAME DETAIL VIEW CONTROLLER (SPA)
 */

import { createSlug } from "../lib/helpers.js";
import { registerGameVisit } from "../lib/popularity.js";
import { loadPortRatings, createRatingActions } from "../lib/ratings.js";
import {
    loadGameCompatibility,
    createCompatibilityActions,
} from "../lib/compatibility-api.js";
import { renderGameDetailSkeletons } from "./loading.js";
import { displayGame } from "./game-render.js";

export function createGameViewController() {
    const gameHeader = document.getElementById("game-header");
    const portsHeader = document.getElementById("ports-header");
    const portList = document.getElementById("port-list");
    const status = document.getElementById("game-status");

    let activeRequestId = 0;

    async function openGame(requestedSlug, catalog) {
        if (!gameHeader || !portList || !status) {
            console.error("NAPL: required game view elements are missing.");
            return;
        }

        const requestId = ++activeRequestId;
        status.classList.remove("sr-only");

        if (!requestedSlug) {
            if (portsHeader) portsHeader.hidden = true;
            gameHeader.textContent = "No game selected.";
            status.textContent = "Return to the list and select a game.";
            portList.replaceChildren();
            document.title = "Game Details — NAPL";
            return;
        }

        const targetSlug = createSlug(requestedSlug);
        const game = catalog?.games?.find((item) => item.slug === targetSlug);

        if (!game) {
            if (portsHeader) portsHeader.hidden = true;
            gameHeader.textContent = "Game not found.";
            status.textContent =
                "This game could not be found in the spreadsheet.";
            portList.replaceChildren();
            document.title = "Game Not Found — NAPL";
            return;
        }

        document.title = `${game.name} — NAPL`;
        status.textContent = "";
        if (portsHeader) portsHeader.hidden = true;
        renderGameDetailSkeletons(gameHeader, portList, Math.max(1, Math.min(game.ports?.length || 2, 3)));
        registerGameVisit(game.name);

        try {
            const portIds = Array.from(
                new Set(
                    (game.ports || [])
                        .map((port) => String(port?.portId || "").trim())
                        .filter(Boolean)
                )
            );

            const [ratings, compatibility] = await Promise.all([
                loadPortRatings(),
                loadGameCompatibility(portIds),
            ]);

            if (requestId !== activeRequestId) return;

            displayGame(
                game,
                catalog.allRows,
                ratings,
                createRatingActions(),
                compatibility,
                createCompatibilityActions()
            );
        } catch (error) {
            if (requestId !== activeRequestId) return;
            console.error("NAPL: could not load selected game.", error);
            if (portsHeader) portsHeader.hidden = true;
            status.classList.remove("sr-only");
            gameHeader.textContent = "Could not load this game.";
            status.textContent =
                error instanceof Error
                    ? error.message
                    : "An unexpected error occurred.";
            portList.replaceChildren();
        }
    }

    function clear() {
        activeRequestId++;
    }

    return {
        openGame,
        clear,
    };
}
