/*
 * NAPL — GITHUB PAT ADMIN CLIENT
 *
 * Allows the static Admin SPA (napl-admin) to authenticate with a
 * Fine-grained Personal Access Token (stored only in sessionStorage),
 * read/write Fe2rr/NAPL-Data directly via the GitHub REST API using
 * atomic Git Data commits, dispatch GitHub Actions workflows for sync
 * or CORS-free metadata lookup, and query the single community server's
 * /admin-dashboard endpoint.
 */

import { ADMIN_DASHBOARD_API_URL } from "./config.js";

const PAT_SESSION_KEY = "napl_github_pat_v1";
const REPO_CFG_SESSION_KEY = "napl_github_repo_cfg_v1";

export const DEFAULT_GITHUB_ADMIN_CONFIG = {
    dataRepo: "Fe2rr/NAPL-Data",
    codeRepo: "Fe2rr/Fe2rr.github.io",
    branch: "main",
    syncWorkflow: "sync-catalog.yml",
    lookupWorkflow: "lookup-metadata.yml",
    deployWorkflow: "deploy-pages.yml",
};

function getSessionConfig() {
    try {
        const raw = sessionStorage.getItem(REPO_CFG_SESSION_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                return { ...DEFAULT_GITHUB_ADMIN_CONFIG, ...parsed };
            }
        }
    } catch {
        // Ignore sessionStorage errors
    }
    return { ...DEFAULT_GITHUB_ADMIN_CONFIG };
}

export function getStoredGithubPat() {
    try {
        return sessionStorage.getItem(PAT_SESSION_KEY) || "";
    } catch {
        return "";
    }
}

export function clearGithubSession() {
    try {
        sessionStorage.removeItem(PAT_SESSION_KEY);
        sessionStorage.removeItem(REPO_CFG_SESSION_KEY);
    } catch {
        // Ignore
    }
}

function saveGithubSession(pat, configPatch = {}) {
    try {
        sessionStorage.setItem(PAT_SESSION_KEY, pat);
        if (Object.keys(configPatch).length > 0) {
            const nextCfg = { ...getSessionConfig(), ...configPatch };
            sessionStorage.setItem(REPO_CFG_SESSION_KEY, JSON.stringify(nextCfg));
        }
    } catch {
        // PAT remains passed explicitly if storage is blocked
    }
}

function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(String(str));
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

async function githubApi(path, { pat, method = "GET", headers = {}, body, raw = false } = {}) {
    const token = pat || getStoredGithubPat();
    if (!token) {
        throw new Error("Sesión GitHub no iniciada. Ingresá tu Fine-grained PAT.");
    }

    const reqHeaders = {
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
        ...headers,
    };
    if (body !== undefined && !reqHeaders["Content-Type"]) {
        reqHeaders["Content-Type"] = "application/json";
    }

    const response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
        cache: "no-store",
    });

    const text = await response.text();
    if (raw) {
        if (!response.ok) {
            let msg = `GitHub HTTP ${response.status}`;
            try {
                const errJson = JSON.parse(text);
                if (errJson?.message) msg = errJson.message;
            } catch {
                // Keep HTTP message
            }
            throw new Error(msg);
        }
        return { response, text };
    }

    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = {};
    }

    if (!response.ok) {
        throw new Error(data?.message || `GitHub HTTP ${response.status}`);
    }

    return { response, data };
}

export function buildPublicCatalogProjection(catalog) {
    return {
        version: Number(catalog?.version) || 1,
        updatedAt: catalog?.updatedAt || new Date().toISOString(),
        platformOrder: Array.isArray(catalog?.platformOrder) ? catalog.platformOrder : [],
        games: (catalog?.games || []).map((game) => ({
            name: game.name,
            slug: game.slug,
            year: game.year || "",
            coverUrl: game.coverUrl || "",
            genre: game.genre || "",
            description: game.description || "",
            platform: game.platform || "",
            ...(game.launchboxUrl ? { launchboxUrl: game.launchboxUrl } : {}),
            ...(game.steamUrl ? { steamUrl: game.steamUrl } : {}),
            ports: (game.ports || []).map((port) => {
                const publicPort = {
                    portId: port.portId,
                    project: port.project || "",
                    developer: port.developer || "",
                    year: port.year || "",
                    version: port.version || "",
                    controller: port.controller || "",
                    files: port.files || "",
                    works: port.works || "",
                    link: port.link || "",
                    url: port.url || "",
                    dataUrl: port.dataUrl || "",
                    lastUpdate: port.lastUpdate || "",
                    dateAdded: port.dateAdded || "",
                    notes: port.notes || "",
                };
                if (port.githubRepo) publicPort.githubRepo = port.githubRepo;
                return publicPort;
            }),
        })),
    };
}

