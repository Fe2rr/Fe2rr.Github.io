const DATA_REPO = "Fe2rr/NAPL-Data";
const DATA_BRANCH = "main";
const INTERNAL_STATE_PATH = "private/catalog-state.json";
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";
const SESSION_TTL = 8 * 60 * 60 * 1000;
const DEFAULT_CRON_BATCH = 10;
const MAX_SYNC_BATCH = 15;
const MAX_SUBREQUESTS_PER_RUN = 34;
const MAX_PLAYSTORE_PER_RUN = 2;
const SYNC_ELAPSED_BUDGET_MS = 12000;
const UPSTREAM_TIMEOUT_MS = 7000;
const SYNC_STAGE_PATH = "private/sync-staging.json";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const list = String(env.ADMIN_ORIGIN || "https://fe2rr.github.io")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (list.includes(origin) || origin === "https://napl-admin.pages.dev") return true;
  if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") {
    return true;
  }
  try {
    const u = new URL(origin);
    if (
      u.hostname.endsWith(".run.app") ||
      u.hostname === "fe2rr.github.io" ||
      (u.protocol === "https:" && u.hostname.endsWith(".napl-admin.pages.dev"))
    ) {
      return true;
    }
  } catch {
    // Ignore malformed origin
  }
  return false;
}

function cors(req, env, isPublic = false) {
  if (isPublic) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
      "Access-Control-Expose-Headers": "ETag",
      "Access-Control-Max-Age": "86400",
    };
  }
  const origin = req.headers.get("Origin") || "";
  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (isAllowedOrigin(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  return atob(s);
}

async function sign(str, keyText) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(str));
  return b64url(String.fromCharCode.apply(null, new Uint8Array(sig)));
}

function equal(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    d |= (x[i] || 0) ^ (y[i] || 0);
  }
  return d === 0;
}

async function sessionToken(env) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + SESSION_TTL }));
  return `${payload}.${await sign(payload, env.SESSION_SECRET)}`;
}

async function authenticated(req, env) {
  if (!env.SESSION_SECRET) return false;
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  if (!equal(await sign(parts[0], env.SESSION_SECRET), parts[1])) return false;
  try {
    return JSON.parse(unb64url(parts[0])).exp > Date.now();
  } catch {
    return false;
  }
}

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 16384) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 16384));
  }
  return btoa(bin);
}

const NORM_CACHE_MAX = 4096;
const normHeadCache = new Map();
const normCache = new Map();
const slugifyCache = new Map();

function normHead(v) {
  const raw = String(v || "");
  const cached = normHeadCache.get(raw);
  if (cached !== undefined) return cached;
  const out = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  if (normHeadCache.size >= NORM_CACHE_MAX) normHeadCache.clear();
  normHeadCache.set(raw, out);
  return out;
}

function norm(v) {
  const raw = String(v || "");
  const cached = normCache.get(raw);
  if (cached !== undefined) return cached;
  const out = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (normCache.size >= NORM_CACHE_MAX) normCache.clear();
  normCache.set(raw, out);
  return out;
}

function slugify(v) {
  const raw = String(v || "");
  const cached = slugifyCache.get(raw);
  if (cached !== undefined) return cached;
  const out = norm(raw).replace(/\s+/g, "-");
  if (slugifyCache.size >= NORM_CACHE_MAX) slugifyCache.clear();
  slugifyCache.set(raw, out);
  return out;
}

function formatNaplDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function parseGithubRepo(rawUrl) {
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
    if (!owner || !repo || ["orgs", "topics", "search", "explore", "settings"].includes(owner.toLowerCase())) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

function normalizeGithubSlug(raw) {
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

function parseGitlabProject(rawUrl) {
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
    if (["explore", "users", "dashboard", "admin", "help", "api"].includes(parts[0].toLowerCase())) {
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

function normalizeGitlabPath(raw) {
  const parsed = parseGitlabProject(raw);
  return parsed ? parsed.projectPath : "";
}

const ANDROID_PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

function parsePlayStorePackage(rawUrl) {
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

function normalizePlayStoreId(raw) {
  const parsed = parsePlayStorePackage(raw);
  return parsed ? parsed.packageId : "";
}

function resolvePortSyncTarget(port) {
  if (!port) return { provider: "", target: "", githubRepo: "" };
  const url = String(port.url || "").trim();
  const link = String(port.link || "").trim();
  const dataUrl = String(port.dataUrl ?? port.data_url ?? "").trim();
  const rawProvider = String(port.syncProvider ?? port.sync_provider ?? "").trim().toLowerCase();
  const rawTarget = String(port.syncTarget ?? port.sync_target ?? "").trim();
  const rawGithub = String(port.githubRepo ?? port.github_repo ?? "").trim();

  for (const candidate of [url, link, dataUrl]) {
    const ps = normalizePlayStoreId(candidate);
    if (ps) return { provider: "playstore", target: ps, githubRepo: "" };
    const gl = normalizeGitlabPath(candidate);
    if (gl) return { provider: "gitlab", target: gl, githubRepo: "" };
  }

  const gh = normalizeGithubSlug(rawGithub) || normalizeGithubSlug(url) || normalizeGithubSlug(link);
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

function fetchWithTimeout(url, init = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const options = { ...init };
  if (!options.signal && typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    options.signal = AbortSignal.timeout(timeoutMs);
  }
  return fetch(url, options);
}

async function ghFetch(path, env, options = {}) {
  if (options.budget) options.budget.subrequests++;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "NAPL-Catalog-Sync/2.0",
    ...(options.headers || {}),
  };
  const token = options.token || env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetchWithTimeout(
    `https://api.github.com${path}`,
    {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    options.timeoutMs || UPSTREAM_TIMEOUT_MS
  );
  const text = await res.text();
  let data = {};
  if (!options.raw) {
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
  }
  return { res, data, text };
}

async function gitBlobSha(content) {
  const bytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const input = new Uint8Array(header.length + bytes.length);
  input.set(header);
  input.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", input);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function ghCommitDataCatalog(catalog, env, message = "NAPL: publicar snapshot estático en NAPL-Data") {
  const token = env.CATALOG_DATA_GITHUB_TOKEN;
  if (!token) {
    throw new Error("Falta configurar CATALOG_DATA_GITHUB_TOKEN con Contents: Read and write para Fe2rr/NAPL-Data.");
  }
  const path = "/repos/Fe2rr/NAPL-Data/contents/public/assets/data/catalog.json";
  const { res: metaRes, data: meta } = await ghFetch(`${path}?ref=main`, env, { token });
  if (!metaRes.ok && metaRes.status !== 404) {
    throw new Error(meta.message || `No se pudo leer NAPL-Data (HTTP ${metaRes.status}).`);
  }
  const raw = JSON.stringify(catalog);
  const expectedSha = await gitBlobSha(raw);
  if (metaRes.ok && meta.sha === expectedSha) {
    return { commit: "", sha: meta.sha || "", unchanged: true };
  }
  const payload = { message, content: toB64(raw), branch: "main" };
  if (metaRes.ok && meta.sha) payload.sha = meta.sha;
  const { res, data } = await ghFetch(path, env, { method: "PUT", body: payload, token });
  if (!res.ok) {
    throw new Error(data.message || `NAPL-Data HTTP ${res.status}`);
  }
  return { commit: data.commit?.html_url || "", sha: data.commit?.sha || "", unchanged: false };
}

function csvParse(csv) {
  const rows = [];
  let row = [];
  let buf = "";
  let start = 0;
  let q = false;
  const len = csv.length;
  for (let i = 0; i < len; i++) {
    const code = csv.charCodeAt(i);
    if (code === 34) { // '"'
      if (i > start) buf += csv.slice(start, i);
      if (q && csv.charCodeAt(i + 1) === 34) {
        buf += '"';
        i++;
      } else {
        q = !q;
      }
      start = i + 1;
    } else if (!q && (code === 44 || code === 10 || code === 13)) { // ',' or '\n' or '\r'
      const val = buf ? buf + csv.slice(start, i) : csv.slice(start, i);
      buf = "";
      row.push(val);
      if (code === 44) {
        start = i + 1;
      } else {
        if (code === 13 && csv.charCodeAt(i + 1) === 10) i++;
        start = i + 1;
        for (let k = 0; k < row.length; k++) {
          if (row[k].trim()) {
            rows.push(row);
            break;
          }
        }
        row = [];
      }
    }
  }
  if (start < len || buf.length || row.length) {
    const val = buf ? buf + csv.slice(start) : csv.slice(start);
    row.push(val);
    for (let k = 0; k < row.length; k++) {
      if (row[k].trim()) {
        rows.push(row);
        break;
      }
    }
  }
  if (!rows.length) return [];
  const headers = rows.shift().map(normHead);
  const out = new Array(rows.length);
  for (let r = 0; r < rows.length; r++) {
    const values = rows[r];
    const o = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h) o[h] = String(values[i] || "").trim();
    }
    out[r] = o;
  }
  return out;
}

function col(row, names) {
  for (const n of names) {
    const k = normHead(n);
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      return String(row[k] || "").trim();
    }
  }
  return "";
}

function fromRows(rows) {
  let currentGame = "", currentYear = "", currentPlatform = "";
  const platforms = new Map(), groups = new Map();
  for (const row of rows) {
    const gv=col(row,["GAME","GAME NAME","NAME","JUEGO"]), yv=col(row,["YEAR","ANO","AÑO"]);
    const platformValue=col(row,["PLATFORM","PLATAFORM","PLATAFORMA"]);
    if(gv)currentGame=gv; if(yv)currentYear=yv; if(platformValue)currentPlatform=platformValue; if(!currentGame)continue;
    const platform=currentPlatform;
    if(platform && norm(platform)!=="multi game apps" && !platforms.has(norm(platform)))platforms.set(norm(platform),platform);
    const key=norm(currentGame)+"|"+norm(platform);
    const sourcePopularityKey=col(row,["POPULARITY_KEY","POPULARITY KEY","POPULARITY ID","POPULARITY_ID"]);
    if(!groups.has(key))groups.set(key,{name:currentGame,platform,year:currentYear||"",popularityKey:sourcePopularityKey,coverUrl:"",genre:"",description:"",launchboxUrl:"",ports:[]});
    const g=groups.get(key); if(!g.year&&currentYear)g.year=currentYear;
    if(!g.popularityKey&&sourcePopularityKey)g.popularityKey=sourcePopularityKey;
    const lb=col(row,["LAUNCHBOX_URL","LAUNCHBOX URL"]);
    if(!g.launchboxUrl&&lb)g.launchboxUrl=lb;
    for(const [field,names] of [["coverUrl",["COVER_URL","COVER URL","COVER","COVER IMAGE","IMAGE URL","PORTADA"]],["genre",["GENRE","GÉNERO","GENERO"]],["description",["DESCRIPTION","DESCRIPCIÓN","DESCRIPCION"]]]){const v=col(row,names);if(!g[field]&&v)g[field]=v;}
    const url=col(row,["URL","PORT URL","PORT LINK"]),link=col(row,["LINK","PROJECT LINK","ENLACE"]);
    const syncInfo=resolvePortSyncTarget({url,link});
    const p={portId:col(row,["PORTS_ID","PORT ID","PORT_ID"]),project:col(row,["PROJECT","PROYECTO"]),
      developer:col(row,["DEVELOPER","DEVELOPER/PUBLISHER","DESARROLLADOR"]),year:currentYear,
      version:col(row,["VERSION","VERSIÓN"]),controller:col(row,["CONTROLLER SUPPORT","CONTROLLER","GAMEPAD","MANDO"]),
      files:col(row,["NEEDS GAME FILES?","NEEDS GAME FILES","GAME FILES","NECESITA ARCHIVOS"]),
      works:col(row,["WORKS?","WORKS","FUNCIONA"]),link,url,dataUrl:col(row,["DATA URL","DATA LINK","GAME FILES URL"]),
      githubRepo:syncInfo.githubRepo,syncProvider:syncInfo.provider,syncTarget:syncInfo.target,lastUpdate:col(row,["LAST UPDATE","LAST UPDATED","ÚLTIMA ACTUALIZACIÓN"]),
      dateAdded:col(row,["DATE ADDED"]),notes:col(row,["NOTES","NOTE","NOTAS"])};
    if(/^unofficial-port(?:-\d+)?$/i.test(p.portId))p.portId=slugify(currentGame)+"-"+p.portId.toLowerCase();
    if(Object.entries(p).some(([k,v])=>k!=="year"&&String(v||"").trim()))g.ports.push(p);
  }
  const seen=new Set();
  const games=Array.from(groups.values()).map(g=>{const base=slugify(g.name)+"-"+(slugify(g.platform)||"sin-plataforma");let n=1,slug=base+"-"+n;while(seen.has(slug))slug=base+"-"+(++n);seen.add(slug);return {...g,slug,popularityKey:String(g.popularityKey||"").trim()};});
  return {version:1,updatedAt:new Date().toISOString(),platformOrder:Array.from(platforms.values()),games};
}

function validateCatalog(input) {
  if(!input||!Array.isArray(input.games)||!Array.isArray(input.platformOrder))throw new Error("Formato JSON inválido.");
  const slugs=new Set(),ids=new Set();
  const games=input.games.map(g=>{
    if(!g||typeof g.name!=="string"||!g.name.trim())throw new Error("Cada juego necesita nombre.");
    const platform=String(g.platform||"").trim(),base=slugify(g.name)+"-"+(slugify(platform)||"sin-plataforma");
    let slug=String(g.slug||"").trim();if(!slug||!slug.startsWith(base+"-")){let n=1;slug=base+"-"+n;while(slugs.has(slug))slug=base+"-"+(++n);}
    if(slugs.has(slug))throw new Error("Slug duplicado: "+slug);slugs.add(slug);
    if(!Array.isArray(g.ports))throw new Error("Ports inválidos en "+g.name);
    const ports=g.ports.map((p,i)=>{const o={};for(const k of ["portId","project","developer","year","version","controller","files","works","link","url","dataUrl","githubRepo","githubStatus","syncProvider","syncTarget","lastCheckedAt","lastUpdate","dateAdded","notes"])o[k]=String(p?.[k]??"");
      if(!o.portId)o.portId=slug+"-port-"+(i+1);if(ids.has(o.portId))throw new Error("ID de port duplicado: "+o.portId);ids.add(o.portId);
      const syncInfo=resolvePortSyncTarget(o);o.githubRepo=syncInfo.githubRepo;o.syncProvider=syncInfo.provider;o.syncTarget=syncInfo.target;return o;});
    const popularityKey=String(g.popularityKey||slugify(g.name)).trim().toLowerCase();
     if(!/^[a-z0-9][a-z0-9-]{0,179}$/.test(popularityKey))throw new Error("Clave de popularidad inválida en "+g.name);
     return {name:g.name.trim(),platform,slug,popularityKey,year:String(g.year||""),coverUrl:String(g.coverUrl||""),genre:String(g.genre||""),description:String(g.description||""),launchboxUrl:String(g.launchboxUrl||""),ports};
  });
  return {version:1,updatedAt:new Date().toISOString(),platformOrder:[...new Set(input.platformOrder.map(x=>String(x).trim()).filter(Boolean))],games};
}

function decodeGitHubBase64(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function readDataJsonFile(env, filePath) {
  const token = env.CATALOG_DATA_GITHUB_TOKEN;
  if (!token) throw new Error("Falta configurar CATALOG_DATA_GITHUB_TOKEN.");
  const apiPath = "/repos/" + DATA_REPO + "/contents/" + filePath + "?ref=" + DATA_BRANCH;
  const result = await ghFetch(apiPath, env, {
    token,
    raw: true,
    timeoutMs: 10000,
    headers: { Accept: "application/vnd.github.raw+json" },
  });
  if (!result.res.ok) {
    let errMsg = "";
    try {
      errMsg = JSON.parse(result.text || "{}")?.message || "";
    } catch {}
    throw new Error(errMsg || ("No se pudo leer " + filePath + " (HTTP " + result.res.status + ")."));
  }
  const rawText = result.text || "";
  if (!rawText) throw new Error("El archivo " + filePath + " está vacío o GitHub no devolvió su contenido.");
  const etag = result.res.headers.get("ETag") || "";
  const etagMatch = etag.match(/^"([a-f0-9]{40})"$/i);
  const sha = etagMatch ? etagMatch[1] : await gitBlobSha(rawText);
  return { value: JSON.parse(rawText), sha };
}

async function writeDataJsonFile(env, filePath, value, expectedSha, message) {
  const token = env.CATALOG_DATA_GITHUB_TOKEN;
  if (!token) throw new Error("Falta configurar CATALOG_DATA_GITHUB_TOKEN.");
  const apiPath = "/repos/" + DATA_REPO + "/contents/" + filePath;
  const payload = { message, content: toB64(JSON.stringify(value)), branch: DATA_BRANCH };
  if (expectedSha) payload.sha = expectedSha;
  const result = await ghFetch(apiPath, env, { method: "PUT", body: payload, token, timeoutMs: 12000 });
  if (!result.res.ok) {
    const conflict = result.res.status === 409 || result.res.status === 422;
    throw new Error(conflict
      ? "El catálogo cambió en otra operación. Recargá el panel y reintentá para evitar sobrescribir cambios."
      : (result.data.message || ("No se pudo guardar " + filePath + " (HTTP " + result.res.status + ").")));
  }
  return { commit: result.data.commit?.html_url || "", sha: result.data.content?.sha || "" };
}

const VALID_POP_KEY_RE = /^[a-z0-9][a-z0-9-]{0,179}$/;

async function readCatalogState(env) {
  const loaded = await readDataJsonFile(env, INTERNAL_STATE_PATH);
  const state = loaded.value;
  if (!state || !state.catalog || !Array.isArray(state.catalog.games)) {
    throw new Error("El archivo interno del catálogo no tiene una estructura válida.");
  }
  state.meta = state.meta && typeof state.meta === "object" ? state.meta : {};
  state.syncLogs = Array.isArray(state.syncLogs) ? state.syncLogs : [];
  state.catalog.platformOrder = Array.isArray(state.catalog.platformOrder) ? state.catalog.platformOrder : [];
  const games = state.catalog.games;
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    if (typeof game?.popularityKey === "string" && VALID_POP_KEY_RE.test(game.popularityKey)) {
      continue;
    }
    const popularityKey = String(game?.popularityKey || slugify(game?.name || "")).trim().toLowerCase();
    if (!VALID_POP_KEY_RE.test(popularityKey)) {
      throw new Error("Clave de popularidad inválida en " + String(game?.name || "juego sin nombre"));
    }
    games[i] = { ...game, popularityKey };
  }
  state._sha = loaded.sha;
  return state;
}

async function saveCatalogState(env, state, message) {
  const value = { ...state };
  delete value._sha;
  const saved = await writeDataJsonFile(env, INTERNAL_STATE_PATH, value, state._sha, message || "NAPL: actualizar estado interno del catálogo");
  state._sha = saved.sha;
  return saved;
}

function catalogStats(state) {
  const games = state.catalog.games || [];
  const ports = games.flatMap((game) => (game.ports || []).map((port) => ({ ...port, gameSlug: game.slug })));
  let githubCount = 0, gitlabCount = 0, playstoreCount = 0, downCount = 0;
  for (const port of ports) {
    const source = resolvePortSyncTarget(port);
    if (source.provider === "github") githubCount++;
    else if (source.provider === "gitlab") gitlabCount++;
    else if (source.provider === "playstore") playstoreCount++;
    if (port.githubStatus === "down") downCount++;
  }
  return {
    gamesCount: games.length, portsCount: ports.length, githubCount, gitlabCount, playstoreCount,
    syncableCount: githubCount + gitlabCount + playstoreCount, downCount,
    lastSyncAt: state.meta.last_sync_at || "",
    lastGitHubPublishAt: state.meta.last_github_publish_at || "",
    pendingGitHubSync: state.meta.pending_github_sync === "1",
  };
}

function catalogStateResponse(state) {
  return { catalog: state.catalog, meta: state.meta, stats: catalogStats(state), syncLogs: state.syncLogs.slice(0, 12) };
}

async function saveSingleGameInJson(state, targetSlug, rawGame, isCreate) {
  if (!rawGame || typeof rawGame.name !== "string" || !rawGame.name.trim()) throw new Error("El juego necesita un nombre.");
  const platform = String(rawGame.platform || "").trim();
  const baseSlug = slugify(rawGame.name) + "-" + (slugify(platform) || "sin-plataforma");
  if (!baseSlug || baseSlug === "-") throw new Error("No se pudo generar el slug.");
  let sequence = 1;
  if (!isCreate && targetSlug && targetSlug.startsWith(baseSlug + "-")) {
    const current = Number(targetSlug.slice(baseSlug.length + 1));
    if (Number.isInteger(current) && current > 0) sequence = current;
  }
  let nextSlug = baseSlug + "-" + sequence;
  const occupied = new Set(state.catalog.games.filter((g) => g.slug !== targetSlug).map((g) => g.slug));
  while (occupied.has(nextSlug)) nextSlug = baseSlug + "-" + (++sequence);
  const existingIndex = state.catalog.games.findIndex((g) => g.slug === targetSlug);
  if (!isCreate && existingIndex < 0) throw new Error("No existe el juego '" + targetSlug + "'.");
  const now = new Date().toISOString();
  const rawPorts = Array.isArray(rawGame.ports) ? rawGame.ports : [];
  const seenIds = new Set(), seenSlugs = new Set();
  const ports = rawPorts.map((p, idx) => {
    let portId = String(p?.portId || "").trim() || (nextSlug + "-port-" + (idx + 1));
    while (seenIds.has(portId)) portId += "-" + (idx + 1);
    seenIds.add(portId);
    const basePortSlug = String(p?.slug || (nextSlug + "-" + slugify(p?.platform || "sin-plataforma")));
    let portSlug = basePortSlug;
    if (seenSlugs.has(portSlug)) {
      const suffix = slugify(portId) || String(idx + 1);
      portSlug = basePortSlug + "-" + suffix;
      let n = 2;
      while (seenSlugs.has(portSlug)) portSlug = basePortSlug + "-" + suffix + "-" + n++;
    }
    seenSlugs.add(portSlug);
    const syncInfo = resolvePortSyncTarget(p);
    const previousPort = (state.catalog.games.find((g) => g.slug === targetSlug)?.ports || []).find((item) => item.portId === portId) || {};
    return {
      ...previousPort,
      portId, slug: portSlug, project: String(p?.project || ""), developer: String(p?.developer || ""),
      year: String(p?.year || rawGame.year || ""), version: String(p?.version || ""),
      controller: String(p?.controller || ""), files: String(p?.files || ""), works: String(p?.works || ""),
      link: String(p?.link || "").trim(), url: String(p?.url || "").trim(), dataUrl: String(p?.dataUrl || ""),
      githubRepo: syncInfo.githubRepo || "", syncProvider: syncInfo.provider || "", syncTarget: syncInfo.target || "",
      githubStatus: String(p?.githubStatus || (syncInfo.provider ? "unknown" : "")),
      lastCheckedAt: String(p?.lastCheckedAt || ""), lastUpdate: String(p?.lastUpdate || ""),
      dateAdded: String(p?.dateAdded || now.slice(0, 10)), notes: String(p?.notes || ""),
    };
  });
  const previousGame = state.catalog.games.find((g) => g.slug === targetSlug) || {};
  const game = {
    ...previousGame,
    name: rawGame.name.trim(), slug: nextSlug, year: String(rawGame.year || ""),
    coverUrl: String(rawGame.coverUrl || ""), genre: String(rawGame.genre || ""),
    description: String(rawGame.description || ""), platform: String(rawGame.platform || ""),
    launchboxUrl: String(rawGame.launchboxUrl || ""), ports,
  };
  if (existingIndex >= 0) state.catalog.games.splice(existingIndex, 1, game);
  else state.catalog.games.unshift(game);
  const known = new Set(state.catalog.platformOrder.map(norm));
  if (platform && norm(platform) !== "multi game apps" && !known.has(norm(platform))) state.catalog.platformOrder.push(platform);
  state.catalog.updatedAt = now;
  state.meta.updated_at = now;
  state.meta.pending_github_sync = "1";
  return { slug: nextSlug, updatedAt: now, portsCount: ports.length };
}

function deleteGameFromJson(state, slug) {
  const index = state.catalog.games.findIndex((game) => game.slug === slug);
  if (index < 0) throw new Error("No existe el juego '" + slug + "'.");
  state.catalog.games.splice(index, 1);
  const now = new Date().toISOString();
  state.catalog.updatedAt = now;
  state.meta.updated_at = now;
  state.meta.pending_github_sync = "1";
  return { deleted: true, slug, updatedAt: now };
}

async function inspectGithubRepo(repoSlug, env, budget = null) {
  const parsed = parseGithubRepo(repoSlug);
  if (!parsed) {
    throw new Error("URL de GitHub inválida.");
  }

  const { res: repoRes, data: repoData } = await ghFetch(
    `/repos/${parsed.owner}/${parsed.repo}`,
    env,
    { budget }
  );

  if (repoRes.status === 404 || repoRes.status === 410) {
    return {
      provider: "github",
      status: "down",
      syncTarget: `${parsed.owner}/${parsed.repo}`,
      githubRepo: `${parsed.owner}/${parsed.repo}`,
      repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
      error: `Repositorio no disponible (HTTP ${repoRes.status}).`,
    };
  }

  if (!repoRes.ok) {
    throw new Error(repoData.message || `GitHub HTTP ${repoRes.status}`);
  }

  const canonicalRepo = String(repoData.full_name || `${parsed.owner}/${parsed.repo}`);
  const repoUrl = String(repoData.html_url || `https://github.com/${canonicalRepo}`);
  const moved = canonicalRepo.toLowerCase() !== `${parsed.owner}/${parsed.repo}`.toLowerCase();

  let release = null;
  const latest = await ghFetch(`/repos/${canonicalRepo}/releases/latest`, env, { budget });
  if (latest.res.ok && latest.data && latest.data.tag_name) {
    release = latest.data;
  } else {
    const list = await ghFetch(`/repos/${canonicalRepo}/releases?per_page=1`, env, { budget });
    if (list.res.ok && Array.isArray(list.data) && list.data.length > 0) {
      release = list.data[0];
    }
  }

  let tagFallback = null;
  if (!release) {
    const tags = await ghFetch(`/repos/${canonicalRepo}/tags?per_page=1`, env, { budget });
    if (tags.res.ok && Array.isArray(tags.data) && tags.data.length > 0) {
      tagFallback = tags.data[0];
    }
  }

  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const apkAsset =
    assets.find((a) => /\.apk$/i.test(String(a.name || "")) && !/debug/i.test(String(a.name || ""))) ||
    assets.find((a) => /\.apk$/i.test(String(a.name || "")));

  const version = String(release?.tag_name || tagFallback?.name || "").trim();
  const updatedIso = release?.published_at || repoData.pushed_at || repoData.updated_at || "";
  const lastUpdate = formatNaplDate(updatedIso);
  const releaseUrl = release?.html_url || repoUrl;
  const apkUrl = apkAsset?.browser_download_url || "";
  const recommendedUrl = repoUrl;

  return {
    provider: "github",
    syncTarget: canonicalRepo,
    status: moved ? "moved" : "ok",
    moved,
    archived: Boolean(repoData.archived),
    githubRepo: canonicalRepo,
    repoUrl,
    releaseUrl,
    apkUrl,
    recommendedUrl,
    project: String(repoData.name || parsed.repo),
    developer: String(repoData.owner?.login || parsed.owner),
    version,
    lastUpdate,
    link: repoData.archived ? "Free (Github - Archived)" : "Free (Github)",
    description: String(repoData.description || ""),
    checkedAt: new Date().toISOString(),
  };
}

async function glFetch(apiPath, env, budget = null) {
  if (budget) budget.subrequests++;
  const headers = {
    Accept: "application/json",
    "User-Agent": "NAPL-Catalog-Sync/2.0",
  };
  if (env?.GITLAB_TOKEN) {
    headers["PRIVATE-TOKEN"] = env.GITLAB_TOKEN;
  }
  const res = await fetchWithTimeout(`https://gitlab.com/api/v4${apiPath}`, { headers });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { res, data };
}

async function inspectGitlabProject(projectInput, env, budget = null) {
  const parsed = parseGitlabProject(projectInput);
  if (!parsed) throw new Error("URL de GitLab inválida.");

  const encoded = encodeURIComponent(parsed.projectPath);
  const { res: projRes, data: projData } = await glFetch(`/projects/${encoded}`, env, budget);
  if (projRes.status === 404 || projRes.status === 410) {
    return {
      provider: "gitlab",
      status: "down",
      syncTarget: parsed.projectPath,
      githubRepo: "",
      repoUrl: `https://gitlab.com/${parsed.projectPath}`,
      error: `Repositorio de GitLab no disponible (HTTP ${projRes.status}).`,
      checkedAt: new Date().toISOString(),
    };
  }
  if (!projRes.ok) {
    throw new Error(projData?.message || `GitLab HTTP ${projRes.status}`);
  }

  const canonicalPath = String(projData.path_with_namespace || parsed.projectPath);
  const canonicalEncoded = encodeURIComponent(canonicalPath);
  const repoUrl = String(projData.web_url || `https://gitlab.com/${canonicalPath}`);
  const moved = canonicalPath.toLowerCase() !== parsed.projectPath.toLowerCase();

  let release = null;
  const rels = await glFetch(`/projects/${canonicalEncoded}/releases?per_page=1`, env, budget);
  if (rels.res.ok && Array.isArray(rels.data) && rels.data.length > 0) {
    release = rels.data[0];
  }

  let tagFallback = null;
  if (!release) {
    const tags = await glFetch(`/projects/${canonicalEncoded}/repository/tags?per_page=1`, env, budget);
    if (tags.res.ok && Array.isArray(tags.data) && tags.data.length > 0) {
      tagFallback = tags.data[0];
    }
  }

  let commitFallback = null;
  if (!release && !tagFallback) {
    const commits = await glFetch(`/projects/${canonicalEncoded}/repository/commits?per_page=1`, env, budget);
    if (commits.res.ok && Array.isArray(commits.data) && commits.data.length > 0) {
      commitFallback = commits.data[0];
    }
  }

  const assetLinks = Array.isArray(release?.assets?.links) ? release.assets.links : [];
  const apkAsset =
    assetLinks.find((l) => /\.apk(?:$|[?#])/i.test(String(l?.name || l?.direct_asset_url || l?.url || "")) && !/debug/i.test(String(l?.name || ""))) ||
    assetLinks.find((l) => /\.apk(?:$|[?#])/i.test(String(l?.name || l?.direct_asset_url || l?.url || "")));
  let apkUrl = String(apkAsset?.direct_asset_url || apkAsset?.url || "").trim();
  if (!apkUrl && release?.description) {
    const mdApk = String(release.description).match(/https?:\/\/[^\s)"']+\.apk/i);
    if (mdApk) apkUrl = mdApk[0];
  }

  const version = String(release?.tag_name || tagFallback?.name || "").trim();
  const updatedIso =
    release?.released_at ||
    release?.created_at ||
    tagFallback?.commit?.committed_date ||
    commitFallback?.committed_date ||
    projData.last_activity_at ||
    "";
  const lastUpdate = formatNaplDate(updatedIso);
  const releaseUrl = release?.tag_name
    ? `${repoUrl}/-/releases/${encodeURIComponent(release.tag_name)}`
    : repoUrl;

  return {
    provider: "gitlab",
    syncTarget: canonicalPath,
    status: moved ? "moved" : "ok",
    moved,
    archived: Boolean(projData.archived),
    githubRepo: "",
    repoUrl,
    releaseUrl,
    apkUrl,
    recommendedUrl: apkUrl || releaseUrl || repoUrl,
    project: String(projData.name || parsed.project),
    developer: String(projData.namespace?.name || projData.namespace?.full_path || parsed.namespace),
    version,
    lastUpdate,
    link: projData.archived ? "Free (Gitlab - Archived)" : "Free (Gitlab)",
    description: String(projData.description || ""),
    checkedAt: new Date().toISOString(),
  };
}

async function inspectPlayStoreApp(appInput, budget = null) {
  const parsed = parsePlayStorePackage(appInput);
  if (!parsed) throw new Error("URL o ID de Google Play Store inválido.");

  if (budget) {
    budget.subrequests++;
    budget.playstore++;
  }

  const packageId = parsed.packageId;
  const storeUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}`;
  const fetchUrl = `${storeUrl}&hl=en&gl=US`;
  const res = await fetchWithTimeout(fetchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (res.status === 404 || res.status === 410) {
    return {
      provider: "playstore",
      status: "down",
      syncTarget: packageId,
      githubRepo: "",
      repoUrl: storeUrl,
      storeUrl,
      error: `App no disponible en Play Store (HTTP ${res.status}).`,
      checkedAt: new Date().toISOString(),
    };
  }
  if (!res.ok) {
    throw new Error(`Play Store HTTP ${res.status}`);
  }

  const html = await res.text();
  let appInfo = null;
  const cbRegex = /AF_initDataCallback\(\{key:\s*['"](ds:\d+)['"][\s\S]*?data:([\s\S]*?),\s*sideChannel:/g;
  for (const m of html.matchAll(cbRegex)) {
    if (m[1] !== "ds:5" && !m[2].includes(packageId)) continue;
    try {
      const parsedJson = JSON.parse(m[2]);
      const candidate = parsedJson?.[1]?.[2];
      if (Array.isArray(candidate) && (candidate?.[77]?.[0] === packageId || (m[1] === "ds:5" && candidate?.[0]?.[0]))) {
        appInfo = candidate;
        if (candidate?.[77]?.[0] === packageId) break;
      }
    } catch {
      // Continue scanning callbacks
    }
  }

  if (!appInfo) {
    throw new Error("No se pudieron leer los datos de la ficha en Google Play Store.");
  }

  const title = decodeHtmlEntities(String(appInfo?.[0]?.[0] || "").trim());
  const developer = decodeHtmlEntities(String(appInfo?.[37]?.[0] || appInfo?.[68]?.[0] || "").trim());

  const priceMicros = Number(appInfo?.[57]?.[0]?.[0]?.[0]?.[0]?.[1]?.[0]?.[0] || 0);
  const priceFormatted = String(appInfo?.[57]?.[0]?.[0]?.[0]?.[0]?.[1]?.[0]?.[2] || "").trim();
  const isPaid = priceMicros > 0 || Boolean(priceFormatted && !/^(\$?0(\.0+)?|free)$/i.test(priceFormatted));

  const rawVersion = String(appInfo?.[140]?.[0]?.[0]?.[0] || "").trim();
  const version = /^varies with device$/i.test(rawVersion) ? "" : rawVersion;

  const updatedTs = Number(appInfo?.[145]?.[0]?.[1]?.[0] || 0);
  const updatedText = String(appInfo?.[145]?.[0]?.[0] || "").trim();
  let lastUpdate = "";
  if (Number.isFinite(updatedTs) && updatedTs > 0) {
    lastUpdate = formatNaplDate(new Date(updatedTs * 1000).toISOString());
  } else if (updatedText) {
    const parsedDate = Date.parse(updatedText);
    if (!Number.isNaN(parsedDate)) {
      lastUpdate = formatNaplDate(new Date(parsedDate).toISOString());
    }
  }

  return {
    provider: "playstore",
    syncTarget: packageId,
    status: "ok",
    moved: false,
    archived: false,
    githubRepo: "",
    repoUrl: storeUrl,
    storeUrl,
    recommendedUrl: storeUrl,
    project: title || packageId,
    developer,
    version,
    lastUpdate,
    link: isPaid ? "Paid (Playstore)" : "Free (Playstore)",
    checkedAt: new Date().toISOString(),
  };
}

async function inspectPortSource(rawInput, env) {
  const value = String(rawInput || "").trim();
  if (!value) throw new Error("Ingresá una URL de GitHub, GitLab o Play Store.");
  if (parsePlayStorePackage(value)) {
    return inspectPlayStoreApp(value);
  }
  if (parseGitlabProject(value)) {
    return inspectGitlabProject(value, env);
  }
  if (parseGithubRepo(value)) {
    return inspectGithubRepo(value, env);
  }
  throw new Error("URL no reconocida. Usá enlaces de GitHub, GitLab o Google Play Store.");
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function resolveLaunchboxImageUrl(fileName) {
  const clean = String(fileName || "").trim().replace(/^\/+/, "");
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  if (clean.startsWith("r2_")) {
    return `https://gamesdb-images.launchbox.gg/${clean}`;
  }
  return `https://images.launchbox-app.com//${clean}`;
}

async function inspectLaunchboxUrl(rawUrl) {
  let targetUrl;
  try {
    targetUrl = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("URL de LaunchBox inválida.");
  }

  if (
    (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") ||
    targetUrl.hostname.toLowerCase() !== "gamesdb.launchbox-app.com"
  ) {
    throw new Error("Solo se permiten URLs de gamesdb.launchbox-app.com.");
  }

  const res = await fetch(targetUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(`LaunchBox respondió HTTP ${res.status}.`);
  }

  const html = await res.text();
  let name = "";
  let year = "";
  let genre = "";
  let description = "";
  let coverUrl = "";
  let developer = "";

  // 1. Primary extraction via Nuxt SSR __NUXT_DATA__ payload
  const nuxtMatch = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nuxtMatch) {
    try {
      const pool = JSON.parse(nuxtMatch[1]);
      const gameIdx = pool.findIndex(
        (item) => item && typeof item === "object" && !Array.isArray(item) && "gameGenres" in item && "gameImages" in item
      );
      if (gameIdx >= 0) {
        const resolveVal = (v, depth = 0) => {
          if (depth > 5) return v;
          if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < pool.length) {
            return resolveNode(pool[v], depth + 1);
          }
          return v;
        };
        const resolveNode = (node, depth = 0) => {
          if (Array.isArray(node)) return node.map((i) => resolveVal(i, depth));
          if (node && typeof node === "object") {
            const out = {};
            for (const [k, v] of Object.entries(node)) {
              out[k] = resolveVal(v, depth);
            }
            return out;
          }
          return node;
        };

        const game = resolveNode(pool[gameIdx], 0);
        name = String(game.name || "").trim();
        description = String(game.overview || "").trim();

        const rawYear = game.releaseYear || game.releaseDate || "";
        const yearMatch = String(rawYear).match(/\b(19\d\d|20\d\d)\b/);
        if (yearMatch) year = yearMatch[1];

        if (Array.isArray(game.gameGenres) && game.gameGenres.length) {
          genre = game.gameGenres
            .map((g) => String(g?.name || "").trim())
            .filter(Boolean)
            .slice(0, 2)
            .join(", ");
        }

        if (Array.isArray(game.gameDevelopers) && game.gameDevelopers.length) {
          developer = String(game.gameDevelopers[0]?.name || "").trim();
        }

        if (Array.isArray(game.gameImages) && game.gameImages.length) {
          const preferred =
            game.gameImages.find((img) => /box\s*-\s*front/i.test(String(img?.imageTypeName || ""))) ||
            game.gameImages.find((img) => /fanart|poster|clear logo/i.test(String(img?.imageTypeName || ""))) ||
            game.gameImages[0];
          if (preferred) {
            coverUrl = resolveLaunchboxImageUrl(
              preferred.fullGameImageFileName || preferred.imageFileName || ""
            );
          }
        }
      }
    } catch {
      // Fallback to HTML regex extraction below
    }
  }

  // 2. HTML Meta / Tag fallback
  if (!name) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) name = decodeHtmlEntities(h1[1].replace(/<[^>]+>/g, "")).trim();
  }
  if (!description) {
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (metaDesc) description = decodeHtmlEntities(metaDesc[1]).trim();
  }
  if (!year) {
    const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
    const ym = timeMatch && timeMatch[1].match(/\b(19\d\d|20\d\d)\b/);
    if (ym) year = ym[1];
  }
  if (!coverUrl) {
    const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImg) coverUrl = ogImg[1].trim();
  }

  if (!name) {
    throw new Error("No se pudieron leer los datos de esa ficha de LaunchBox.");
  }

  return {
    name,
    year,
    genre,
    description: description.replace(/\r\n/g, "\n").trim(),
    coverUrl,
    developer,
    launchboxUrl: targetUrl.toString(),
  };
}


async function syncSinglePortWithSource(env, port, budget = null) {
  const syncInfo = resolvePortSyncTarget(port);
  if (!syncInfo.provider || !syncInfo.target) return { portId: port.portId, status: "skipped", reason: "Sin fuente sincronizable", changed: false };
  const now = new Date().toISOString();
  const oldVersion = port.version;
  let info;
  if (syncInfo.provider === "playstore") info = await inspectPlayStoreApp(syncInfo.target, budget);
  else if (syncInfo.provider === "gitlab") {
    const target = /^https?:\/\//i.test(syncInfo.target) ? syncInfo.target : "https://gitlab.com/" + syncInfo.target.replace(/^\/+/, "");
    info = await inspectGitlabProject(target, env, budget);
  } else info = await inspectGithubRepo(syncInfo.target, env, budget);
  if (info.status === "down") {
    const downLabel = syncInfo.provider === "playstore" ? "App Down" : "Repo Down";
    const changed = port.githubStatus !== "down" || port.link !== downLabel || port.syncProvider !== syncInfo.provider || port.syncTarget !== syncInfo.target;
    Object.assign(port, { githubRepo: syncInfo.githubRepo || "", syncProvider: syncInfo.provider, syncTarget: syncInfo.target,
      githubStatus: "down", link: downLabel, lastCheckedAt: now });
    return { portId: port.portId, gameSlug: port.gameSlug || "", project: port.project, provider: syncInfo.provider,
      syncTarget: syncInfo.target, githubRepo: syncInfo.githubRepo, status: "down", changed, message: info.error };
  }
  const nextVersion = info.version || port.version;
  const nextLastUpdate = info.lastUpdate || port.lastUpdate;
  const nextLink = port.link === "Repo Down" || port.link === "App Down" || !port.link ||
    /github|gitlab|play\s*store|playstore/i.test(port.link) ? info.link : port.link;
  let nextUrl = port.url;
  if (syncInfo.provider === "github") {
    const parsed = parseGithubRepo(port.url);
    if (!nextUrl || info.moved || (parsed && info.apkUrl && /\/releases\/|github\.com/i.test(nextUrl))) nextUrl = info.repoUrl;
  } else if (syncInfo.provider === "gitlab") {
    const parsed = parseGitlabProject(port.url);
    if (!nextUrl || info.moved || (parsed && info.apkUrl && /\/releases\/|gitlab\.com/i.test(nextUrl))) nextUrl = info.apkUrl || info.repoUrl;
  } else if (syncInfo.provider === "playstore" && !nextUrl) nextUrl = info.storeUrl;
  const nextGithubRepo = syncInfo.provider === "github" ? info.githubRepo : "";
  const nextSyncTarget = info.syncTarget || syncInfo.target;
  const changed = nextVersion !== port.version || nextLastUpdate !== port.lastUpdate ||
    nextGithubRepo !== port.githubRepo || syncInfo.provider !== (port.syncProvider || "") ||
    nextSyncTarget !== (port.syncTarget || "") || nextUrl !== port.url || nextLink !== port.link ||
    port.githubStatus !== info.status;
  Object.assign(port, { githubRepo: nextGithubRepo, syncProvider: syncInfo.provider, syncTarget: nextSyncTarget,
    githubStatus: info.status, version: nextVersion, lastUpdate: nextLastUpdate, url: nextUrl, link: nextLink, lastCheckedAt: now });
  return { portId: port.portId, gameSlug: port.gameSlug || "", project: port.project || info.project,
    provider: syncInfo.provider, syncTarget: nextSyncTarget, githubRepo: nextGithubRepo, status: info.status,
    changed, oldVersion, newVersion: nextVersion, url: nextUrl, lastUpdate: nextLastUpdate };
}


async function readSyncStage(env) {
  const token = env.CATALOG_DATA_GITHUB_TOKEN;
  if (!token) throw new Error("Falta configurar CATALOG_DATA_GITHUB_TOKEN.");
  const apiPath = "/repos/" + DATA_REPO + "/contents/" + SYNC_STAGE_PATH + "?ref=" + DATA_BRANCH;
  const result = await ghFetch(apiPath, env, { token });
  if (result.res.status === 404) return { value: null, sha: "" };
  if (!result.res.ok) throw new Error(result.data.message || "No se pudo leer el progreso de sincronización.");
  return { value: JSON.parse(decodeGitHubBase64(result.data.content || "")), sha: result.data.sha || "" };
}

async function writeSyncStage(env, stage, sha) {
  return writeDataJsonFile(env, SYNC_STAGE_PATH, stage, sha, "NAPL: guardar progreso de revisión de fuentes");
}

async function runSyncBatch(env, options = {}) {
  const state = await readCatalogState(env);
  const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_CRON_BATCH, 1), MAX_SYNC_BATCH);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const source = options.source || "manual";
  const ports = state.catalog.games.flatMap((game) => (game.ports || []).map((port) => {
    const syncInfo = resolvePortSyncTarget(port);
    return syncInfo.provider && syncInfo.target
      ? { ...port, gameSlug: game.slug, _port: port, _syncInfo: syncInfo }
      : null;
  })).filter(Boolean);
  const ordered = options.useOffset
    ? ports.sort((a,b) => String(a.portId).localeCompare(String(b.portId))).slice(offset, offset + limit)
    : ports.sort((a,b) => String(a.lastCheckedAt || "").localeCompare(String(b.lastCheckedAt || "")) ||
      String(a.portId).localeCompare(String(b.portId))).slice(0, limit);
  const budget = { subrequests: 1, playstore: 0, startedAt: Date.now() };
  async function syncWithRetries(entry) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await syncWithRetries(entry);
      } catch (error) {
        const message = String(error?.message || error || "");
        const transient = /429|HTTP 5\\d\\d|timeout|timed out|network|fetch failed|aborted|rate limit|temporarily unavailable/i.test(message);
        if (!transient || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 400 * (2 ** attempt)));
      }
    }
    throw new Error("Source sync retry limit reached.");
  }
  if (options.stageOnly) {
    const loaded = await readSyncStage(env);
    let stage = offset > 0 ? loaded.value : null;
    if (offset > 0 && (!stage || stage.status !== "scanning")) {
      throw new Error("No hay una revisión pendiente para reanudar. Iniciá una nueva sincronización completa.");
    }
    if (!stage) {
      stage = { version: 1, status: "scanning", source, automation: Boolean(options.automation),
        startedAt: new Date().toISOString(), totalSyncPorts: ports.length, nextOffset: 0,
        checkedCount: 0, updatedCount: 0, downCount: 0, errorCount: 0,
        updates: {}, checkedAt: {}, details: [] };
    }
    if (stage.totalSyncPorts !== ports.length) {
      throw new Error("El catálogo cambió durante la revisión. Recargá el panel e iniciá una nueva sincronización.");
    }
    if (offset !== Number(stage.nextOffset || 0)) {
      throw new Error("El punto de reanudación no coincide con el progreso guardado. Consultá el estado de sincronización.");
    }
    stage.checkedAt = stage.checkedAt || {};
    let checkedCount = 0, updatedCount = 0, downCount = 0, errorCount = 0;
    const details = [];
    const mutableKeys = ["githubRepo","syncProvider","syncTarget","githubStatus","version","lastUpdate","url","link"];
    const actionRunner = env.GITHUB_ACTIONS === "true";
    const maxSubrequests = actionRunner ? 500 : MAX_SUBREQUESTS_PER_RUN;
    const maxElapsed = actionRunner ? 600000 : SYNC_ELAPSED_BUDGET_MS;
    const maxPlaystore = actionRunner ? limit : MAX_PLAYSTORE_PER_RUN;
    const candidates = [];
    let playstoreCandidates = 0;
    for (const entry of ordered) {
      if (entry._syncInfo.provider === "playstore" && playstoreCandidates >= maxPlaystore) break;
      if (entry._syncInfo.provider === "playstore") playstoreCandidates++;
      candidates.push(entry);
    }
    let cursor = 0;
    const concurrency = actionRunner ? Math.min(Math.max(Number(env.SYNC_CONCURRENCY) || 4, 1), 8) : 1;
    async function processEntry(entry) {
      checkedCount++;
      const originalVersion = entry.version;
      try {
        const outcome = await syncWithRetries(entry);
        stage.checkedAt[entry.portId] = entry.lastCheckedAt || new Date().toISOString();
        if (outcome.status === "down") downCount++;
        if (outcome.changed) {
          updatedCount++;
          outcome.oldVersion = originalVersion;
          details.push(outcome);
          const patch = {};
          for (const key of mutableKeys) patch[key] = entry[key] ?? entry._port[key] ?? "";
          stage.updates[entry.portId] = patch;
        }
      } catch (error) {
        errorCount++;
        stage.checkedAt[entry.portId] = new Date().toISOString();
        details.push({ portId: entry.portId, gameSlug: entry.gameSlug, project: entry.project,
          provider: entry._syncInfo.provider, status: "error",
          error: error?.message || "Error consultando fuente externa" });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
      while (true) {
        if (budget.subrequests >= maxSubrequests || (Date.now() - budget.startedAt) >= maxElapsed) break;
        const index = cursor++;
        if (index >= candidates.length) break;
        await processEntry(candidates[index]);
      }
    }));
    const now = new Date().toISOString();
    stage.checkedCount += checkedCount;
    stage.updatedCount += updatedCount;
    stage.downCount += downCount;
    stage.errorCount += errorCount;
    stage.nextOffset = offset + checkedCount;
    stage.details = [...(stage.details || []), ...details].slice(-300);
    if (stage.nextOffset >= ports.length) {
      stage.status = "completed";
      stage.completedAt = now;
    }
    delete stage.lastError;
    delete stage.lastErrorAt;
    delete stage.lastErrorOffset;
    const savedStage = await writeSyncStage(env, stage, loaded.sha);
    return { source, staged: true, stageStatus: stage.status, totalSyncPorts: ports.length,
      checkedCount, updatedCount, downCount, errorCount, nextOffset: stage.nextOffset,
      hasMore: stage.status !== "completed", details, syncedAt: now, stageCommit: savedStage.commit || "" };
  }

  let checkedCount = 0, updatedCount = 0, downCount = 0, errorCount = 0;
  const details = [];
  for (const entry of ordered) {
    if (budget.subrequests >= MAX_SUBREQUESTS_PER_RUN || (Date.now() - budget.startedAt) >= SYNC_ELAPSED_BUDGET_MS) {
      break;
    }
    if (entry._syncInfo.provider === "playstore" && budget.playstore >= MAX_PLAYSTORE_PER_RUN) {
      if (options.useOffset) break;
      continue;
    }
    checkedCount++;
    const originalVersion = entry.version;
    try {
      const outcome = await syncWithRetries(entry);
      const target = entry._port;
      for (const key of ["githubRepo","syncProvider","syncTarget","githubStatus","version","lastUpdate","url","link","lastCheckedAt"]) {
        target[key] = entry[key] ?? target[key] ?? "";
      }
      if (outcome.status === "down") downCount++;
      if (outcome.changed) {
        updatedCount++;
        outcome.oldVersion = originalVersion;
        details.push(outcome);
      }
    } catch (error) {
      errorCount++;
      entry._port.lastCheckedAt = new Date().toISOString();
      details.push({ portId: entry.portId, gameSlug: entry.gameSlug, project: entry.project,
        provider: entry._syncInfo.provider, status: "error",
        error: error?.message || "Error consultando fuente externa" });
    }
  }
  const now = new Date().toISOString();
  state.meta.last_sync_at = now;
  if (updatedCount > 0) {
    state.catalog.updatedAt = now;
    state.meta.updated_at = now;
    state.meta.pending_github_sync = "1";
  }
  const lastId = Math.max(0, ...state.syncLogs.map((log) => Number(log.id) || 0));
  state.syncLogs.unshift({ id: lastId + 1, source, checkedCount, updatedCount, downCount, errorCount,
    summary: details.slice(0, 40), createdAt: now });
  state.syncLogs = state.syncLogs.slice(0, 12);
  let autoPublishedCommit = "", autoPublishedDataCommit = "";
  if (source === "cron" && (updatedCount > 0 || state.meta.pending_github_sync === "1")) {
    const published = await publishSavedCatalog(env, state);
    autoPublishedCommit = published.commit || "";
    autoPublishedDataCommit = published.dataCommit || "";
  } else {
    await saveCatalogState(env, state, "NAPL: registrar sincronización " + source);
  }
  const result = { source, totalSyncPorts: ports.length, totalGithubPorts: ports.length, checkedCount, updatedCount,
    downCount, errorCount, nextOffset: offset + checkedCount,
    hasMore: Boolean(options.useOffset && offset + checkedCount < ports.length),
    autoPublishedCommit, autoPublishedDataCommit, details, syncedAt: now };
  if (options.returnState) return { sync: result, state };
  return result;
}

