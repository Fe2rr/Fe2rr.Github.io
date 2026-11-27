/*
 * NAPL — CORE CONFIGURATION
 */

// Community interactions are served by the single Cloudflare Worker + D1 service.
const DEFAULT_COMMUNITY_API_BASE = "https://napl-community-api.federicoxastro.workers.dev";

export function resolveCommunityApiBase() {
    if (typeof window !== "undefined") {
        const override = typeof window.NAPL_COMMUNITY_API_BASE === "string"
            ? window.NAPL_COMMUNITY_API_BASE.trim()
            : "";
        if (override) return override.replace(/\/+$/, "");
        if (typeof document !== "undefined") {
            const meta = document.querySelector('meta[name="napl-community-api"]');
            const value = String(meta?.getAttribute("content") || "").trim();
            if (value) return value.replace(/\/+$/, "");
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
    codeRepo: "Fe2rr/Fe2rr.github.io",
    branch: "main",
};

export function resolveCatalogApiBase() {
    return "static";
}

export const RATING_TOKEN_STORAGE_KEY = "napl_rating_token_v1";
export const USER_DEVICE_STORAGE_KEY = "napl_user_device_v1";
