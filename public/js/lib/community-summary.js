/*
 * NAPL — STATIC COMMUNITY SUMMARY LOADER
 *
 * Reads the pre-aggregated snapshot bundled from Fe2rr/NAPL-Data by GitHub Actions.
 * Passive visits trigger zero Supabase or Cloudflare calls and zero database reads.
 */

const SUMMARY_TTL_MS = 15 * 60 * 1000;

let cachedSummary = null;
let cachedAt = 0;
let summaryPromise = null;

function resolveSummaryUrl() {
    return new URL(
        "../../assets/data/community-summary.json",
        import.meta.url
    ).toString();
}

export async function loadCommunitySummary(forceRefresh = false) {
    if (
        !forceRefresh &&
        cachedSummary &&
        Date.now() - cachedAt < SUMMARY_TTL_MS
    ) {
        return cachedSummary;
    }

    if (!forceRefresh && summaryPromise) {
        return summaryPromise;
    }

    const request = (async () => {
        try {
            const response = await fetch(resolveSummaryUrl(), {
                method: "GET",
                cache: forceRefresh ? "no-store" : "default",
            });
            if (!response.ok) return null;

            const data = await response.json();
            if (
                !data ||
                typeof data !== "object" ||
                !data.ratings ||
                !data.popularity
            ) {
                return null;
            }

            cachedSummary = data;
            cachedAt = Date.now();
            return cachedSummary;
        } catch {
            return cachedSummary;
        } finally {
            if (summaryPromise === request) {
                summaryPromise = null;
            }
        }
    })();

    summaryPromise = request;
    return request;
}