async function applyStagedSync(env) {
  const loaded = await readSyncStage(env);
  const stage = loaded.value;
  if (!stage || stage.status !== "completed") {
    throw new Error("La revisión completa todavía no terminó. No hay actualizaciones listas para aplicar.");
  }
  const state = await readCatalogState(env);
  const portsById = new Map();
  for (const game of state.catalog.games) for (const port of game.ports || []) portsById.set(port.portId, port);
  let appliedCount = 0;
  for (const [portId, patch] of Object.entries(stage.updates || {})) {
    const port = portsById.get(portId);
    if (!port) continue;
    Object.assign(port, patch);
    appliedCount++;
  }
  for (const [portId, checkedAt] of Object.entries(stage.checkedAt || {})) {
    const port = portsById.get(portId);
    if (port && checkedAt) port.lastCheckedAt = checkedAt;
  }
  const now = new Date().toISOString();
  state.meta.last_sync_at = now;
  if (appliedCount) {
    state.catalog.updatedAt = now;
    state.meta.updated_at = now;
    state.meta.pending_github_sync = "1";
  }
  const lastId = Math.max(0, ...state.syncLogs.map((log) => Number(log.id) || 0));
  state.syncLogs.unshift({ id: lastId + 1, source: stage.source || "manual", checkedCount: stage.checkedCount || 0,
    updatedCount: appliedCount, downCount: stage.downCount || 0, errorCount: stage.errorCount || 0,
    summary: (stage.details || []).filter((item) => item.status === "down" || item.changed).slice(0, 40),
    createdAt: now });
  state.syncLogs = state.syncLogs.slice(0, 12);
  await saveCatalogState(env, state, "NAPL: aplicar actualizaciones revisadas de fuentes");
  const cleared = { version: 1, status: "applied", appliedAt: now, checkedCount: stage.checkedCount || 0,
    updatedCount: appliedCount, downCount: stage.downCount || 0, errorCount: stage.errorCount || 0,
    nextOffset: stage.totalSyncPorts || 0, totalSyncPorts: stage.totalSyncPorts || 0, updates: {}, details: [] };
  await writeSyncStage(env, cleared, loaded.sha);
  return { success: true, appliedCount, stage: cleared, ...catalogStateResponse(state) };
}


