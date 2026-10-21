/*
 * THE PORTS VAULT — DATA PROCESSING
 *
 * Reads Google Sheets CSV data and normalizes
 * game and port information for the application.
 */


/*
 * NORMALIZE COLUMN NAMES
 */

function normalizeHeader(value) {

    return String(value || "")
        .replace(/^\uFEFF/, "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

}


/*
 * NORMALIZE TEXT
 */

function normalizeText(value) {

    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

}


/*
 * CREATE GAME SLUG
 */

function createSlug(name) {

    return normalizeText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

}


/*
 * CSV PARSER
 */

function parseCSV(csv) {

    const rows = [];

    let row = [];
    let field = "";
    let insideQuotes = false;

    for (let i = 0; i < csv.length; i++) {

        const char = csv[i];

        if (char === '"') {

            if (
                insideQuotes &&
                csv[i + 1] === '"'
            ) {

                field += '"';
                i++;

            } else {

                insideQuotes = !insideQuotes;

            }

            continue;

        }

        if (
            char === "," &&
            !insideQuotes
        ) {

            row.push(field);
            field = "";

            continue;

        }

        if (
            (char === "\n" || char === "\r") &&
            !insideQuotes
        ) {

            if (
                char === "\r" &&
                csv[i + 1] === "\n"
            ) {

                i++;

            }

            row.push(field);
            field = "";

            if (
                row.some(
                    value => value.trim() !== ""
                )
            ) {

                rows.push(row);

            }

            row = [];

            continue;

        }

        field += char;

    }

    if (
        field.length > 0 ||
        row.length > 0
    ) {

        row.push(field);

        if (
            row.some(
                value => value.trim() !== ""
            )
        ) {

            rows.push(row);

        }

    }

    if (rows.length === 0) {

        return [];

    }

    const headers = rows.shift().map(
        normalizeHeader
    );

    return rows.map(values => {

        const rowObject = {};

        headers.forEach(
            (header, index) => {

                rowObject[header] =
                    (values[index] || "").trim();

            }
        );

        return rowObject;

    });

}


/*
 * FIND A COLUMN BY ITS HEADER
 *
 * Column positions do not matter.
 */

function getColumn(row, possibleNames) {

    for (const name of possibleNames) {

        const normalizedName =
            normalizeHeader(name);

        if (
            Object.prototype.hasOwnProperty.call(
                row,
                normalizedName
            )
        ) {

            return row[normalizedName];

        }

    }

    return "";

}


/*
 * CONVERT CSV ROWS
 */

function processRows(rows) {

    let currentGame = "";
    let currentYear = "";

    const result = [];

    for (const row of rows) {

        const gameValue = getColumn(row, [
            "GAME",
            "GAME NAME",
            "NAME",
            "JUEGO"
        ]).trim();

        const yearValue = getColumn(row, [
            "YEAR",
            "ANO",
            "AÑO"
        ]).trim();

        if (gameValue) {

            currentGame = gameValue;

        }

        if (yearValue) {

            currentYear = yearValue;

        }

        const platform = getColumn(row, [
            "PLATFORM",
            "PLATAFORM",
            "PLATAFORMA"
        ]).trim();

        const project = getColumn(row, [
            "PROJECT",
            "PROYECTO"
        ]);

        const link = getColumn(row, [
            "LINK",
            "PROJECT LINK",
            "ENLACE"
        ]);

        const url = getColumn(row, [
            "URL"
        ]);

        const dataUrl = getColumn(row, [
            "DATA URL",
            "DATA LINK",
            "GAME FILES URL"
        ]);

        const developer = getColumn(row, [
            "DEVELOPER",
            "DEVELOPER/PUBLISHER",
            "DESARROLLADOR"
        ]);

        const version = getColumn(row, [
            "VERSION",
            "VERSIÓN"
        ]);

        const controller = getColumn(row, [
            "CONTROLLER SUPPORT",
            "CONTROLLER",
            "GAMEPAD",
            "MANDO"
        ]);

        const files = getColumn(row, [
            "NEEDS GAME FILES?",
            "NEEDS GAME FILES",
            "GAME FILES",
            "NECESITA ARCHIVOS"
        ]);

        const works = getColumn(row, [
            "WORKS?",
            "WORKS",
            "FUNCIONA"
        ]);

        const lastUpdate = getColumn(row, [
            "LAST UPDATE",
            "LAST UPDATED",
            "ÚLTIMA ACTUALIZACIÓN"
        ]);

        const dateAdded = getColumn(row, [
            "DATE ADDED"
        ]).trim();

        const notes = getColumn(row, [
            "NOTES",
            "NOTE",
            "NOTAS"
        ]);

        /*
         * GAME METADATA
         *
         * These fields will be used by the home cards.
         */

        const coverUrl = getColumn(row, [
            "COVER_URL",
            "COVER URL",
            "COVER",
            "COVER IMAGE",
            "IMAGE URL",
            "PORTADA"
        ]).trim();

        const genre = getColumn(row, [
            "GENRE",
            "GÉNERO",
            "GENERO"
        ]).trim();

        const description = getColumn(row, [
            "DESCRIPTION",
            "DESCRIPCIÓN",
            "DESCRIPCION"
        ]).trim();

        /*
         * Preserve the existing rule:
         * a row must contain port data to be processed.
         */

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
            notes
        ].some(
            value => String(value || "").trim() !== ""
        );

        if (
            !currentGame ||
            !hasPortData
        ) {

            continue;

        }

        result.push({

            game: currentGame,

            year: currentYear,

            platform: platform,

            project: project.trim(),

            link: link.trim(),

            url: url.trim(),

            dataUrl: dataUrl.trim(),

            developer: developer.trim(),

            version: version.trim(),

            controller: controller.trim(),

            files: files.trim(),

            works: works.trim(),

            lastUpdate: lastUpdate.trim(),

            dateAdded: dateAdded,

            notes: notes.trim(),

            coverUrl: coverUrl,

            genre: genre,

            description: description

        });

    }

    return result;

}
