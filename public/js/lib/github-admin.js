/*
 * NAPL — GITHUB PAT ADMIN CLIENT
 *
 * Allows the static Admin SPA (napl-admin) to authenticate with a
 * Fine-grained Personal Access Token (stored locally in this browser),
 * read/write Fe2rr/NAPL-Data directly via the GitHub REST API using
 * atomic Git Data commits, dispatch GitHub Actions workflows for sync,
 * metadata lookup, or community summary refresh, and manage community
 * snapshots & link reports stored in GitHub without Cloudflare.
 */

const LEGACY_PAT_SESSION_KEY = "napl_github_pat_v1";
const VAULT_STORAGE_KEY = "napl_github_vault_v1";
const REPO_CFG_SESSION_KEY = "napl_github_repo_cfg_v1";
const VAULT_KDF_ITERATIONS = 600_000;

let memoryGithubPat = "";
const blobTextCache = new Map();
const BLOB_TEXT_CACHE_MAX = 8;

function setCachedBlobText(cacheKey, text) {
    if (!cacheKey || typeof text !== "string") return;
    if (blobTextCache.size >= BLOB_TEXT_CACHE_MAX) {
        const oldestKey = blobTextCache.keys().next().value;
        if (oldestKey) blobTextCache.delete(oldestKey);
    }
    blobTextCache.set(cacheKey, text);
}

export const DEFAULT_GITHUB_ADMIN_CONFIG = {
    dataRepo: "Fe2rr/NAPL-Data",
    codeRepo: "Fe2rr/Fe2rr.github.io",
    branch: "main",
    syncWorkflow: "sync-catalog.yml",
    lookupWorkflow: "lookup-metadata.yml",
    deployWorkflow: "deploy-pages.yml",
    communitySyncWorkflow: "sync-community-summary.yml",
};

function getSessionConfig() {
    try {
        if (typeof sessionStorage === "undefined") return { ...DEFAULT_GITHUB_ADMIN_CONFIG };
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

function getLegacyPlaintextPat() {
    try {
        if (typeof localStorage !== "undefined") {
            const persistent = localStorage.getItem(LEGACY_PAT_SESSION_KEY);
            if (persistent) return persistent.trim();
        }
    } catch {
        // Ignore localStorage errors
    }
    try {
        if (typeof sessionStorage !== "undefined") {
            return (sessionStorage.getItem(LEGACY_PAT_SESSION_KEY) || "").trim();
        }
    } catch {
        // Ignore sessionStorage errors
    }
    return "";
}

function clearLegacyPlaintextPat() {
    try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(LEGACY_PAT_SESSION_KEY);
    } catch {
        // Ignore
    }
    try {
        if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(LEGACY_PAT_SESSION_KEY);
    } catch {
        // Ignore
    }
}

export function hasLegacyPlaintextPat() {
    return Boolean(getLegacyPlaintextPat());
}

function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(String(base64 || "").trim());
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

function utf8ToBase64(str) {
    return bytesToBase64(new TextEncoder().encode(String(str)));
}

function readStoredVaultObject() {
    try {
        if (typeof localStorage === "undefined") return null;
        const raw = localStorage.getItem(VAULT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
            parsed &&
            parsed.v === 1 &&
            typeof parsed.salt === "string" &&
            typeof parsed.iv === "string" &&
            typeof parsed.ct === "string"
        ) {
            return parsed;
        }
    } catch {
        // Ignore malformed vault JSON
    }
    return null;
}

export function hasEncryptedGithubVault() {
    return Boolean(readStoredVaultObject());
}

export function exportEncryptedGithubVault() {
    const vault = readStoredVaultObject();
    if (!vault) {
        throw new Error("Todavía no hay una bóveda cifrada guardada en este navegador.");
    }
    return JSON.stringify(vault);
}

export function importEncryptedGithubVault(rawVaultJson) {
    let parsed;
    try {
        parsed = JSON.parse(String(rawVaultJson || "").trim());
    } catch {
        throw new Error("El formato de la bóveda cifrada no es válido.");
    }
    if (
        !parsed ||
        parsed.v !== 1 ||
        typeof parsed.salt !== "string" ||
        typeof parsed.iv !== "string" ||
        typeof parsed.ct !== "string" ||
        !parsed.salt ||
        !parsed.iv ||
        !parsed.ct
    ) {
        throw new Error("La bóveda cifrada está incompleta o corrupta.");
    }
    // Validate base64 fields before persisting
    base64ToBytes(parsed.salt);
    base64ToBytes(parsed.iv);
    base64ToBytes(parsed.ct);

    const normalized = {
        v: 1,
        kdf: "PBKDF2-SHA256",
        iter: Number(parsed.iter) >= 100_000 ? Number(parsed.iter) : VAULT_KDF_ITERATIONS,
        salt: parsed.salt,
        iv: parsed.iv,
        ct: parsed.ct,
    };
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(normalized));
    }
    clearLegacyPlaintextPat();
    return normalized;
}