async function publishSavedCatalog(env, state) {
  const now = new Date().toISOString();
  try {
    state = state || await readCatalogState(env);
    const publicCatalog = toPublicCatalog(state.catalog);
    const dataPub = await ghCommitDataCatalog(publicCatalog, env, "NAPL: publicar catálogo JSON desde estado interno");
    state.meta.pending_github_sync = "0";
    state.meta.last_github_publish_at = now;
    state.meta.last_pages_publish_at = now;
    state.meta.last_pages_publish_error = "";
    await saveCatalogState(env, state, "NAPL: confirmar publicación del catálogo");
    return { commit: "", dataCommit: dataPub.commit || "", dataPublishError: "", publishError: "", state: catalogStateResponse(state) };
  } catch (error) {
    if (state) {
      state.meta.pending_github_sync = "1";
      state.meta.last_pages_publish_error = error?.message || "Error publicando el catálogo.";
      try { await saveCatalogState(env, state, "NAPL: registrar publicación pendiente"); } catch {}
    }
    return { commit: "", dataCommit: "", dataPublishError: error?.message || "No se pudo publicar en NAPL-Data.",
      publishError: "", state: state ? catalogStateResponse(state) : null };
  }
}




function toPublicCatalog(catalog) {
  return {
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    platformOrder: catalog.platformOrder,
    games: catalog.games.map((game) => ({
      name: game.name,
      slug: game.slug,
      popularityKey: game.popularityKey || slugify(game.name),
      year: game.year,
      coverUrl: game.coverUrl,
      genre: game.genre,
      description: game.description,
      platform: game.platform,
      ...(game.launchboxUrl ? { launchboxUrl: game.launchboxUrl } : {}),
      ports: game.ports.map((port) => {
        const publicPort = {
          portId: port.portId, project: port.project, developer: port.developer,
          year: port.year, version: port.version, controller: port.controller,
          files: port.files, works: port.works, link: port.link, url: port.url,
          dataUrl: port.dataUrl, lastUpdate: port.lastUpdate, dateAdded: port.dateAdded,
          notes: port.notes,
        };
        if (port.githubRepo) publicPort.githubRepo = port.githubRepo;
        return publicPort;
      }),
    })),
  };
}