export async function loginWithGithubPat(rawPat, configOverrides = {}) {
    const pat = String(rawPat || "").trim();
    if (!pat) {
        throw new Error("Ingresá un GitHub Fine-grained PAT válido.");
    }

    const cfg = { ...getSessionConfig(), ...configOverrides };
    const { data: repo } = await githubApi(`/repos/${cfg.dataRepo}`, { pat });

    if (!repo?.permissions?.push && !repo?.permissions?.admin) {
        throw new Error(
            `El token no tiene permisos de escritura (Contents: Read and write) sobre ${cfg.dataRepo}.`
        );
    }

    // The same PAT must be able to dispatch the GitHub Actions workflows
    // in the code repository. Listing workflows verifies repository access;
    // dispatch itself will enforce the Actions: Read and write permission.
    await githubApi(`/repos/${cfg.codeRepo}`, { pat });
    const { data: workflows } = await githubApi(
        `/repos/${cfg.codeRepo}/actions/workflows?per_page=100`,
        { pat }
    );
    const available = new Set((workflows?.workflows || []).flatMap((item) => [
        item.name || "",
        item.path?.split("/").pop() || "",
        item.path || "",
    ]));
    const required = [cfg.syncWorkflow, cfg.lookupWorkflow, cfg.deployWorkflow];
    const missing = required.filter((name) => !available.has(name) && !available.has(`.github/workflows/${name}`));
    if (missing.length) {
        throw new Error(`No se pudieron verificar estos workflows en ${cfg.codeRepo}: ${missing.join(", ")}.`);
    }

    let user = null;
    try {
        const userRes = await githubApi("/user", { pat });
        user = {
            login: userRes.data?.login || "",
            avatarUrl: userRes.data?.avatar_url || "",
        };
    } catch {
        // Fine-grained PATs scoped only to repositories may not include user:read
        user = { login: repo?.owner?.login || "admin", avatarUrl: "" };
    }

    saveGithubSession(pat, cfg);
    return {
        authenticated: true,
        dataRepo: cfg.dataRepo,
        codeRepo: cfg.codeRepo,
        branch: cfg.branch,
        permissions: repo.permissions,
        user,
    };
}

export async function readAdminCatalogState(configOverrides = {}) {
    const cfg = { ...getSessionConfig(), ...configOverrides };
    const { response, text } = await githubApi(
        `/repos/${cfg.dataRepo}/contents/private/catalog-state.json?ref=${encodeURIComponent(cfg.branch)}`,
        { raw: true }
    );
    const parsed = JSON.parse(text);
    const etag = String(response.headers.get("etag") || "");
    const shaMatch = etag.match(/"([a-f0-9]{40})"/i);
    return {
        state: parsed,
        sha: shaMatch ? shaMatch[1] : "",
        config: cfg,
    };
}

export async function saveAndPublishCatalogState(
    nextState,
    {
        message = "NAPL Admin: update catalog state and publish public JSON",
        publishPublic = true,
        pat,
        configOverrides = {},
    } = {}
) {
    const cfg = { ...getSessionConfig(), ...configOverrides };
    const token = pat || getStoredGithubPat();
    const stateToSave = {
        ...nextState,
        catalog: {
            ...(nextState?.catalog || {}),
            updatedAt: new Date().toISOString(),
        },
    };

    const { data: refData } = await githubApi(
        `/repos/${cfg.dataRepo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`,
        { pat: token }
    );
    const parentCommitSha = refData?.object?.sha;
    if (!parentCommitSha) {
        throw new Error("No se pudo resolver la rama de destino en GitHub.");
    }

    const { data: parentCommit } = await githubApi(
        `/repos/${cfg.dataRepo}/git/commits/${parentCommitSha}`,
        { pat: token }
    );
    const baseTreeSha = parentCommit?.tree?.sha;

    const treeItems = [];

    const { data: stateBlob } = await githubApi(
        `/repos/${cfg.dataRepo}/git/blobs`,
        {
            pat: token,
            method: "POST",
            body: {
                content: utf8ToBase64(JSON.stringify(stateToSave, null, 2) + "\n"),
                encoding: "base64",
            },
        }
    );
    treeItems.push({
        path: "private/catalog-state.json",
        mode: "100644",
        type: "blob",
        sha: stateBlob.sha,
    });

    if (publishPublic) {
        const publicDoc = buildPublicCatalogProjection(stateToSave.catalog);
        const { data: publicBlob } = await githubApi(
            `/repos/${cfg.dataRepo}/git/blobs`,
            {
                pat: token,
                method: "POST",
                body: {
                    content: utf8ToBase64(JSON.stringify(publicDoc) + "\n"),
                    encoding: "base64",
                },
            }
        );
        treeItems.push({
            path: "public/assets/data/catalog.json",
            mode: "100644",
            type: "blob",
            sha: publicBlob.sha,
        });
    }

    const { data: newTree } = await githubApi(
        `/repos/${cfg.dataRepo}/git/trees`,
        {
            pat: token,
            method: "POST",
            body: {
                base_tree: baseTreeSha,
                tree: treeItems,
            },
        }
    );

    const { data: newCommit } = await githubApi(
        `/repos/${cfg.dataRepo}/git/commits`,
        {
            pat: token,
            method: "POST",
            body: {
                message,
                tree: newTree.sha,
                parents: [parentCommitSha],
            },
        }
    );

    await githubApi(
        `/repos/${cfg.dataRepo}/git/refs/heads/${encodeURIComponent(cfg.branch)}`,
        {
            pat: token,
            method: "PATCH",
            body: { sha: newCommit.sha, force: false },
        }
    );

    return {
        success: true,
        commitSha: newCommit.sha,
        state: stateToSave,
    };
}

