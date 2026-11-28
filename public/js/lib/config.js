/*
 * NAPL — CORE CONFIGURATION
 */

// Dynamic community actions use the existing Supabase Edge Functions.
// Public reads are served from GitHub snapshots; Supabase is only used for writes and detailed queries.
const DEFAULT_COMMUNITY_API_BASE = "https://napl-compatibility-cache.federicoxastro.workers.dev";

export function resolveCommunityApiBase() {
    const override = typeof window !== "undefined" && typeof window.NAPL_COMMUNITY_API_BASE === "string"
        ? window.NAPL_COMMUNITY_API_BASE.trim()
        : "";
    return override ? override.replace(/\/+$/, "") : DEFAULT_COMMUNITY_API_BASE;
}

export const COMMUNITY_API_BASE = resolveCommunityApiBase();
export const RATINGS_API_BASE = `${COMMUNITY_API_BASE}/ratings`;
export const POPULARITY_API_BASE = `${COMMUNITY_API_BASE}/popularity`;
// Compatibility reads are cached at Cloudflare; community writes are forwarded to Supabase.
export const COMPATIBILITY_API_URL = `${COMMUNITY_API_BASE}/compatibility`;
export const REPORT_LINK_API_URL = `${COMMUNITY_API_BASE}/report-link`;

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