async function route(req, env) {
  const url = new URL(req.url), path = url.pathname, headers = cors(req, env);
  const origin = req.headers.get("Origin") || "";
  if (path === "/api/public-catalog" && req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env, true) });
  if (path === "/api/public-catalog" && req.method === "GET") return new Response(null, { status: 302, headers: {
    ...cors(req, env, true), Location: "https://napl-catalog.pages.dev/assets/data/catalog.json", "Cache-Control": "public, max-age=30"
  }});
  if (req.method === "OPTIONS") {
    const okOrigin = !origin || isAllowedOrigin(origin, env);
    return new Response(null, { status: okOrigin ? 204 : 403, headers });
  }
  if (origin && !isAllowedOrigin(origin, env)) return json({ error: "Origen no autorizado." }, 403, headers);
  if (path === "/api/health" && req.method === "GET") {
    const health = {
      ok: true, localMode: false, storage: "github-json", d1: false,
      configured: { adminPassword: Boolean(env.ADMIN_PASSWORD), githubToken: Boolean(env.GITHUB_TOKEN),
        dataGithubToken: Boolean(env.CATALOG_DATA_GITHUB_TOKEN), sessionSecret: Boolean(env.SESSION_SECRET), d1: false }
    };
    try {
      const state = await readCatalogState(env);
      health.storageStatus = "ok";
      health.catalog = { games: state.catalog.games.length,
        ports: state.catalog.games.reduce((sum, game) => sum + (game.ports || []).length, 0) };
    } catch (error) {
      health.storageStatus = "error";
      health.storageError = error?.message || "No se pudo leer el estado JSON.";
      health.ok = false;
    }
    return json(health, health.ok ? 200 : 503, headers);
  }
  if (path === "/api/login" && req.method === "POST") {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ error: "Faltan secretos ADMIN_PASSWORD o SESSION_SECRET en Cloudflare." }, 503, headers);
    const body = await req.json().catch(() => ({}));
    if (!equal(String(body.password || ""), env.ADMIN_PASSWORD)) return json({ error: "Contraseña incorrecta." }, 401, headers);
    return json({ token: await sessionToken(env), expiresIn: SESSION_TTL }, 200, headers);
  }
  if (path === "/api/logout" && req.method === "POST") return json({ success: true }, 200, headers);
  if (!path.startsWith("/api/")) return json({ name: "NAPL JSON Catalog Worker", ok: true }, 200, headers);
  if (!(await authenticated(req, env))) return json({ error: "Sesión inválida o vencida. Iniciá sesión nuevamente." }, 401, headers);
  if (path === "/api/verify-session" && req.method === "GET") return json({ ok: true }, 200, headers);
  if (path === "/api/sync-queue" && req.method === "POST") {
    if (!env.SYNC_QUEUE) return json({ error: "La cola de sincronización no está configurada." }, 503, headers);
    const loaded = await readSyncStage(env);
    const stage = loaded.value;
    if (stage?.status === "completed") return json({ success: true, queued: false, stage }, 200, headers);
    const body = await req.json().catch(() => ({}));
    const offset = stage?.status === "scanning" ? Number(stage.nextOffset || 0) : 0;
    await env.SYNC_QUEUE.send({ offset, testOnly: Boolean(body.testOnly) });
    return json({ success: true, queued: true, offset, stage: stage || null }, 202, headers);
  }
  if (path === "/api/sync-stage" && req.method === "GET") {
    const loaded = await readSyncStage(env);
    return json({ success: true, stage: loaded.value || null }, 200, headers);
  }
  if (path === "/api/sync-apply" && req.method === "POST") {
    const result = await applyStagedSync(env);
    return json(result, 200, headers);
  }
  if (path === "/api/catalog" && req.method === "GET") {
    const state = await readCatalogState(env), data = catalogStateResponse(state);
    return json({ ...data, exists: data.catalog.games.length > 0 }, 200, headers);
  }
  if (path === "/api/games" && req.method === "POST") {
    const state = await readCatalogState(env), body = await req.json().catch(() => ({}));
    const saved = await saveSingleGameInJson(state, null, body.game || body, true);
    await saveCatalogState(env, state, "NAPL: guardar juego y ports en catálogo privado");
    return json({ success: true, saved, ...catalogStateResponse(state) }, 200, headers);
  }
  const gameMatch = path.match(/^\/api\/games\/([^/]+)$/);
  if (gameMatch) {
    const slug = decodeURIComponent(gameMatch[1]);
    if (req.method === "PUT") {
      const state = await readCatalogState(env), body = await req.json().catch(() => ({}));
      const saved = await saveSingleGameInJson(state, slug, body.game || body, false);
      await saveCatalogState(env, state, "NAPL: editar juego y ports en catálogo privado");
      return json({ success: true, saved, ...catalogStateResponse(state) }, 200, headers);
    }
    if (req.method === "DELETE") {
      const state = await readCatalogState(env), removed = deleteGameFromJson(state, slug);
      await saveCatalogState(env, state, "NAPL: eliminar juego del catálogo privado");
      return json({ success: true, removed, ...catalogStateResponse(state) }, 200, headers);
    }
  }
  if (path === "/api/lookup/github" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return json({ success: true, github: await inspectGithubRepo(body.url || body.repo, env) }, 200, headers);
  }
  if (path === "/api/lookup/source" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return json({ success: true, source: await inspectPortSource(body.url || body.repo || body.target, env) }, 200, headers);
  }
  if (path === "/api/lookup/launchbox" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return json({ success: true, launchbox: await inspectLaunchboxUrl(body.url) }, 200, headers);
  }
  if (path === "/api/ports/sync" && req.method === "POST") {
    const state = await readCatalogState(env), body = await req.json().catch(() => ({}));
    const portId = String(body.portId || "").trim();
    if (!portId) return json({ error: "portId requerido." }, 400, headers);
    let target = null;
    for (const game of state.catalog.games) {
      const port = (game.ports || []).find((item) => item.portId === portId);
      if (port) { target = { game, port }; break; }
    }
    if (!target) return json({ error: "Port no encontrado en el catálogo JSON." }, 404, headers);
    target.port.gameSlug = target.game.slug;
    const result = await syncSinglePortWithSource(env, target.port);
    delete target.port.gameSlug;
    if (result.changed) {
      const now = new Date().toISOString();
      state.catalog.updatedAt = now; state.meta.updated_at = now; state.meta.pending_github_sync = "1";
    }
    await saveCatalogState(env, state, "NAPL: sincronizar port individual");
    return json({ success: true, result, ...catalogStateResponse(state) }, 200, headers);
  }
  if ((path === "/api/sync-github" || path === "/api/sync-sources") && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { sync, state } = await runSyncBatch(env, {
      source: "manual",
      limit: body.limit || DEFAULT_CRON_BATCH,
      offset: body.offset || 0,
      useOffset: Boolean(body.useOffset),
      stageOnly: Boolean(body.stageOnly),
      returnState: true,
    });
    const compact = body.includeCatalog === false || body.compact === true;
    const statePayload = compact
      ? { meta: state.meta, stats: catalogStats(state), syncLogs: state.syncLogs.slice(0, 12) }
      : catalogStateResponse(state);
    return json({ success: true, sync, ...statePayload }, 200, headers);
  }
  if (path === "/api/import-sheets" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const state = await readCatalogState(env);
    const res = await fetchWithTimeout(SHEET_URL, { headers: { Accept: "text/csv" } }, 10000);
    if (!res.ok) throw new Error("Google Sheets HTTP " + res.status);
    const csv = await res.text(), rows = csvParse(csv);
    if (!rows.length) throw new Error("CSV vacío.");
    const imported = fromRows(rows);
    if (!imported.games.length) throw new Error("No se encontraron juegos válidos.");
    const oldGames = state.catalog.games;
    const oldSet = new Set();
    const oldPorts = new Map();
    const oldGamesBySlug = new Map();
    const oldGamesByName = new Map();
    const oldGamesByPortId = new Map();
    for (const game of oldGames) {
      oldSet.add(game.slug);
      oldGamesBySlug.set(game.slug, game);
      const nKey = norm(game.name);
      if (nKey && !oldGamesByName.has(nKey)) oldGamesByName.set(nKey, game);
      for (const p of game.ports || []) {
        oldPorts.set(p.portId, p);
        oldGamesByPortId.set(p.portId, game);
      }
    }
    const newSet = new Set(imported.games.map((g) => g.slug));
    let totalPorts = 0;
    let addedGames = 0;
    for (const game of imported.games) {
      if (!oldSet.has(game.slug)) addedGames++;
      let oldGame = oldGamesBySlug.get(game.slug) || oldGamesByName.get(norm(game.name)) || null;
      if (!oldGame) {
        for (const port of game.ports || []) {
          const found = oldGamesByPortId.get(port.portId);
          if (found) {
            oldGame = found;
            break;
          }
        }
      }
      if (!game.popularityKey) game.popularityKey = oldGame?.popularityKey || slugify(oldGame?.name || game.name);
      if (oldGame) {
        game.steamUrl = oldGame.steamUrl || "";
        game.sortOrder = oldGame.sortOrder;
        game.sourceUpdatedAt = oldGame.sourceUpdatedAt || "";
      }
      game.ports = (game.ports || []).map((port, index) => {
        if (!port.portId) port.portId = game.slug + "-port-" + (index + 1);
        const old = oldPorts.get(port.portId);
        return old ? { ...port,
          platform: old.platform || "", slug: old.slug || "", launchboxUrl: old.launchboxUrl || "",
          launchboxName: old.launchboxName || "", coverUrl: old.coverUrl || "", genre: old.genre || "",
          description: old.description || "", githubEtag: old.githubEtag || "", sortOrder: old.sortOrder,
          githubRepo: old.githubRepo || "", syncProvider: old.syncProvider || "",
          syncTarget: old.syncTarget || "", githubStatus: old.githubStatus || "", lastCheckedAt: old.lastCheckedAt || ""
        } : port;
      });
      totalPorts += game.ports.length;
    }
    let removedGames = 0;
    for (const oldSlug of oldSet) {
      if (!newSet.has(oldSlug)) removedGames++;
    }
    state.catalog = imported; state.meta.updated_at = imported.updatedAt; state.meta.pending_github_sync = "1";
    await saveCatalogState(env, state, "NAPL: importar catálogo desde Google Sheets");
    const compact = body.includeCatalog === false || body.compact === true;
    const statePayload = compact
      ? { meta: state.meta, stats: catalogStats(state), syncLogs: state.syncLogs.slice(0, 12) }
      : catalogStateResponse(state);
    return json({ ...statePayload, summary: {
      csvRows: rows.length, games: imported.games.length, ports: totalPorts,
      addedGames, removedGames, characters: csv.length
    }}, 200, headers);
  }
  if (path === "/api/publish" && req.method === "POST") {
    const state = await readCatalogState(env), publication = await publishSavedCatalog(env, state);
    return json({ success: !publication.dataPublishError, commit: publication.commit || "", dataCommit: publication.dataCommit || "",
      dataPublishError: publication.dataPublishError || "", publishError: publication.publishError || "", ...(publication.state || {}) }, 200, headers);
  }
  return json({ error: "Ruta no encontrada." }, 404, headers);
}

