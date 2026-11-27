/*
 * NAPL — CORE CONFIGURATION
 */

// Single external community microservice URL (Cloudflare Workers + D1 in cloudflare-community/).
// Replace with your Workers/custom domain (or set <meta name="napl-community-api" content="https://..."> in HTML).
const DEFAULT_COMMUNITY_API_BASE =
    "https://napl-community-api.federicoxastro.workers.dev";

function isLocalPreviewHost() {
    if (typeof window === "undefined") return false;
    const host = String(window.location.hostname || "").toLowerCase();
    return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".run.app")
    );
}

export function resolveCommunityApiBase() {
    if (typeof window !== "undefined") {
        if (typeof window.NAPL_COMMUNITY_API_BASE === "string" && window.NAPL_COMMUNITY_API_BASE.trim()) {
            return window.NAPL_COMMUNITY_API_BASE.trim().replace(/\/+$/, "");
        }
        if (typeof document !== "undefined") {
            const meta = document.querySelector('meta[name="napl-community-api"]');
            const content = String(meta?.getAttribute("content") || "").trim();
            if (content) {
                return content.replace(/\/+$/, "");
            }
        }
        if (isLocalPreviewHost()) {
            return "/api";
        }
    }
    return DEFAULT_COMMUNITY_API_BASE;
}

export const COMMUNITY_API_BASE = resolveCommunityApiBase();
export const RATINGS_API_BASE = `${COMMUNITY_API_BASE}/ratings`;
export const POPULARITY_API_BASE = `${COMMUNITY_API_BASE}/popularity`;
export const COMPATIBILITY_API_URL = `${COMMUNITY_API_BASE}/compatibility`;
export const REPORT_LINK_API_URL = `${COMMUNITY_API_BASE}/report-link`;
export const ADMIN_DASHBOARD_API_URL = `${COMMUNITY_API_BASE}/admin-dashboard`;

export const GITHUB_ADMIN_DEFAULTS = {
    dataRepo: "Fe2rr/NAPL-Data",
    codeRepo: "Fe2rr/Napl-prueba",
    branch: "main",
};

export function resolveCatalogApiBase() {
    if (typeof window === "undefined") return "";
    if (isLocalPreviewHost()) {
        return "";
    }
    return "static";
}

export const RATING_TOKEN_STORAGE_KEY = "napl_rating_token_v1";
export const USER_DEVICE_STORAGE_KEY = "napl_user_device_v1";
