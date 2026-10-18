
/*
 * NAPL — APPLICATION CONFIGURATION
 */


/*
 * GOOGLE SHEETS
 */

const SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";


/*
 * POPULARITY SERVICE
 */

const POPULAR_URL =
    "https://script.google.com/macros/s/AKfycbxio6DGpBJRkYdceeFVXk3gSOFcBe5KZJtHU8F2j66DDYx_G_az01p7rnsuCq0KPHY/exec";


/*
 * GENERAL ELEMENTS
 */

const gameList =
    document.getElementById("game-list");

const searchInput =
    document.getElementById("search");

const searchContainer =
    document.getElementById("search-container");

const searchButton =
    document.getElementById("search-button");

const homeButton =
    document.getElementById("home-button");


/*
 * LAST ADDED
 */

const lastAddedList =
    document.getElementById("last-added-list");

const lastAddedMore =
    document.getElementById("last-added-more");

const lastAddedSection =
    document.getElementById("last-added-section");

let showingAllLastAdded = false;


/*
 * LAST UPDATED
 */

const lastUpdatedList =
    document.getElementById("last-updated-list");

const lastUpdatedMore =
    document.getElementById("last-updated-more");

const lastUpdatedSection =
    document.getElementById("last-updated-section");

let showingAllLastUpdated = false;


/*
 * POPULAR
 */

const popularList =
    document.getElementById("popular-list");

const popularMore =
    document.getElementById("popular-more");

const popularTabs =
    document.querySelectorAll(".popular-tab");

const popularSection =
    document.getElementById("popular-section");

let selectedPopularPeriod = "week";

let showingAllPopular = false;


/*
 * STATUS
 */

const statusElement =
    document.getElementById("status");


/*
 * MENU
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

const allGamesButton =
    document.getElementById("all-games-button");


/*
 * CATEGORY CONTROLS
 */

const categoryControls =
    document.getElementById("category-controls");

const categorySearchInput =
    document.getElementById("category-search");

const categorySortOptions =
    document.querySelectorAll(".category-sort-option");

const categorySortDirection =
    document.getElementById("category-sort-direction");


/*
 * SEARCH RESULTS
 */

const searchResults =
    document.getElementById("search-results");


/*
 * GENERAL APPLICATION STATE
 */

let games = [];

let selectedPlatform = "";

let selectedCategory = "";

let currentView = "home";


/*
 * CATEGORY SORTING
 */

let selectedCategorySort = "updated";

let categorySortDescending = false;


/*
 * ALL-TIME POPULARITY CACHE
 */

let allTimePopular = new Map();

let allTimePopularLoaded = false;

let allTimePopularLoading = false;

let allTimePopularCallbacks = [];