async function recordSyncQueueFailure(env, error, message) {
  const failure = { at: new Date().toISOString(), message: String(error?.message || error || "Error desconocido").slice(0, 1200),
    offset: Number(message?.body?.offset || 0), attempts: Number(message?.attempts || 0), messageId: String(message?.id || "") };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const loaded = await readSyncStage(env);
      if (!loaded.value || loaded.value.status === "completed") return false;
      const stage = loaded.value;
      stage.lastError = failure; stage.lastErrorAt = failure.at; stage.lastErrorOffset = failure.offset;
      await writeSyncStage(env, stage, loaded.sha);
      return true;
    } catch (persistError) { console.error("NAPL could not persist queue failure:", persistError?.message || persistError); }
  }
  return false;
}

async function consumeSyncQueue(batch, env) {
  for (const message of batch.messages) {
    let offset = Number(message.body?.offset || 0);
    try {
      if (!env.SYNC_QUEUE) throw new Error("Falta el binding SYNC_QUEUE.");
      const loaded = await readSyncStage(env); const stage = loaded.value;
      if (stage?.status === "completed") { message.ack(); continue; }
      if (stage?.status === "applied" && message.body?.autoPublish) { message.ack(); continue; }
      const savedOffset = stage?.status === "scanning" ? Number(stage.nextOffset || 0) : 0;
      if (savedOffset > offset) offset = savedOffset;
      if (savedOffset < offset) throw new Error("La tarea de cola está adelantada respecto al progreso guardado.");
      const automated = Boolean(message.body?.autoPublish);
      const result = await runSyncBatch(env, {
        source: automated ? "cron" : "manual", automation: automated,
        limit: 10, offset, useOffset: true, stageOnly: true,
      });
      if (result.hasMore && !message.body?.testOnly) {
        await env.SYNC_QUEUE.send({ offset: result.nextOffset, autoPublish: automated });
      } else if (automated && result.stageStatus === "completed") {
        await applyStagedSync(env);
        const state = await readCatalogState(env);
        if (state.meta.pending_github_sync === "1") {
          const published = await publishSavedCatalog(env, state);
          if (published.dataPublishError) console.error("NAPL automatic publish pending:", published.dataPublishError);
        }
      }
      message.ack();
    } catch (error) {
      const failure = { offset, attempts: Number(message?.attempts || 0), id: String(message?.id || ""), error: String(error?.message || error || "Error desconocido") };
      console.error("NAPL queued sync task failed:", JSON.stringify(failure));
      await recordSyncQueueFailure(env, error, { id: message.id, attempts: message.attempts, body: { ...(message.body || {}), offset } });
      message.retry({ delaySeconds: 30 });
    }
  }
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      return json(
        { error: error?.message || "Error interno." },
        500,
        cors(request, env)
      );
    }
  },

  async queue(batch, env) {
    await consumeSyncQueue(batch, env);
  },

  async scheduled(event, env, ctx) {
    const cron = String(event?.cron || "");
    if (cron === "0 */2 * * *") {
      ctx.waitUntil((async () => {
        if (!env.SYNC_QUEUE) throw new Error("Falta el binding SYNC_QUEUE.");
        let loaded = await readSyncStage(env);
        let stage = loaded.value;
        if (stage?.status === "scanning") {
          console.log("NAPL automatic sync skipped: a sync is already running.");
          return;
        }
        if (stage?.status === "completed") {
          await applyStagedSync(env);
          const previousState = await readCatalogState(env);
          if (previousState.meta.pending_github_sync === "1") await publishSavedCatalog(env, previousState);
        }
        await env.SYNC_QUEUE.send({ offset: 0, autoPublish: true });
        console.log("NAPL full catalog sync queued.");
      })().catch((error) => {
        console.error("NAPL scheduled full sync failed:", error?.message || error);
      }));
      return;
    }
    if (cron === "0 * * * *") {
      ctx.waitUntil((async () => {
        const loaded = await readSyncStage(env);
        if (loaded.value?.status === "scanning") return;
        const state = await readCatalogState(env);
        if (state.meta.pending_github_sync === "1") {
          const published = await publishSavedCatalog(env, state);
          if (published.dataPublishError) console.error("NAPL hourly publish pending:", published.dataPublishError);
        }
      })().catch((error) => {
        console.error("NAPL hourly publish failed:", error?.message || error);
      }));
    }
  },
};