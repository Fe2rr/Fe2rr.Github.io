/*
 * Show Home sections.
 */

function showHomeSections() {

    lastUpdatedSection.hidden = false;

    popularSection.hidden = false;

    categoryControls.hidden = true;

}

/*
 * Show Category view.
 */

function showCategoryView() {

    lastUpdatedSection.hidden = true;

    popularSection.hidden = true;

    categoryControls.hidden = false;

}

/*
 * Update category sort direction arrow.
 */

function updateCategorySortDirection() {

    categorySortDirection.textContent =
        categorySortDescending
            ? "↑"
            : "↓";

}

/*
 * Sort games.
 */

function sortGames(list) {

    const sorted =
        [...list];


    switch (selectedCategorySort) {

        case "updated":

            sorted.sort(
                (a, b) => {

                    const dateA =
                        getLatestUpdate(a);

                    const dateB =
                        getLatestUpdate(b);


                    if (!dateA && !dateB) {

                        return 0;
                    }

                    if (!dateA) {

                        return 1;
                    }

                    if (!dateB) {

                        return -1;
                    }


                    const result =
                        dateB - dateA;


                    return categorySortDescending
                        ? -result
                        : result;
                }
            );

            break;


        case "name":

            sorted.sort(
                (a, b) => {

                    const result =
                        a.name.localeCompare(
                            b.name,
                            "en",
                            {
                                sensitivity: "base"
                            }
                        );


                    return categorySortDescending
                        ? -result
                        : result;
                }
            );

            break;


        case "popular":

            sorted.sort(
                (a, b) => {

                    const visitsA =
                        allTimePopular.get(
                            a.slug
                        ) || 0;

                    const visitsB =
                        allTimePopular.get(
                            b.slug
                        ) || 0;


                    const result =
                        visitsB - visitsA;


                    if (result !== 0) {

                        return categorySortDescending
                            ? -result
                            : result;
                    }


                    return a.name.localeCompare(
                        b.name,
                        "en",
                        {
                            sensitivity: "base"
                        }
                    );
                }
            );

            break;
    }


    return sorted;

}

/*
 * Reset category controls.
 */

function resetCategoryControls() {

    categorySearchInput.value = "";

    selectedCategorySort = "updated";

    categorySortDescending = false;


    categorySortOptions.forEach(
        option => {

            option.classList.toggle(
                "active",
                option.dataset.sort ===
                    selectedCategorySort
            );
        }
    );


    updateCategorySortDirection();

}

/*
 * Display filtered games.
 */

function displayFilteredGames() {

    const query =
        normalizeText(
            categorySearchInput.value
        );


    /*
     * Multi-game Apps uses PROJECT names
     * instead of individual games.
     */

    if (
        selectedCategory ===
        "multi-game-apps"
    ) {

        const multiGameApps =
            getMultiGameApps();


        const filteredApps =
            multiGameApps.filter(
                app =>
                    !query ||
                    normalizeText(
                        app.name
                    ).includes(query)
            );


        if (query) {

            filteredApps.sort(
                (a, b) => {

                    const nameA =
                        normalizeText(a.name);

                    const nameB =
                        normalizeText(b.name);


                    const startsA =
                        nameA.startsWith(query);

                    const startsB =
                        nameB.startsWith(query);


                    if (
                        startsA &&
                        !startsB
                    ) {

                        return -1;
                    }


                    if (
                        !startsA &&
                        startsB
                    ) {

                        return 1;
                    }


                    return nameA.localeCompare(
                        nameB,
                        "en",
                        {
                            sensitivity: "base"
                        }
                    );
                }
            );


            displayMultiGameApps(
                filteredApps
            );

            return;
        }


        if (
            selectedCategorySort ===
            "popular"
        ) {

            loadAllTimePopular(
                () => {

                    const updatedApps =
                        getMultiGameApps();


                    displayMultiGameApps(
                        sortMultiGameApps(
                            updatedApps
                        )
                    );
                }
            );

            return;
        }


        displayMultiGameApps(
            sortMultiGameApps(
                filteredApps
            )
        );

        return;
    }


    const filtered =
        games.filter(game => {

            if (
                selectedCategory ===
                "dual-screen" &&
                !isDualScreen(game)
            ) {

                return false;
            }


            if (
                selectedPlatform &&
                !game.platforms.some(
                    platform =>
                        normalizeText(platform) ===
                        normalizeText(selectedPlatform)
                )
            ) {

                return false;
            }


            if (!query) {

                return true;
            }


            return normalizeText(
                game.name
            ).includes(query);
        });


    if (query) {

        filtered.sort(
            (a, b) => {

                const nameA =
                    normalizeText(a.name);

                const nameB =
                    normalizeText(b.name);


                const startsA =
                    nameA.startsWith(query);

                const startsB =
                    nameB.startsWith(query);


                if (
                    startsA &&
                    !startsB
                ) {

                    return -1;
                }


                if (
                    !startsA &&
                    startsB
                ) {

                    return 1;
                }


                return nameA.localeCompare(
                    nameB,
                    "en",
                    {
                        sensitivity: "base"
                    }
                );
            }
        );
    }


    if (
        selectedCategorySort ===
        "popular"
    ) {

        loadAllTimePopular(
            () => {

                displayGames(
                    query
                        ? filtered
                        : sortGames(filtered)
                );
            }
        );

        return;
    }


    displayGames(
        query
            ? filtered
            : sortGames(filtered)
    );

}

/*
 * Category search.
 */

categorySearchInput.addEventListener(
    "input",
    displayFilteredGames
);

/*
 * Category sort options.
 */

categorySortOptions.forEach(
    option => {

        option.addEventListener(
            "click",
            () => {

                const newSort =
                    option.dataset.sort;


                if (
                    selectedCategorySort ===
                    newSort
                ) {

                    return;
                }


                selectedCategorySort =
                    newSort;

                categorySortDescending =
                    false;


                categorySortOptions.forEach(
                    otherOption => {

                        otherOption.classList.toggle(
                            "active",
                            otherOption.dataset.sort ===
                                selectedCategorySort
                        );
                    }
                );


                updateCategorySortDirection();

                displayFilteredGames();
            }
        );
    }

);

/*
 * Category sort direction.
 */

categorySortDirection.addEventListener(
    "click",
    () => {

        categorySortDescending =
            !categorySortDescending;


        updateCategorySortDirection();


        displayFilteredGames();
    }

);
