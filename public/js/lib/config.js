/*
 * NAPL — CORE CONFIGURATION
 */

export const RATINGS_API_BASE =
    "https://gsksanvcdbdoevairzpj.supabase.co/functions/v1/ratings";

export const COMPATIBILITY_API_URL =
    "https://gsksanvcdbdoevairzpj.supabase.co/functions/v1/compatibility";

export const REPORT_LINK_API_URL =
    "https://gsksanvcdbdoevairzpj.supabase.co/functions/v1/report-link";


export const WORKER_API_BASE =
    "https://napl-admin-api.federicoxastro.workers.dev";

export function resolveCatalogApiBase() {
    if (typeof window === "undefined") return "";
    const host = String(window.location.hostname || "").toLowerCase();
    if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".run.app")
    ) {
        return "";
    }
    return WORKER_API_BASE;
}

export const RATING_TOKEN_STORAGE_KEY = "napl_rating_token_v1";
export const USER_DEVICE_STORAGE_KEY = "napl_user_device_v1";
