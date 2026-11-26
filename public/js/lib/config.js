/*
 * NAPL — CORE CONFIGURATION
 */

const SUPABASE_FUNCTIONS_BASE = "https://gsksanvcdbdoevairzpj.supabase.co/functions/v1";
function usesVercelApi() {
    if (typeof window === "undefined") return false;
    const host = String(window.location.hostname || "").toLowerCase();
    return host.endsWith(".vercel.app") || host === "napl.app" || host === "www.napl.app";
}
const COMMUNITY_API_BASE = usesVercelApi() ? "/api" : SUPABASE_FUNCTIONS_BASE;
export const RATINGS_API_BASE = `${COMMUNITY_API_BASE}/ratings`;
export const POPULARITY_API_BASE = `${COMMUNITY_API_BASE}/popularity`;
export const COMPATIBILITY_API_URL = `${COMMUNITY_API_BASE}/compatibility`;
export const REPORT_LINK_API_URL = `${COMMUNITY_API_BASE}/report-link`;

export const WORKER_API_BASE =
    "https://napl-admin-api.federicoxastro.workers.dev";

export function resolveCatalogApiBase() {
    if (typeof window === "undefined") return "";
    const host = String(window.location.hostname || "").toLowerCase();
    if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".run.app") ||
        host.endsWith(".vercel.app") ||
        host === "napl.app" ||
        host === "www.napl.app"
    ) {
        return "";
    }
    return WORKER_API_BASE;
}

export const RATING_TOKEN_STORAGE_KEY = "napl_rating_token_v1";
export const USER_DEVICE_STORAGE_KEY = "napl_user_device_v1";
