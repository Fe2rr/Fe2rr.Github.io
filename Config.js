/*
 * GOOGLE SHEETS
 */

const SHEET_URL =
"https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";

/*
 * POPULAR
 */

const POPULAR_URL =
"https://script.google.com/macros/s/AKfycbxio6DGpBJRkYdceeFVXk3gSOFcBe5KZJtHU8F2j66DDYx_G_az01p7rnsuCq0KPHY/exec";

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

const lastUpdatedList =
document.getElementById("last-updated-list");

const lastUpdatedMore =
document.getElementById("last-updated-more");

const popularList =
document.getElementById("popular-list");

const popularMore =
document.getElementById("popular-more");

const popularTabs =
document.querySelectorAll(".popular-tab");

const statusElement =
document.getElementById("status");

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

const categoryControls =
document.getElementById("category-controls");

const categorySearchInput =
document.getElementById("category-search");

const categorySortOptions =
document.querySelectorAll(".category-sort-option");

const categorySortDirection =
document.getElementById(
    "category-sort-direction"
);

const lastUpdatedSection =
document.getElementById("last-updated-section");

const popularSection =
document.getElementById("popular-section");

const searchResults =
document.getElementById("search-results");

let games = [];

let selectedPlatform = "";

let selectedCategory = "";

let currentView = "home";

let showingAllLastUpdated = false;

let selectedPopularPeriod = "week";

let showingAllPopular = false;

/*
 * Category sorting.
 */

let selectedCategorySort =
"updated";

let categorySortDescending =
false;

/*
 * All Time Popular cache.
 */

let allTimePopular =
new Map();

let allTimePopularLoaded =
false;

let allTimePopularLoading =
false;

let allTimePopularCallbacks =
[];
