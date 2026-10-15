/*
 * GAME RENDER
 *
 * Handles the visual presentation of game
 * information and port cards.
 */

import {
    isMultiGameApp,
    isMultiGameAppPort,
    findGamesUsingApp
} from "./game-apps.js";


/*
 * Normalize text for slug creation.
 */

function normalizeText(value) {

    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


/*
 * Create the same slug used by app.js.
 */

function createSlug(name) {

    return normalizeText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


/*
 * Display a standard information row.
 */

function createInfoRow(
    label,
    value
) {

    if (!value) {
        return null;
    }

    const row =
        document.createElement("div");

    row.className =
        "port-info-row";

    const labelElement =
        document.createElement("span");

    labelElement.className =
        "port-info-label";

    labelElement.textContent =
        label;

    const valueElement =
        document.createElement("span");

    valueElement.className =
        "port-info-value";

    valueElement.textContent =
        value;

    row.appendChild(labelElement);
    row.appendChild(valueElement);

    return row;
}


/*
 * Display an information row with a linked
 * value instead of a linked label.
 */

function createInfoRowWithLinkedValue(
    label,
    value,
    url
) {

    if (!value) {
        return null;
    }

    const row =
        document.createElement("div");

    row.className =
        "port-info-row";

    /*
     * The label remains plain text.
     */

    const labelElement =
        document.createElement("span");

    labelElement.className =
        "port-info-label";

    labelElement.textContent =
        label;

    /*
     * Only the value becomes a link.
     */

    const valueElement =
        document.createElement("a");

    valueElement.className =
        "port-info-value";

    valueElement.href =
        url;

    valueElement.target =
        "_blank";

    valueElement.rel =
        "noopener noreferrer";

    valueElement.textContent =
        value;

    row.appendChild(labelElement);
    row.appendChild(valueElement);

    return row;
}


/*
 * Display the list of games that use
 * a Multi-game App.
 *
 * The title and parent element can vary
 * depending on where the list is displayed.
 */

function displayGamesUsingApp(
    appName,
    allRows,
    titleText,
    parentElement
) {

    const gamesUsingApp =
        findGamesUsingApp(
            appName,
            allRows
        );

    if (
        gamesUsingApp.length === 0
    ) {
        return;
    }

    const section =
        document.createElement("section");

    section.className =
        "games-using-app";

    /*
     * Collapsible header.
     */

    const toggle =
        document.createElement("button");

    toggle.type =
        "button";

    toggle.className =
        "games-using-app-toggle";

    toggle.setAttribute(
        "aria-expanded",
        "false"
    );

    const title =
        document.createElement("span");

    title.textContent =
        titleText;

    const arrow =
        document.createElement("span");

    arrow.className =
        "games-using-app-arrow";

    arrow.textContent =
        "▼";

    toggle.appendChild(title);
    toggle.appendChild(arrow);

    /*
     * Game list.
     */

    const list =
        document.createElement("div");

    list.className =
        "games-using-app-list";

    list.hidden = true;

    for (
        const game
        of gamesUsingApp
    ) {

        const link =
            document.createElement("a");

        link.className =
            "games-using-app-item";

        link.href =
            `game.html?game=${encodeURIComponent(
                createSlug(game.name)
            )}`;

        link.textContent =
            game.name;

        if (game.year) {

            const year =
                document.createElement("span");

            year.textContent =
                ` (${game.year})`;

            link.appendChild(year);
        }

        list.appendChild(link);
    }

    /*
     * Toggle open / closed.
     */

    toggle.addEventListener(
        "click",
        () => {

            const isOpen =
                toggle.getAttribute(
                    "aria-expanded"
                ) === "true";

            toggle.setAttribute(
                "aria-expanded",
                String(!isOpen)
            );

            list.hidden =
                isOpen;

            arrow.textContent =
                isOpen
                    ? "▼"
                    : "▲";
        }
    );

    section.appendChild(toggle);
    section.appendChild(list);

    parentElement.appendChild(section);
}


/*
 * Display the selected game.
 */

export function displayGame(
    game,
    allRows
) {

    const gameTitle =
        document.getElementById("game-title");

    const gameYear =
        document.getElementById("game-year");

    const portList =
        document.getElementById("port-list");

    const statusElement =
        document.getElementById("status");


    /*
     * Update game header.
     */

    gameTitle.textContent =
        game.name;

    gameYear.textContent =
        game.year || "";

    statusElement.textContent =
        `${game.ports.length} port${game.ports.length !== 1 ? "s" : ""}`;

    portList.innerHTML = "";


    /*
     * Display each port.
     */

    for (
        let index = 0;
        index < game.ports.length;
        index++
    ) {

        const port =
            game.ports[index];

        const card =
            document.createElement("div");

        card.className =
            "port";


        /*
         * Port title.
         */

        const title =
            document.createElement("h2");

        title.className =
            "port-title";

        title.textContent =
            port.project ||
            `Port ${index + 1}`;

        card.appendChild(title);


        /*
         * Port information.
         */

        const info =
            document.createElement("div");

        info.className =
            "port-info";

        const fields = [

            ["Developer", port.developer],

            ["Version", port.version],

            ["Supported Inputs", port.controller],

            ["Needs Game Files?", port.files],

            ["Works?", port.works],

            ["Last Update", port.lastUpdate]

        ];

        for (
            const [label, value]
            of fields
        ) {

            let row;

            /*
             * Link the VALUE to DATA URL
             * when a destination is available.
             */

            if (
                label === "Needs Game Files?" &&
                port.dataUrl
            ) {

                row =
                    createInfoRowWithLinkedValue(
                        label,
                        value,
                        port.dataUrl
                    );

            } else {

                row =
                    createInfoRow(
                        label,
                        value
                    );
            }

            if (row) {
                info.appendChild(row);
            }
        }

        card.appendChild(info);


        /*
         * Notes.
         */

        if (port.notes) {

            const notes =
                document.createElement("div");

            notes.className =
                "port-notes";

            const notesTitle =
                document.createElement("strong");

            notesTitle.textContent =
                "Notes";

            const notesText =
                document.createElement("p");

            notesText.textContent =
                port.notes;

            notes.appendChild(notesTitle);
            notes.appendChild(notesText);

            card.appendChild(notes);
        }


        /*
         * Port link.
         *
         * LINK = button text.
         * URL = destination.
         */

        if (port.url) {

            const link =
                document.createElement("a");

            link.className =
                "port-link";

            link.href =
                port.url;

            link.target =
                "_blank";

            link.rel =
                "noopener noreferrer";

            link.textContent =
                port.link ||
                "Open Port →";

            card.appendChild(link);
        }


        /*
         * Add the port card to the page.
         */

        portList.appendChild(card);


        /*
         * If this port uses a Multi-game App,
         * display the other games supported by it.
         */

        if (
            isMultiGameAppPort(
                port,
                allRows
            )
        ) {

            displayGamesUsingApp(
                port.project,
                allRows,
                "With this port you can also play:",
                card
            );
        }
    }


    /*
     * If this is a Multi-game App,
     * display the games that use it.
     */

    if (
        isMultiGameApp(game)
    ) {

        displayGamesUsingApp(
            game.name,
            allRows,
            "Games using this app",
            portList
        );
    }
}
