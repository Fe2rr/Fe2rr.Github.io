/*
 * NAPL — SHARED PORT SOURCE URL PARSERS
 *
 * Single source of truth shared across admin UI and local Express store.
 */

export const ANDROID_PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export function parseGithubRepo(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return null;
    const shorthand = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (shorthand) {
        return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/i, "") };
    }
    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        const host = url.hostname.toLowerCase();
        if (host !== "github.com" && host !== "www.github.com") return null;
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return null;
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/i, "");
        if (
            !owner ||
            !repo ||
            ["orgs", "topics", "search", "explore", "settings"].includes(owner.toLowerCase())
        ) {
            return null;
        }
        return { owner, repo };
    } catch {
        return null;
    }
}

export function normalizeGithubSlug(raw) {
    const parsed = parseGithubRepo(raw);
    return parsed ? `${parsed.owner}/${parsed.repo}` : "";
}

const GITLAB_STOP_SEGMENTS = new Set([
    "-",
    "blob",
    "tree",
    "raw",
    "commits",
    "commit",
    "releases",
    "tags",
    "issues",
    "merge_requests",
    "wikis",
    "snippets",
    "packages",
    "jobs",
    "pipelines",
    "activity",
]);

export function parseGitlabProject(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return null;
    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        const host = url.hostname.toLowerCase();
        if (host !== "gitlab.com" && host !== "www.gitlab.com") return null;
        const rawParts = url.pathname.split("/").filter(Boolean);
        const parts = [];
        for (const seg of rawParts) {
            if (GITLAB_STOP_SEGMENTS.has(seg.toLowerCase())) break;
            parts.push(seg);
        }
        if (parts.length < 2) return null;
        if (
            ["explore", "users", "dashboard", "admin", "help", "api"].includes(
                parts[0].toLowerCase()
            )
        ) {
            return null;
        }
        parts[parts.length - 1] = parts[parts.length - 1].replace(/\.git$/i, "");
        if (parts.some((p) => !p || p === "." || p === "..")) return null;
        const projectPath = parts.join("/");
        return {
            namespace: parts.slice(0, -1).join("/"),
            project: parts[parts.length - 1],
            projectPath,
        };
    } catch {
        return null;
    }
}

export function normalizeGitlabPath(raw) {
    const parsed = parseGitlabProject(raw);
    return parsed ? parsed.projectPath : "";
}

export function parsePlayStorePackage(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return null;
    if (ANDROID_PKG_RE.test(value) && !value.includes("/")) {
        return { packageId: value };
    }
    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        const host = url.hostname.toLowerCase();
        if (host !== "play.google.com") return null;
        if (!url.pathname.toLowerCase().startsWith("/store/apps/details")) return null;
        const pkg = String(url.searchParams.get("id") || "").trim();
        if (!ANDROID_PKG_RE.test(pkg)) return null;
        return { packageId: pkg };
    } catch {
        return null;
    }
}

export function normalizePlayStoreId(raw) {
    const parsed = parsePlayStorePackage(raw);
    return parsed ? parsed.packageId : "";
}

export function resolvePortSyncTarget(port) {
    if (!port) return { provider: "", target: "", githubRepo: "" };
    const url = String(port.url || "").trim();
    const link = String(port.link || "").trim();
    const dataUrl = String(port.dataUrl ?? port.data_url ?? "").trim();
    const rawProvider = String(port.syncProvider ?? port.sync_provider ?? "")
        .trim()
        .toLowerCase();
    const rawTarget = String(port.syncTarget ?? port.sync_target ?? "").trim();
    const rawGithub = String(port.githubRepo ?? port.github_repo ?? "").trim();

    for (const candidate of [url, link, dataUrl]) {
        const ps = normalizePlayStoreId(candidate);
        if (ps) return { provider: "playstore", target: ps, githubRepo: "" };
        const gl = normalizeGitlabPath(candidate);
        if (gl) return { provider: "gitlab", target: gl, githubRepo: "" };
    }

    const gh =
        normalizeGithubSlug(rawGithub) ||
        normalizeGithubSlug(url) ||
        normalizeGithubSlug(link);
    if (gh) return { provider: "github", target: gh, githubRepo: gh };

    if (rawProvider === "playstore" && ANDROID_PKG_RE.test(rawTarget)) {
        return { provider: "playstore", target: rawTarget, githubRepo: "" };
    }
    if (rawProvider === "gitlab" && rawTarget.includes("/")) {
        return { provider: "gitlab", target: rawTarget, githubRepo: "" };
    }
    if (rawProvider === "github" && normalizeGithubSlug(rawTarget)) {
        const slug = normalizeGithubSlug(rawTarget);
        return { provider: "github", target: slug, githubRepo: slug };
    }

    return { provider: "", target: "", githubRepo: "" };
}

export function looksLikeGithubUrl(value) {
    return Boolean(parseGithubRepo(value));
}

export function looksLikeGitlabUrl(value) {
    return Boolean(parseGitlabProject(value));
}

export function looksLikePlayStoreUrl(value) {
    return Boolean(parsePlayStorePackage(value));
}

export function looksLikeSyncSourceUrl(value) {
    return (
        looksLikePlayStoreUrl(value) ||
        looksLikeGitlabUrl(value) ||
        looksLikeGithubUrl(value)
    );
}