export async function dispatchWorkflowAndWait(
    workflowFile,
    inputs = {},
    {
        pollIntervalMs = 3000,
        timeoutMs = 300_000,
        onProgress,
        pat,
        configOverrides = {},
    } = {}
) {
    const cfg = { ...getSessionConfig(), ...configOverrides };
    const token = pat || getStoredGithubPat();
    const dispatchedAt = Date.now() - 2000;

    await githubApi(
        `/repos/${cfg.codeRepo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
        {
            pat: token,
            method: "POST",
            body: {
                ref: cfg.branch,
                inputs,
            },
        }
    );

    let matchedRun = null;
    while (Date.now() - dispatchedAt < timeoutMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));

        const { data } = await githubApi(
            `/repos/${cfg.codeRepo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?event=workflow_dispatch&per_page=8`,
            { pat: token }
        );

        const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
        if (!matchedRun) {
            matchedRun = runs.find(
                (r) => Date.parse(r.created_at || "") >= dispatchedAt
            );
        } else {
            matchedRun =
                runs.find((r) => r.id === matchedRun.id) || matchedRun;
        }

        if (matchedRun) {
            if (typeof onProgress === "function") {
                onProgress({
                    id: matchedRun.id,
                    status: matchedRun.status,
                    conclusion: matchedRun.conclusion,
                    htmlUrl: matchedRun.html_url,
                });
            }
            if (matchedRun.status === "completed") {
                if (matchedRun.conclusion !== "success") {
                    throw new Error(
                        `El workflow ${workflowFile} terminó con estado: ${matchedRun.conclusion || "failed"}.`
                    );
                }
                return matchedRun;
            }
        }
    }

    throw new Error(`Tiempo de espera agotado esperando ${workflowFile}.`);
}

export async function runGithubLookup(mode, url, options = {}) {
    const cfg = { ...getSessionConfig(), ...options.configOverrides };
    const pat = options.pat || getStoredGithubPat();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await dispatchWorkflowAndWait(
        cfg.lookupWorkflow,
        {
            mode: String(mode || "").trim(),
            url: String(url || "").trim(),
            request_id: requestId,
        },
        { ...options, pat, configOverrides: cfg }
    );

    const { text } = await githubApi(
        `/repos/${cfg.dataRepo}/contents/private/lookup-results/${requestId}.json?ref=${encodeURIComponent(cfg.branch)}`,
        { pat, raw: true }
    );
    const result = JSON.parse(text);
    if (!result?.ok) {
        throw new Error(result?.error || "La consulta en GitHub Actions falló.");
    }
    return result.data;
}

export async function triggerCatalogSync({
    importSheets = false,
    optimizeCovers = true,
    ...options
} = {}) {
    const cfg = { ...getSessionConfig(), ...options.configOverrides };
    return dispatchWorkflowAndWait(
        cfg.syncWorkflow,
        {
            import_sheets: importSheets ? "true" : "false",
            optimize_covers: optimizeCovers ? "true" : "false",
        },
        options
    );
}

export async function fetchCommunityAdminDashboard({ pat } = {}) {
    const token = pat || getStoredGithubPat();
    if (!token) {
        throw new Error("Sesión GitHub requerida para consultar el dashboard.");
    }

    const response = await fetch(ADMIN_DASHBOARD_API_URL, {
        method: "GET",
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) {
        throw new Error(
            data?.error || `Dashboard API HTTP ${response.status}`
        );
    }
    return data;
}
