/*
 * THE PORTS VAULT — DATA PROCESSING
 *
 * Reads Google Sheets CSV data and normalizes
 * game and port information for the application.
 */


/*
 * NORMALIZE COLUMN NAMES
 */



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



/*
 * FIND A COLUMN BY ITS HEADER
 *
 * Column positions do not matter.
 */



/*
 * CONVERT CSV ROWS
 */

