/*
 * NAPL — SIDE MENU & PAGE NAVIGATION COMPONENT
 *
 * Shared across NAPL SPA views.
 */

import {
    normalizeText,
    normalizePlatformLabel,
    isMultiGameAppsPlatform,
} from "../lib/helpers.js";

function getPlatformGroup(platform) {
    const normalized = normalizeText(platform);

    if (normalized === "others" || normalized === "other") {
        return "Others";
    }

    if (
        normalized.includes("playstation") ||
        normalized.includes("sony") ||
        /\bps[1-5p]\b/.test(normalized) ||
        normalized.includes("vita")
    ) {
        return "Sony";
    }

    if (normalized.includes("sega")) {
        return "Sega";
    }

    if (normalized.startsWith("xbox")) {
        return "Xbox";
    }

    if (
        normalized.includes("nintendo") ||
        normalized.includes("game boy") ||
        normalized.includes("gameboy") ||
        normalized.includes("gamecube") ||
        normalized === "nes"
    ) {
        return "Nintendo";
    }

    return "Others";
}

function getUniquePlatforms(platformOrder, games) {
    const unique = new Map();

    const source =
        Array.isArray(platformOrder) && platformOrder.length > 0
            ? platformOrder
            : (games || []).flatMap((g) => g.platforms || []);

    for (const raw of source) {
        const platform = normalizePlatformLabel(raw);
        if (!platform) continue;

        const key = normalizeText(platform);
        if (isMultiGameAppsPlatform(platform)) continue;

        if (!unique.has(key)) {
            unique.set(key, platform);
        }
    }

    return Array.from(unique.values());
}

export function initNavigation(options = {}) {
    const {
        onGoHome = null,
        onSelectAllGames = null,
        onSelectCategory = null,
        onSelectPlatform = null,
        onOpenCompatibility = null,
        onBeforeOpenMenu = null,
        onActionResetSearch = null,
    } = options;

    const menuButton = document.getElementById("menu-button");
    const menuClose = document.getElementById("menu-close");
    const sideMenu = document.getElementById("side-menu");
    const menuOverlay = document.getElementById("menu-overlay");
    const platformList = document.getElementById("platform-list");
    const allGamesButton = document.getElementById("all-games-button");
    const checkCompatibilityLink = document.getElementById("check-compatibility-link");
    const homeButton = document.getElementById("home-button");

    let openGroups = new Set();

    checkCompatibilityLink?.addEventListener("click", (event) => {
        if (
            onOpenCompatibility &&
            event.button === 0 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey
        ) {
            event.preventDefault();
            onActionResetSearch?.();
            onOpenCompatibility();
        }
        closeMenu();
    });

    function openMenu() {
        onBeforeOpenMenu?.();
        sideMenu?.classList.add("open");
        menuOverlay?.classList.add("visible");
        sideMenu?.setAttribute("aria-hidden", "false");
        menuOverlay?.setAttribute("aria-hidden", "false");
        menuButton?.setAttribute("aria-expanded", "true");
        menuClose?.focus();
    }

    function closeMenu() {
        sideMenu?.classList.remove("open");
        menuOverlay?.classList.remove("visible");
        sideMenu?.setAttribute("aria-hidden", "true");
        menuOverlay?.setAttribute("aria-hidden", "true");
        menuButton?.setAttribute("aria-expanded", "false");
    }

    function createPlatformMenuItem(label, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "platform-button platform-sub-button";
        button.textContent = label;
        button.addEventListener("click", () => {
            onActionResetSearch?.();
            onClick?.();
            closeMenu();
        });
        return button;
    }

    function renderPlatforms(platformOrder, loadedGames) {
        if (!platformList) return;

        platformList.replaceChildren();

        const platforms = getUniquePlatforms(platformOrder, loadedGames);
        const groupOrder = ["Nintendo", "Sega", "Sony", "Xbox", "Others"];
        const grouped = new Map(groupOrder.map((group) => [group, []]));

        for (const platform of platforms) {
            const group = getPlatformGroup(platform);
            if (!grouped.has(group)) {
                grouped.set(group, []);
                groupOrder.push(group);
            }
            grouped.get(group).push(platform);
        }

        const populatedGroups = groupOrder.filter(
            (group) => (grouped.get(group) || []).length > 0
        );

        if (populatedGroups.length === 0) {
            const msg = document.createElement("div");
            msg.className = "menu-separator";
            msg.textContent = "No platforms available";
            platformList.appendChild(msg);
            return;
        }

        // If the page loaded with ?platform=..., open its group automatically.
        const urlPlatform = new URLSearchParams(window.location.search).get("platform");
        if (urlPlatform) {
            const urlGroup = getPlatformGroup(normalizePlatformLabel(urlPlatform));
            if (populatedGroups.includes(urlGroup)) {
                openGroups.add(urlGroup);
            }
        }

        const fragment = document.createDocumentFragment();

        for (const group of populatedGroups) {
            const entries = grouped.get(group) || [];
            const slug = group.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            const panelId = `platform-group-panel-${slug}`;
            const isOpen = openGroups.has(group);

            const groupEl = document.createElement("div");
            groupEl.className = `platform-group${isOpen ? " is-open" : ""}`;

            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "platform-group-toggle";
            toggle.setAttribute("aria-expanded", String(isOpen));
            toggle.setAttribute("aria-controls", panelId);

            const labelSpan = document.createElement("span");
            labelSpan.className = "platform-group-label";
            labelSpan.textContent = group;

            const arrowSpan = document.createElement("span");
            arrowSpan.className = "platform-group-arrow";
            arrowSpan.setAttribute("aria-hidden", "true");
            arrowSpan.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

            toggle.append(labelSpan, arrowSpan);

            const panel = document.createElement("div");
            panel.id = panelId;
            panel.className = "platform-group-panel";
            panel.hidden = !isOpen;

            for (const platform of entries) {
                panel.appendChild(
                    createPlatformMenuItem(platform, () =>
                        onSelectPlatform?.(platform)
                    )
                );
            }

            toggle.addEventListener("click", () => {
                const nextOpen = panel.hidden;
                if (nextOpen) {
                    openGroups.add(group);
                } else {
                    openGroups.delete(group);
                }
                groupEl.classList.toggle("is-open", nextOpen);
                toggle.setAttribute("aria-expanded", String(nextOpen));
                panel.hidden = !nextOpen;
            });

            groupEl.append(toggle, panel);
            fragment.appendChild(groupEl);
        }

        platformList.appendChild(fragment);
    }

    menuButton?.addEventListener("click", () => {
        if (sideMenu?.classList.contains("open")) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    menuClose?.addEventListener("click", closeMenu);
    menuOverlay?.addEventListener("click", closeMenu);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && sideMenu?.classList.contains("open")) {
            closeMenu();
            menuButton?.focus();
        }
    });

    if (homeButton) {
        const triggerHome = () => {
            onActionResetSearch?.();
            onGoHome?.();
            closeMenu();
        };

        homeButton.addEventListener("click", triggerHome);
        homeButton.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                triggerHome();
            }
        });
    }

    allGamesButton?.addEventListener("click", () => {
        onActionResetSearch?.();
        onSelectAllGames?.();
        closeMenu();
    });

    document.querySelectorAll("#side-menu [data-category]").forEach((button) => {
        const category = button.dataset.category;
        if (!category) return;

        button.addEventListener("click", () => {
            onActionResetSearch?.();
            onSelectCategory?.(category);
            closeMenu();
        });
    });

    return {
        renderPlatforms,
        closeMenu,
    };
}
