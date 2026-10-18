

function groupGameRows(rows) {
    const grouped = new Map();

    let currentGame = "";
    let currentYear = "";

    for (const row of rows) {
        const gameValue = getGameColumn(row, [
            "GAME",
            "GAME NAME",
            "NAME",
            "JUEGO"
        ]);

        const yearValue = getGameColumn(row, [
            "YEAR",
            "AÑO",
            "ANO"
        ]);

        if (gameValue) {
            currentGame = gameValue;
        }

        if (yearValue) {
            currentYear = yearValue;
        }

        if (!currentGame) {
            continue;
        }

        const key = createSlug(currentGame);

        if (!key) {
            continue;
        }

        const platform = getGameColumn(row, [
            "PLATFORM",
            "PLATAFORM",
            "PLATAFORMA"
        ]);

        const project = getGameColumn(row, [
            "PROJECT",
            "PROYECTO"
        ]);

        const link = getGameColumn(row, [
            "LINK",
            "PROJECT LINK",
            "ENLACE"
        ]);

        const url = getGameColumn(row, [
            "URL",
            "PORT URL",
            "PORT LINK"
        ]);

        const dataUrl = getGameColumn(row, [
            "DATA URL",
            "DATA LINK",
            "GAME FILES URL"
        ]);

        const developer = getGameColumn(row, [
            "DEVELOPER",
            "DEVELOPER/PUBLISHER",
            "DESARROLLADOR"
        ]);

        const version = getGameColumn(row, [
            "VERSION",
            "VERSIÓN"
        ]);

        const controller = getGameColumn(row, [
            "CONTROLLER SUPPORT",
            "CONTROLLER",
            "GAMEPAD",
            "MANDO"
        ]);

        const files = getGameColumn(row, [
            "NEEDS GAME FILES?",
            "NEEDS GAME FILES",
            "GAME FILES",
            "NECESITA ARCHIVOS"
        ]);

        const works = getGameColumn(row, [
            "WORKS?",
            "WORKS",
            "FUNCIONA"
        ]);

        const lastUpdate = getGameColumn(row, [
            "LAST UPDATE",
            "LAST UPDATED",
            "ÚLTIMA ACTUALIZACIÓN"
        ]);

        const notes = getGameColumn(row, [
            "NOTES",
            "NOTE",
            "NOTAS"
        ]);

        // Información general del juego.
        // COVER_URL se reconoce con su guion bajo original.
        const coverUrl = getGameColumn(row, [
            "COVER_URL",
            "COVER URL",
            "COVER",
            "COVER IMAGE",
            "IMAGE URL",
            "PORTADA"
        ]);

        const genre = getGameColumn(row, [
            "GENRE",
            "GÉNERO",
            "GENERO"
        ]);

        const description = getGameColumn(row, [
            "DESCRIPTION",
            "DESCRIPCIÓN",
            "DESCRIPCION"
        ]);

        // Crear el juego aunque esta fila solo contenga
        // portada, género, descripción o año.
        if (!grouped.has(key)) {
            grouped.set(key, {
                name: currentGame,
                slug: key,
                year: currentYear,
                genre: "",
                description: "",
                coverUrl: "",
                ports: [],
                platforms: []
            });
        }

        const game = grouped.get(key);

        // Completar únicamente los datos que falten.
        if (!game.year && currentYear) {
            game.year = currentYear;
        }

        if (!game.genre && genre) {
            game.genre = genre;
        }

        if (!game.description && description) {
            game.description = description;
        }

        if (!game.coverUrl && coverUrl) {
            game.coverUrl = coverUrl;
        }

        if (
            platform &&
            !game.platforms.includes(platform)
        ) {
            game.platforms.push(platform);
        }

        // Una fila sin datos de port no debe generar
        // una tarjeta vacía en la sección de ports.
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
            notes
        ].some(value => String(value || "").trim() !== "");

        if (!hasPortData) {
            continue;
        }

        game.ports.push({
            game: currentGame,
            year: currentYear,
            platform,
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
            notes
        });
    }

    return Array.from(grouped.values());
}