async function deriveVaultKey(password, saltBytes, iterations = VAULT_KDF_ITERATIONS) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error("Este navegador o contexto no soporta cifrado WebCrypto (requiere HTTPS o localhost).");
    }
    const baseKey = await subtle.importKey(
        "raw",
        new TextEncoder().encode(String(password || "")),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations,
            hash: "SHA-256",
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptPatWithPassword(pat, password) {
    const cleanPassword = String(password || "");
    if (cleanPassword.length < 8) {
        throw new Error("La contraseña debe tener al menos 8 caracteres.");
    }
    const cleanPat = String(pat || "").trim();
    if (!cleanPat) {
        throw new Error("Ingresá un GitHub Fine-grained PAT válido.");
    }
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveVaultKey(cleanPassword, salt, VAULT_KDF_ITERATIONS);
    const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(cleanPat)
    );
    return {
        v: 1,
        kdf: "PBKDF2-SHA256",
        iter: VAULT_KDF_ITERATIONS,
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        ct: bytesToBase64(new Uint8Array(ciphertext)),
    };
}

async function decryptPatWithPassword(vault, password) {
    const cleanPassword = String(password || "");
    if (!cleanPassword) {
        throw new Error("Ingresá tu contraseña.");
    }
    const salt = base64ToBytes(vault.salt);
    const iv = base64ToBytes(vault.iv);
    const ct = base64ToBytes(vault.ct);
    const iterations = Number(vault.iter) >= 100_000 ? Number(vault.iter) : VAULT_KDF_ITERATIONS;
    const key = await deriveVaultKey(cleanPassword, salt, iterations);
    try {
        const plaintext = await globalThis.crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            ct
        );
        return new TextDecoder().decode(plaintext).trim();
    } catch {
        throw new Error("Contraseña incorrecta.");
    }
}

export function getStoredGithubPat() {
    return memoryGithubPat;
}

export function lockGithubSession() {
    memoryGithubPat = "";
    blobTextCache.clear();
    try {
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.removeItem(REPO_CFG_SESSION_KEY);
        }
    } catch {
        // Ignore
    }
}

export function clearEncryptedGithubVault() {
    memoryGithubPat = "";
    clearLegacyPlaintextPat();
    try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(VAULT_STORAGE_KEY);
        if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(REPO_CFG_SESSION_KEY);
    } catch {
        // Ignore
    }
}

export function clearGithubSession({ forgetVault = false } = {}) {
    lockGithubSession();
    clearLegacyPlaintextPat();
    if (forgetVault) {
        clearEncryptedGithubVault();
    }
}

function saveGithubSession(pat, configPatch = {}) {
    memoryGithubPat = String(pat || "").trim();
    try {
        if (typeof sessionStorage !== "undefined" && Object.keys(configPatch).length > 0) {
            const nextCfg = { ...getSessionConfig(), ...configPatch };
            sessionStorage.setItem(REPO_CFG_SESSION_KEY, JSON.stringify(nextCfg));
        }
    } catch {
        // Config falls back to defaults
    }
}

