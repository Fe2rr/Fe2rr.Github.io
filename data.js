/*
 * Normalize column names.
 */

function normalizeHeader(value) {

return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

}

/*
 * Normalize text.
 */

function normalizeText(value) {

return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

}

/*
 * Create game slug.
 */

function createSlug(name) {

return normalizeText(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

}

/*
 * CSV parser.
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
                value =>
                    value.trim() !== ""
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
            value =>
                value.trim() !== ""
        )
    ) {

        rows.push(row);
    }
}


if (rows.length === 0) {

    return [];
}


const headers =
    rows.shift().map(
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
 * Find a column.
 */

function getColumn(
row,
possibleNames
) {

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
 * Convert CSV rows.
 */

function processRows(rows) {

let currentGame = "";

let currentYear = "";

const result = [];


for (const row of rows) {

    const gameValue =
        getColumn(row, [
            "GAME",
            "GAME NAME",
            "NAME",
            "JUEGO"
        ]).trim();


    const yearValue =
        getColumn(row, [
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


    const platform =
        getColumn(row, [
            "PLATFORM",
            "PLATAFORM",
            "PLATAFORMA"
        ]).trim();


    const project =
        getColumn(row, [
            "PROJECT",
            "PROYECTO"
        ]);


    const link =
        getColumn(row, [
            "LINK",
            "PROJECT LINK",
            "ENLACE"
        ]);


    const url =
        getColumn(row, [
            "URL"
        ]);


    const developer =
        getColumn(row, [
            "DEVELOPER",
            "DEVELOPER/PUBLISHER",
            "DESARROLLADOR"
        ]);


    const version =
        getColumn(row, [
            "VERSION",
            "VERSIÓN"
        ]);


    const controller =
        getColumn(row, [
            "CONTROLLER SUPPORT",
            "CONTROLLER",
            "GAMEPAD",
            "MANDO"
        ]);


    const files =
        getColumn(row, [
            "NEEDS GAME FILES?",
            "NEEDS GAME FILES",
            "GAME FILES",
            "NECESITA ARCHIVOS"
        ]);


    const works =
        getColumn(row, [
            "WORKS?",
            "WORKS",
            "FUNCIONA"
        ]);


    const lastUpdate =
        getColumn(row, [
            "LAST UPDATE",
            "LAST UPDATED",
            "ÚLTIMA ACTUALIZACIÓN"
        ]);


    const notes =
        getColumn(row, [
            "NOTES",
            "NOTE",
            "NOTAS"
        ]);


    const hasPortData =
        project ||
        link ||
        url ||
        developer ||
        version ||
        controller ||
        files ||
        works ||
        lastUpdate ||
        notes;


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

        developer: developer.trim(),

        version: version.trim(),

        controller: controller.trim(),

        files: files.trim(),

        works: works.trim(),

        lastUpdate: lastUpdate.trim(),

        notes: notes.trim()

    });
}


return result;

}
