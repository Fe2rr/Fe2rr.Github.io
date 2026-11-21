/*
 * NAPL — GAME CARD COMPONENT
 */

import { loadCoverImage } from "../lib/cover-fallback.js";
import { clearHeroViewTransitions } from "../lib/helpers.js";

export function getRepresentativePort(game) {
    if (!game || !Array.isArray(game.ports)) {
        return null;
    }

    return (
        game.ports.find(
            (port) => port && String(port.project || "").trim()
        ) ||
        game.ports.find(
            (port) =>
                port &&
                (String(port.platform || "").trim() ||
                    String(port.developer || "").trim())
        ) ||
        null
    );
}

export function getPortDisplayName(port) {
    if (!port) return "Android port";

    const project = String(port.project || "").trim();
    if (project) return project;

    const platform = String(port.platform || "").trim();
    if (platform) return platform;

    const developer = String(port.developer || "").trim();
    if (developer) return developer;

    return "Android port";
}

export function getGamePlatformLabel(game, port) {
    let platforms = [];

    if (Array.isArray(game?.platforms)) {
        platforms = game.platforms;
    }

    if (platforms.length === 0 && port?.platform) {
        platforms = [port.platform];
    }

    platforms = [
        ...new Set(
            platforms
                .map((platform) => String(platform || "").trim())
                .filter(Boolean)
        ),
    ];

    if (platforms.length === 0) return "";
    if (platforms.length <= 2) return platforms.join(" · ");

    return `${platforms[0]} · ${platforms[1]} +${platforms.length - 2}`;
}

export function createHomeGameCard(game, port, options = {}) {
    const element = document.createElement("a");
    element.className = "home-game";
    const gameUrl = new URL("./", window.location.href);
    gameUrl.searchParams.set("game", game.slug);
    if (options.returnUrl && options.returnUrl !== "./") {
        gameUrl.searchParams.set("return", options.returnUrl);
    }
    element.href = gameUrl.href;

    const coverContainer = document.createElement("div");
    coverContainer.className = "home-game-cover-container";

    const coverUrl = String(game.coverUrl || "").trim();
    let backdrop = null;

    if (/^https?:\/\/\S+$/i.test(coverUrl)) {
        backdrop = document.createElement("img");
        backdrop.className = "home-game-backdrop";
        backdrop.alt = "";
        backdrop.decoding = "async";
        backdrop.referrerPolicy = "no-referrer";
        backdrop.setAttribute("aria-hidden", "true");

        const syncBackdrop = (src) => {
            if (!backdrop) return;
            if (src) {
                backdrop.src = src;
                backdrop.classList.add("is-loaded");
            } else {
                backdrop.classList.remove("is-loaded");
                backdrop.removeAttribute("src");
            }
        };

        const cover = document.createElement("img");
        cover.className = "home-game-cover";
        cover.alt = `${game.name} cover`;
        cover.loading = "eager";
        cover.decoding = "async";
        cover.referrerPolicy = "no-referrer";
        cover.addEventListener(
            "load",
            () => {
                coverContainer.classList.add("is-loaded");
                syncBackdrop(cover.currentSrc || cover.src);
            },
            { once: true }
        );

        coverContainer.appendChild(cover);

        loadCoverImage(cover, coverUrl, () => {
            cover.remove();
            backdrop?.remove();
            backdrop = null;
            coverContainer.classList.remove("is-loaded");
            coverContainer.classList.add("cover-unavailable");
        });

        if (cover.complete && cover.naturalWidth > 0) {
            coverContainer.classList.add("is-loaded");
            syncBackdrop(cover.currentSrc || cover.src);
        }
    } else {
        coverContainer.classList.add("cover-unavailable");
    }

    const content = document.createElement("div");
    content.className = "home-game-content";

    if (Number.isFinite(options.rank)) {
        const rank = document.createElement("span");
        rank.className = "home-game-rank";
        rank.textContent = `#${options.rank}`;
        content.appendChild(rank);
    }

    const name = document.createElement("span");
    name.className = "home-game-name";
    name.textContent = game.name;

    const metadata = document.createElement("span");
    metadata.className = "home-game-metadata";

    const platformLabel = getGamePlatformLabel(game, port);
    const year = String(game.year || port?.year || "").trim();

    const metadataParts = [];
    if (platformLabel) metadataParts.push(platformLabel);
    if (year) metadataParts.push(year);

    metadata.textContent = metadataParts.join(" · ");
    content.appendChild(name);

    if (metadataParts.length > 0) {
        content.appendChild(metadata);
    }

    if (options.showPort !== false) {
        const portName = document.createElement("span");
        portName.className = "home-game-port";
        portName.textContent = getPortDisplayName(port);
        content.appendChild(portName);
    }

    if (backdrop) {
        element.append(backdrop, coverContainer, content);
    } else {
        element.append(coverContainer, content);
    }

    const reducedMotionQuery = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
    );

    element.addEventListener("pointermove", (event) => {
        if (reducedMotionQuery?.matches) return;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        element.style.setProperty("--spot-x", `${x.toFixed(1)}%`);
        element.style.setProperty("--spot-y", `${y.toFixed(1)}%`);
    });

    element.addEventListener("pointerleave", () => {
        element.style.removeProperty("--spot-x");
        element.style.removeProperty("--spot-y");
    });

    element.addEventListener("click", (event) => {
        if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }
        clearHeroViewTransitions();
        coverContainer.style.viewTransitionName = "napl-hero-cover";
        name.style.viewTransitionName = "napl-hero-title";
    });

    return element;
}