export async function setupGithubPasswordVault({
    pat = "",
    password = "",
    useLegacyPat = false,
    configOverrides = {},
} = {}) {
    const targetPat = useLegacyPat ? getLegacyPlaintextPat() : String(pat || "").trim();
    if (!targetPat) {
        throw new Error("Ingresá un GitHub Fine-grained PAT válido.");
    }
    if (String(password || "").length < 8) {
        throw new Error("La contraseña debe tener al menos 8 caracteres.");
    }

    const loginResult = await loginWithGithubPat(targetPat, configOverrides);
    const vault = await encryptPatWithPassword(targetPat, password);
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
    }
    clearLegacyPlaintextPat();
    return {
        ...loginResult,
        vaultSaved: true,
    };
}

export async function unlockGithubVaultWithPassword(password, configOverrides = {}) {
    const vault = readStoredVaultObject();
    if (!vault) {
        throw new Error("No hay una bóveda cifrada guardada en este navegador.");
    }
    const decryptedPat = await decryptPatWithPassword(vault, password);
    try {
        return await loginWithGithubPat(decryptedPat, configOverrides);
    } catch (error) {
        memoryGithubPat = "";
        throw error;
    }
}

async function githubApi(path, { pat, method = "GET", headers = {}, body, raw = false } = {}) {
    const token = String(pat || getStoredGithubPat() || "").trim();
    if (!token) {
        throw new Error("Sesión GitHub no iniciada. Ingresá tu Fine-grained PAT.");
    }
    if (!/^[\x21-\x7E]+$/.test(token)) {
        throw new Error("El GitHub PAT contiene espacios, saltos de línea o caracteres no válidos.");
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

    let response;
    try {
        response = await fetch(`https://api.github.com${path}`, {
            method,
            headers: reqHeaders,
            body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
            cache: "no-store",
        });
    } catch (error) {
        const cleanPath = String(path || "").split("?")[0];
        throw new Error(
            `Error de red al conectar con GitHub (${cleanPath}): ${error?.message || "Failed to fetch"}. Verificá tu conexión o bloqueadores del navegador.`
        );
    }

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
            const err = new Error(msg);
            err.status = response.status;
            throw err;
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
        const err = new Error(data?.message || `GitHub HTTP ${response.status}`);
        err.status = response.status;
        throw err;
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
    const [repoRes, workflowsRes, userRes] = await Promise.all([
        githubApi(`/repos/${cfg.dataRepo}`, { pat }),
        githubApi(`/repos/${cfg.codeRepo}/actions/workflows?per_page=100`, { pat }),
        githubApi("/user", { pat }).catch(() => null),
    ]);

    const repo = repoRes.data;
    if (!repo?.permissions?.push && !repo?.permissions?.admin) {
        throw new Error(
            `El token no tiene permisos de escritura (Contents: Read and write) sobre ${cfg.dataRepo}.`
        );
    }

    const workflows = workflowsRes.data;
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

    const user = userRes?.data
        ? {
            login: userRes.data.login || "",
            avatarUrl: userRes.data.avatar_url || "",
        }
        : { login: repo?.owner?.login || "admin", avatarUrl: "" };

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

function decodeBase64Utf8(base64) {
    const clean = String(base64 || "").replace(/\s+/g, "");
    return new TextDecoder().decode(base64ToBytes(clean));
}

async function resolveBlobShaFromBranch(cfg, repoPath, pat) {
    const normalizedPath = String(repoPath || "").replace(/^\/+/, "");
    const slashIdx = normalizedPath.lastIndexOf("/");
    const parentDir = slashIdx >= 0 ? normalizedPath.slice(0, slashIdx) : "";
    const fileName = slashIdx >= 0 ? normalizedPath.slice(slashIdx + 1) : normalizedPath;

    try {
        const dirPath = parentDir ? `/contents/${parentDir}` : "/contents";
        const { data: entries } = await githubApi(
            `/repos/${cfg.dataRepo}${dirPath}?ref=${encodeURIComponent(cfg.branch)}`,
            { pat }
        );
        if (Array.isArray(entries)) {
            const match = entries.find((item) => item?.name === fileName && item?.type === "file" && item?.sha);
            if (match?.sha) return match.sha;
        }
    } catch (error) {
        if (error?.status === 404) {
            const notFound = new Error(`No se encontró ${normalizedPath} en ${cfg.dataRepo}.`);
            notFound.status = 404;
            throw notFound;
        }
        // Fall through to recursive tree lookup if directory listing failed (e.g. >1000 items)
    }

    const { data: refData } = await githubApi(
        `/repos/${cfg.dataRepo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`,
        { pat }
    );
    const commitSha = refData?.object?.sha;
    if (!commitSha) {
        throw new Error(`No se pudo resolver la rama ${cfg.branch} en ${cfg.dataRepo}.`);
    }
    const { data: treeData } = await githubApi(
        `/repos/${cfg.dataRepo}/git/trees/${commitSha}?recursive=1`,
        { pat }
    );
    const treeEntry = Array.isArray(treeData?.tree)
        ? treeData.tree.find((item) => item?.path === normalizedPath && item?.type === "blob" && item?.sha)
        : null;
    if (!treeEntry?.sha) {
        const notFound = new Error(`No se encontró ${normalizedPath} en ${cfg.dataRepo}.`);
        notFound.status = 404;
        throw notFound;
    }
    return treeEntry.sha;
}

const KNOWN_LARGE_REPO_PATHS = new Set([
    "private/catalog-state.json",
    "public/assets/data/catalog.json",
]);

async function readBlobText(cfg, blobSha, pat) {
    const cacheKey = `${cfg.dataRepo}:${blobSha}`;
    const cachedText = blobTextCache.get(cacheKey);
    if (typeof cachedText === "string") {
        return cachedText;
    }

    try {
        const { text } = await githubApi(
            `/repos/${cfg.dataRepo}/git/blobs/${blobSha}`,
            { pat, raw: true }
        );
        setCachedBlobText(cacheKey, text);
        return text;
    } catch (rawErr) {
        if (rawErr?.status === 404) throw rawErr;
        const { data: blob } = await githubApi(
            `/repos/${cfg.dataRepo}/git/blobs/${blobSha}`,
            { pat }
        );
        if (!blob || typeof blob.content !== "string") {
            throw rawErr;
        }
        const text = decodeBase64Utf8(blob.content);
        setCachedBlobText(cacheKey, text);
        return text;
    }
}

async function readRepoJsonFile(repoPath, { pat, configOverrides = {}, optional = false } = {}) {
    const cfg = { ...getSessionConfig(), ...configOverrides };
    const cleanPath = String(repoPath || "").replace(/^\/+/, "");
    try {
        if (!KNOWN_LARGE_REPO_PATHS.has(cleanPath)) {
            try {
                const { data } = await githubApi(
                    `/repos/${cfg.dataRepo}/contents/${cleanPath}?ref=${encodeURIComponent(cfg.branch)}`,
                    { pat }
                );
                if (data && typeof data === "object" && typeof data.content === "string" && data.encoding === "base64") {
                    const text = decodeBase64Utf8(data.content);
                    return {
                        data: JSON.parse(text),
                        sha: String(data.sha || ""),
                        config: cfg,
                    };
                }
                if (data && typeof data === "object" && data.sha) {
                    const text = await readBlobText(cfg, String(data.sha), pat);
                    return {
                        data: JSON.parse(text),
                        sha: String(data.sha || ""),
                        config: cfg,
                    };
                }
            } catch (contentsError) {
                if (contentsError?.status !== 403) {
                    throw contentsError;
                }
                // GitHub /contents/ returns 403 for files > 1 MB; read directly via Git Blob API (up to 100 MB, no CORS redirect).
            }
        }

        const blobSha = await resolveBlobShaFromBranch(cfg, cleanPath, pat);
        const text = await readBlobText(cfg, blobSha, pat);
        return {
            data: JSON.parse(text),
            sha: blobSha,
            config: cfg,
        };
    } catch (error) {
        if (optional && error?.status === 404) {
            return { data: null, sha: "", config: cfg, missing: true };
        }
        throw error;
    }
}

async function commitRepoFiles(files, { message, pat, configOverrides = {} } = {}) {
    const cfg = { ...getSessionConfig(), ...configOverrides };
    const token = pat || getStoredGithubPat();

    const refPromise = githubApi(
        `/repos/${cfg.dataRepo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`,
        { pat: token }
    ).then(async ({ data: refData }) => {
        const parentCommitSha = refData?.object?.sha;
        if (!parentCommitSha) {
            throw new Error("No se pudo resolver la rama de destino en GitHub.");
        }
        const { data: parentCommit } = await githubApi(
            `/repos/${cfg.dataRepo}/git/commits/${parentCommitSha}`,
            { pat: token }
        );
        return {
            parentCommitSha,
            baseTreeSha: parentCommit?.tree?.sha,
        };
    });

    const blobsPromise = Promise.all(
        files.map(async (file) => {
            const { data: blob } = await githubApi(
                `/repos/${cfg.dataRepo}/git/blobs`,
                {
                    pat: token,
                    method: "POST",
                    body: {
                        content: utf8ToBase64(file.content),
                        encoding: "base64",
                    },
                }
            );
            setCachedBlobText(`${cfg.dataRepo}:${blob.sha}`, file.content);
            return {
                path: file.path,
                mode: "100644",
                type: "blob",
                sha: blob.sha,
            };
        })
    );

    const [{ parentCommitSha, baseTreeSha }, treeItems] = await Promise.all([
        refPromise,
        blobsPromise,
    ]);

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
        commitSha: newCommit.sha,
        config: cfg,
    };
}

export async function readAdminCatalogState(configOverrides = {}) {
    const result = await readRepoJsonFile("private/catalog-state.json", {
        configOverrides,
    });
    return {
        state: result.data,
        sha: result.sha,
        config: result.config,
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
    const stateToSave = {
        ...nextState,
        catalog: {
            ...(nextState?.catalog || {}),
            updatedAt: new Date().toISOString(),
        },
    };

    const files = [
        {
            path: "private/catalog-state.json",
            content: JSON.stringify(stateToSave) + "\n",
        },
    ];

    if (publishPublic) {
        const publicDoc = buildPublicCatalogProjection(stateToSave.catalog);
        files.push({
            path: "public/assets/data/catalog.json",
            content: JSON.stringify(publicDoc) + "\n",
        });
    }

    const { commitSha } = await commitRepoFiles(files, {
        message,
        pat,
        configOverrides,
    });

    return {
        success: true,
        commitSha,
        state: stateToSave,
    };
}

export async function dispatchWorkflow(
    workflowFile,
    inputs = {},
    { pat, configOverrides = {} } = {}
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

    return { workflowFile, dispatchedAt, config: cfg };
}

export async function waitForDispatchedWorkflow(
    workflowFile,
    dispatchedAt,
    {
        pollIntervalMs = 3000,
        timeoutMs = 300_000,
        onProgress,
        shouldStop,
        pat,
        configOverrides = {},
    } = {}
) {
    const cfg = { ...getSessionConfig(), ...configOverrides };
    const token = pat || getStoredGithubPat();
    let matchedRun = null;
    let cachedJobs = [];
    let lastJobsFetchAt = 0;
    let isFirstPoll = true;
    while (Date.now() - dispatchedAt < timeoutMs) {
        if (typeof shouldStop === "function" && shouldStop()) return null;
        const waitMs = isFirstPoll ? Math.min(pollIntervalMs, 1200) : pollIntervalMs;
        isFirstPoll = false;
        await new Promise((r) => setTimeout(r, waitMs));
        if (typeof shouldStop === "function" && shouldStop()) return null;

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
                if (Date.now() - lastJobsFetchAt >= 5000 || matchedRun.status === "completed") {
                    try {
                        const { data: jobData } = await githubApi(
                            `/repos/${cfg.codeRepo}/actions/runs/${matchedRun.id}/jobs?per_page=100`,
                            { pat: token }
                        );
                        cachedJobs = (jobData?.jobs || []).map((job) => ({
                        name: job.name || "Job",
                        status: job.status || "queued",
                        conclusion: job.conclusion || "",
                        steps: (job.steps || []).map((step) => ({
                            name: step.name || "Paso",
                            status: step.status || "queued",
                            conclusion: step.conclusion || "",
                        })),
                        }));
                        lastJobsFetchAt = Date.now();
                    } catch {
                        // Run status remains useful if job details are temporarily unavailable.
                    }
                }
                onProgress({
                    id: matchedRun.id,
                    status: matchedRun.status,
                    conclusion: matchedRun.conclusion,
                    htmlUrl: matchedRun.html_url,
                    jobs: cachedJobs,
                });
            }
            if (matchedRun.status === "completed") {
                if (matchedRun.conclusion !== "success") {
                    if (!cachedJobs.length) {
                        try {
                            const { data: jobData } = await githubApi(
                                `/repos/${cfg.codeRepo}/actions/runs/${matchedRun.id}/jobs?per_page=100`,
                                { pat: token }
                            );
                            cachedJobs = (jobData?.jobs || []).map((job) => ({
                                name: job.name || "Job",
                                status: job.status || "queued",
                                conclusion: job.conclusion || "",
                                steps: (job.steps || []).map((step) => ({
                                    name: step.name || "Paso",
                                    status: step.status || "queued",
                                    conclusion: step.conclusion || "",
                                })),
                            }));
                        } catch {
                            // Fall back to run-level status message.
                        }
                    }
                    const failedStep = cachedJobs
                        .flatMap((job) => job.steps || [])
                        .find((step) => step.conclusion && step.conclusion !== "success" && step.conclusion !== "skipped");
                    const stepHint = failedStep ? ` (paso fallido: "${failedStep.name}")` : "";
                    throw new Error(
                        `El workflow ${workflowFile} terminó con estado: ${matchedRun.conclusion || "failed"}${stepHint}.`
                    );
                }
                return matchedRun;
            }
        }
    }

    throw new Error(`Tiempo de espera agotado esperando ${workflowFile}.`);
}

