/*
 * THE PORTS VAULT — GAME PAGE MENU AND SEARCH
 */

import { API_BASE } from "./api-config.js";
import { normalizeText } from "./text.js";

/*
 * GENERAL NAVIGATION
 */

const homeButton =
    document.getElementById("home-button");

const backButton =
    document.getElementById("back-button");

function goHome() {
    window.location.href = "index.html";
}

homeButton.addEventListener("click", goHome);

homeButton.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        goHome();
    }
});

backButton.addEventListener("click", function (event) {
    if (!document.referrer) {
        return;
    }

    try {
        if (
            new URL(document.referrer).origin ===
            location.origin
        ) {
            event.preventDefault();
            history.back();
        }
    } catch (error) {
        // Keep the normal back link if the referrer is invalid.
    }
});


/*
 * SIDE MENU
 */

const menuButton =
    document.getElementById("menu-button");

const menuClose =
    document.getElementById("menu-close");

const sideMenu =
    document.getElementById("side-menu");

const menuOverlay =
    document.getElementById("menu-overlay");

const platformList =
    document.getElementById("platform-list");

function openMenu() {
    sideMenu.classList.add("open");
    menuOverlay.classList.add("visible");

    sideMenu.setAttribute("aria-hidden", "false");
    menuOverlay.setAttribute("aria-hidden", "false");
    menuButton.setAttribute("aria-expanded", "true");

    menuClose.focus();
}

function closeMenu() {
    sideMenu.classList.remove("open");
    menuOverlay.classList.remove("visible");

    sideMenu.setAttribute("aria-hidden", "true");
    menuOverlay.setAttribute("aria-hidden", "true");
    menuButton.setAttribute("aria-expanded", "false");
}

menuButton.addEventListener("click", function () {
    if (sideMenu.classList.contains("open")) {
        closeMenu();
    } else {
        openMenu();
    }
});

menuClose.addEventListener("click", closeMenu);
menuOverlay.addEventListener("click", closeMenu);


/*
 * SEARCH ELEMENTS
 */

const searchButton =
    document.getElementById("search-button");

const searchContainer =
    document.getElementById("search-container");

const searchInput =
    document.getElementById("search");

const searchResults =
    document.getElementById("search-results");

let gameNames = [];


/*
 * NORMALIZE TEXT
 */



/*
 * NORMALIZE PLATFORM LABEL
 */

function normalizePlatformLabel(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ");
}


/*
 * PARSE CSV
 *
 * Supports quoted fields, commas inside quoted fields,
 * escaped quotes and line breaks inside quoted fields.
 */



/*
 * NORMALIZE COLUMN HEADERS
 */



/*
 * CREATE MENU SEPARATOR
 */

function addMenuSeparator(label) {
    const separator =
        document.createElement("div");

    separator.className = "menu-separator";
    separator.textContent = label;

    platformList.appendChild(separator);
}


/*
 * CREATE MENU LINK
 */

function addMenuLink(label, url) {
    const link =
        document.createElement("a");

    link.className = "platform-button";
    link.href = url;
    link.textContent = label;

    link.addEventListener("click", closeMenu);

    platformList.appendChild(link);
}


/*
 * GROUP PLATFORMS FOR DISPLAY
 */

function getPlatformGroup(platform) {
    const normalized = normalizeText(platform);

    if (
        normalized === "others" ||
        normalized === "other"
    ) {
        return "Others";
    }

    if (normalized.includes("playstation")) {
        return "PlayStation";
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


/*
 * BUILD THE PLATFORM MENU FROM THE SHEET
 */

function displayPlatformMenu(platforms) {
    platformList.replaceChildren();

    addMenuLink(
        "Multi-Game Apps",
        "index.html?category=multi-game-apps"
    );

    addMenuLink(
        "Dual Screen",
        "index.html?category=dual-screen"
    );

    const groupOrder = [
        "Nintendo",
        "PlayStation",
        "Xbox",
        "Others",
    ];

    const grouped = new Map();

    for (const group of groupOrder) {
        grouped.set(group, []);
    }

    for (const platform of platforms) {
        const group = getPlatformGroup(platform);

        if (!grouped.has(group)) {
            grouped.set(group, []);
        }

        grouped.get(group).push(platform);
    }

    let renderedCount = 0;

    for (const group of groupOrder) {
        const entries = grouped.get(group) || [];

        if (entries.length === 0) {
            continue;
        }

        addMenuSeparator(group);

        for (const platform of entries) {
            addMenuLink(
                platform,
                "index.html?platform=" +
                    encodeURIComponent(platform)
            );

            renderedCount++;
        }
    }

    if (renderedCount === 0) {
        const message =
            document.createElement("div");

        message.className = "menu-separator";
        message.textContent = "No platforms found.";

        platformList.appendChild(message);
    }
}


/*
 * SEARCH BUTTON
 */

function openSearch() {
    searchContainer.hidden = false;

    searchButton.setAttribute(
        "aria-expanded",
        "true"
    );

    searchInput.focus();
}

function closeSearch() {
    searchContainer.hidden = true;
    searchInput.value = "";

    searchResults.replaceChildren();
    searchResults.hidden = true;

    searchButton.setAttribute(
        "aria-expanded",
        "false"
    );
}

searchButton.addEventListener("click", function () {
    if (searchContainer.hidden) {
        openSearch();
    } else {
        closeSearch();
    }
});


/*
 * SEARCH WHILE TYPING
 */

searchInput.addEventListener("input", function () {
    const query = normalizeText(searchInput.value);

    searchResults.replaceChildren();

    if (!query) {
        searchResults.hidden = true;
        return;
    }

    const matches = gameNames
        .filter(game =>
            normalizeText(game.name).includes(query)
        )
        .sort((a, b) => {
            const nameA = normalizeText(a.name);
            const nameB = normalizeText(b.name);

            const aStarts = nameA.startsWith(query);
            const bStarts = nameB.startsWith(query);

            if (aStarts !== bStarts) {
                return aStarts ? -1 : 1;
            }

            return a.name.localeCompare(b.name);
        })
        .slice(0, 5);

    for (const game of matches) {
        const link =
            document.createElement("a");

        link.className = "search-result";
        link.setAttribute("role", "listitem");

        link.href =
            "game.html?game=" +
            encodeURIComponent(game.slug);

        link.textContent = game.name;

        searchResults.appendChild(link);
    }

    searchResults.hidden = matches.length === 0;
});


/*
 * KEYBOARD SHORTCUTS
 */

document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
        if (sideMenu.classList.contains("open")) {
            closeMenu();
            menuButton.focus();
            return;
        }

        if (!searchContainer.hidden) {
            closeSearch();
            searchButton.focus();
        }
    }
});


/*
 * LOAD GAME NAMES AND PLATFORMS
 */

async function loadMenuData() {
    try {
        const response = await fetch(`${API_BASE}/api/games`);

        if (!response.ok) {
            throw new Error(`The catalog returned HTTP ${response.status}.`);
        }

        const data = await response.json();

        gameNames = data.games.map(game => ({
            name: game.name,
            slug: game.slug
        }));

        displayPlatformMenu(
            data.platforms
                .map(normalizePlatformLabel)
                .filter(platform => {
                    const key = normalizeText(platform);
                    return key !== "multi-game apps" && key !== "multi game apps";
                })
        );
    } catch (error) {
        console.error(
            "Menu data could not be loaded:",
            error
        );

        platformList.replaceChildren();

        const message =
            document.createElement("div");

        message.className = "menu-separator";
        message.textContent =
            "Could not load platforms. Please try again later.";

        platformList.appendChild(message);
    }
}

loadMenuData();