export async function dispatchWorkflowAndWait(
    workflowFile,
    inputs = {},
    options = {}
) {
    const { dispatchedAt } = await dispatchWorkflow(workflowFile, inputs, options);
    return waitForDispatchedWorkflow(workflowFile, dispatchedAt, options);
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

    const { data: result } = await readRepoJsonFile(
        `private/lookup-results/${requestId}.json`,
        { pat, configOverrides: cfg }
    );
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

function normalizeLinkReportEntry(item) {
    return {
        id: item?.id ?? null,
        port_id: String(item?.port_id || ""),
        reason: String(item?.reason || ""),
        note: String(item?.note || ""),
        url: String(item?.url || ""),
        created_at: String(item?.created_at || ""),
        updated_at: String(item?.updated_at || item?.created_at || ""),
        discord_notified_at: item?.discord_notified_at ? String(item.discord_notified_at) : null,
        status: item?.status === "resolved" ? "resolved" : "pending",
        resolved_at: item?.resolved_at ? String(item.resolved_at) : null,
    };
}

function getLinkReportKey(report) {
    if (report?.id !== undefined && report?.id !== null && String(report.id).trim() !== "") {
        return `id:${String(report.id).trim()}`;
    }
    return `key:${String(report?.port_id || "")}|${String(report?.created_at || report?.updated_at || "")}|${String(report?.url || "")}`;
}

export async function triggerCommunitySummarySync(options = {}) {
    const cfg = { ...getSessionConfig(), ...options.configOverrides };
    return dispatchWorkflowAndWait(cfg.communitySyncWorkflow, {}, options);
}

export async function updateCommunityLinkReportStatus(
    reportKey,
    nextStatus,
    { pat, configOverrides = {} } = {}
) {
    const token = pat || getStoredGithubPat();
    if (!token) {
        throw new Error("Sesión GitHub requerida para actualizar reportes.");
    }

    const reportsRes = await readRepoJsonFile("private/link-reports.json", {
        pat: token,
        configOverrides,
        optional: true,
    });
    const doc = reportsRes.data && typeof reportsRes.data === "object"
        ? reportsRes.data
        : { version: 1, updatedAt: "", reports: [] };
    const normalizedStatus = nextStatus === "resolved" ? "resolved" : "pending";
    const nowIso = new Date().toISOString();

    let found = false;
    const updatedReports = (Array.isArray(doc.reports) ? doc.reports : []).map((raw) => {
        const entry = normalizeLinkReportEntry(raw);
        if (getLinkReportKey(entry) !== String(reportKey)) {
            return entry;
        }
        found = true;
        return {
            ...entry,
            status: normalizedStatus,
            resolved_at: normalizedStatus === "resolved" ? nowIso : null,
        };
    });

    if (!found) {
        throw new Error("No se encontró el reporte en private/link-reports.json.");
    }

    const nextDoc = {
        version: Number(doc.version) || 1,
        updatedAt: nowIso,
        reports: updatedReports,
    };

    const { commitSha } = await commitRepoFiles(
        [
            {
                path: "private/link-reports.json",
                content: JSON.stringify(nextDoc, null, 2) + "\n",
            },
        ],
        {
            message: `NAPL Admin: ${normalizedStatus === "resolved" ? "resolve" : "reopen"} link report`,
            pat: token,
            configOverrides,
        }
    );

    return {
        success: true,
        commitSha,
        updatedAt: nextDoc.updatedAt,
        reports: updatedReports,
    };
}

export async function fetchCommunityAdminDashboard({ pat, configOverrides = {} } = {}) {
    const token = pat || getStoredGithubPat();
    if (!token) {
        throw new Error("Sesión GitHub requerida para consultar el dashboard.");
    }

    const [summaryRes, reportsRes] = await Promise.all([
        readRepoJsonFile("public/assets/data/community-summary.json", {
            pat: token,
            configOverrides,
            optional: true,
        }),
        readRepoJsonFile("private/link-reports.json", {
            pat: token,
            configOverrides,
            optional: true,
        }),
    ]);

    const snapshot = summaryRes.data && typeof summaryRes.data === "object"
        ? summaryRes.data
        : {
            version: 1,
            generatedAt: "",
            ratings: { ports: [], global_avg: 0 },
            popularity: { week: [], month: [], alltime: [] },
            compatibility: {},
        };

    const reportsDoc = reportsRes.data && typeof reportsRes.data === "object"
        ? reportsRes.data
        : { version: 1, updatedAt: "", reports: [] };

    const reports = (Array.isArray(reportsDoc.reports) ? reportsDoc.reports : []).map((item) => {
        const normalized = normalizeLinkReportEntry(item);
        return {
            ...normalized,
            reportKey: getLinkReportKey(normalized),
        };
    });

    const ratings = Array.isArray(snapshot.ratings?.ports) ? snapshot.ratings.ports : [];
    const week = new Map((snapshot.popularity?.week || []).map((item) => [item.slug, Number(item.visits) || 0]));
    const month = new Map((snapshot.popularity?.month || []).map((item) => [item.slug, Number(item.visits) || 0]));
    const popularity = (snapshot.popularity?.alltime || []).map((item) => ({
        game_key: item.slug,
        all_time_visits: Number(item.visits) || 0,
        week_visits: week.get(item.slug) || 0,
        month_visits: month.get(item.slug) || 0,
        updated_at: snapshot.generatedAt || "",
    }));

    const compatibilityMap = snapshot.compatibility && typeof snapshot.compatibility === "object"
        ? snapshot.compatibility
        : {};
    const compatibility = Object.entries(compatibilityMap).flatMap(([portId, item]) =>
        (Array.isArray(item?.reports) ? item.reports : []).map((report) => ({
            updated_at: report.updatedAt || "",
            port_id: portId,
            device_name: report.deviceName || report.deviceId || "",
            status: report.status || "",
            works: Boolean(report.works),
        }))
    );
    const compatibilityReports = Object.values(compatibilityMap).reduce(
        (total, item) => total + (Number(item?.yes) || 0) + (Number(item?.no) || 0),
        0
    );
    const pendingReports = reports.filter((item) => item.status !== "resolved").length;
    const resolvedReports = reports.length - pendingReports;

    return {
        generatedAt: snapshot.generatedAt || "",
        reportsUpdatedAt: reportsDoc.updatedAt || "",
        hasSummaryFile: !summaryRes.missing,
        hasReportsFile: !reportsRes.missing,
        totals: {
            linkReports: pendingReports,
            resolvedLinkReports: resolvedReports,
            totalLinkReports: reports.length,
            compatibilityReports,
            ratingVotes: ratings.reduce((total, item) => total + (Number(item.votes) || 0), 0),
            gamesTracked: popularity.length,
            allTimeVisits: popularity.reduce((total, item) => total + item.all_time_visits, 0),
        },
        reports,
        compatibility,
        ratings,
        popularity,
    };
}
