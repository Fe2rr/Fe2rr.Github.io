import crypto from "node:crypto";
import {
  parseGithubRepo,
  parseGitlabProject,
  parsePlayStorePackage,
  resolvePortSyncTarget,
} from "../public/js/lib/source-parsers.js";

export {
  parseGithubRepo,
  parseGitlabProject,
  parsePlayStorePackage,
  resolvePortSyncTarget,
};

export const DATA_REPO = process.env.NAPL_DATA_REPO || "Fe2rr/NAPL-Data";
export const DATA_BRANCH = process.env.NAPL_DATA_BRANCH || "main";
export const SHEET_URL =
  process.env.NAPL_SHEET_URL ||
  "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";

const UPSTREAM_TIMEOUT_MS = 10000;
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

const normHeadCache = new Map();
const normCache = new Map();
const slugifyCache = new Map();
const NORM_CACHE_MAX = 4096;

export function normHead(v) {
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

export function norm(v) {
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

export function slugify(v) {
  const raw = String(v || "");
  const cached = slugifyCache.get(raw);
  if (cached !== undefined) return cached;
  const out = norm(raw).replace(/\s+/g, "-");
  if (slugifyCache.size >= NORM_CACHE_MAX) slugifyCache.clear();
  slugifyCache.set(raw, out);
  return out;
}

export function formatNaplDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function gitBlobSha(content) {
  const bytes = Buffer.from(String(content), "utf8");
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return crypto
    .createHash("sha1")
    .update(header)
    .update(bytes)
    .digest("hex");
}

function fetchWithTimeout(url, init = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const options = { ...init };
  if (
    !options.signal &&
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    options.signal = AbortSignal.timeout(timeoutMs);
  }
  return fetch(url, options);
}

export function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function csvParse(csv) {
  const rows = [];
  let row = [];
  let buf = "";
  let start = 0;
  let q = false;
  const len = csv.length;

  for (let i = 0; i < len; i++) {
    const code = csv.charCodeAt(i);
    if (code === 34) {
      if (i > start) buf += csv.slice(start, i);
      if (q && csv.charCodeAt(i + 1) === 34) {
        buf += '"';
        i++;
      } else {
        q = !q;
      }
      start = i + 1;
    } else if (!q && (code === 44 || code === 10 || code === 13)) {
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

export function fromRows(rows) {
  let currentGame = "";
  let currentYear = "";
  let currentPlatform = "";
  const platforms = new Map();
  const groups = new Map();

  for (const row of rows) {
    const gv = col(row, ["GAME", "GAME NAME", "NAME", "JUEGO"]);
    const yv = col(row, ["YEAR", "ANO", "AÑO"]);
    const platformValue = col(row, ["PLATFORM", "PLATAFORM", "PLATAFORMA"]);
    if (gv) currentGame = gv;
    if (yv) currentYear = yv;
    if (platformValue) currentPlatform = platformValue;
    if (!currentGame) continue;

    const platform = currentPlatform;
    if (
      platform &&
      norm(platform) !== "multi game apps" &&
      !platforms.has(norm(platform))
    ) {
      platforms.set(norm(platform), platform);
    }

    const key = `${norm(currentGame)}|${norm(platform)}`;
    const sourcePopularityKey = col(row, [
      "POPULARITY_KEY",
      "POPULARITY KEY",
      "POPULARITY ID",
      "POPULARITY_ID",
    ]);

    if (!groups.has(key)) {
      groups.set(key, {
        name: currentGame,
        platform,
        year: currentYear || "",
        popularityKey: sourcePopularityKey,
        coverUrl: "",
        genre: "",
        description: "",
        launchboxUrl: "",
        ports: [],
      });
    }

    const g = groups.get(key);
    if (!g.year && currentYear) g.year = currentYear;
    if (!g.popularityKey && sourcePopularityKey) {
      g.popularityKey = sourcePopularityKey;
    }
    const lb = col(row, ["LAUNCHBOX_URL", "LAUNCHBOX URL"]);
    if (!g.launchboxUrl && lb) g.launchboxUrl = lb;

    for (const [field, names] of [
      [
        "coverUrl",
        ["COVER_URL", "COVER URL", "COVER", "COVER IMAGE", "IMAGE URL", "PORTADA"],
      ],
      ["genre", ["GENRE", "GÉNERO", "GENERO"]],
      ["description", ["DESCRIPTION", "DESCRIPCIÓN", "DESCRIPCION"]],
    ]) {
      const v = col(row, names);
      if (!g[field] && v) g[field] = v;
    }

    const url = col(row, ["URL", "PORT URL", "PORT LINK"]);
    const link = col(row, ["LINK", "PROJECT LINK", "ENLACE"]);
    const syncInfo = resolvePortSyncTarget({ url, link });
    const p = {
      portId: col(row, ["PORTS_ID", "PORT ID", "PORT_ID"]),
      project: col(row, ["PROJECT", "PROYECTO"]),
      developer: col(row, ["DEVELOPER", "DEVELOPER/PUBLISHER", "DESARROLLADOR"]),
      year: currentYear,
      version: col(row, ["VERSION", "VERSIÓN"]),
      controller: col(row, ["CONTROLLER SUPPORT", "CONTROLLER", "GAMEPAD", "MANDO"]),
      files: col(row, [
        "NEEDS GAME FILES?",
        "NEEDS GAME FILES",
        "GAME FILES",
        "NECESITA ARCHIVOS",
      ]),
      works: col(row, ["WORKS?", "WORKS", "FUNCIONA"]),
      link,
      url,
      dataUrl: col(row, ["DATA URL", "DATA LINK", "GAME FILES URL"]),
      githubRepo: syncInfo.githubRepo,
      syncProvider: syncInfo.provider,
      syncTarget: syncInfo.target,
      lastUpdate: col(row, ["LAST UPDATE", "LAST UPDATED", "ÚLTIMA ACTUALIZACIÓN"]),
      dateAdded: col(row, ["DATE ADDED"]),
      notes: col(row, ["NOTES", "NOTE", "NOTAS"]),
    };

    if (/^unofficial-port(?:-\d+)?$/i.test(p.portId)) {
      p.portId = `${slugify(currentGame)}-${p.portId.toLowerCase()}`;
    }

    if (
      Object.entries(p).some(([k, v]) => k !== "year" && String(v || "").trim())
    ) {
      g.ports.push(p);
    }
  }

  const seen = new Set();
  const games = Array.from(groups.values()).map((g) => {
    const base = `${slugify(g.name)}-${slugify(g.platform) || "sin-plataforma"}`;
    let n = 1;
    let slug = `${base}-${n}`;
    while (seen.has(slug)) slug = `${base}-${++n}`;
    seen.add(slug);
    return {
      ...g,
      slug,
      popularityKey: String(g.popularityKey || "").trim(),
    };
  });

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    platformOrder: Array.from(platforms.values()),
    games,
  };
}

export function mergeImportedCatalog(state, imported) {
  const oldGames = state.catalog?.games || [];
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
    let oldGame =
      oldGamesBySlug.get(game.slug) ||
      oldGamesByName.get(norm(game.name)) ||
      null;
    if (!oldGame) {
      for (const port of game.ports || []) {
        const found = oldGamesByPortId.get(port.portId);
        if (found) {
          oldGame = found;
          break;
        }
      }
    }

    if (!game.popularityKey) {
      game.popularityKey =
        oldGame?.popularityKey || slugify(oldGame?.name || game.name);
    }
    if (oldGame) {
      game.steamUrl = oldGame.steamUrl || "";
      game.sortOrder = oldGame.sortOrder;
      game.sourceUpdatedAt = oldGame.sourceUpdatedAt || "";
    }

    game.ports = (game.ports || []).map((port, index) => {
      if (!port.portId) port.portId = `${game.slug}-port-${index + 1}`;
      const old = oldPorts.get(port.portId);
      return old
        ? {
            ...port,
            platform: old.platform || "",
            slug: old.slug || "",
            launchboxUrl: old.launchboxUrl || "",
            launchboxName: old.launchboxName || "",
            coverUrl: old.coverUrl || "",
            genre: old.genre || "",
            description: old.description || "",
            githubEtag: old.githubEtag || "",
            sortOrder: old.sortOrder,
            githubRepo: old.githubRepo || "",
            syncProvider: old.syncProvider || "",
            syncTarget: old.syncTarget || "",
            githubStatus: old.githubStatus || "",
            lastCheckedAt: old.lastCheckedAt || "",
          }
        : port;
    });
    totalPorts += game.ports.length;
  }

  let removedGames = 0;
  for (const oldSlug of oldSet) {
    if (!newSet.has(oldSlug)) removedGames++;
  }

  return {
    imported,
    summary: {
      games: imported.games.length,
      ports: totalPorts,
      addedGames,
      removedGames,
    },
  };
}

export function toPublicCatalog(catalog) {
  return {
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    platformOrder: catalog.platformOrder,
    games: (catalog.games || []).map((game) => ({
      name: game.name,
      slug: game.slug,
      year: game.year,
      coverUrl: game.coverUrl,
      genre: game.genre,
      description: game.description,
      platform: game.platform,
      ...(game.launchboxUrl ? { launchboxUrl: game.launchboxUrl } : {}),
      ...(game.steamUrl ? { steamUrl: game.steamUrl } : {}),
      ports: (game.ports || []).map((port) => {
        const publicPort = {
          portId: port.portId,
          project: port.project,
          developer: port.developer,
          year: port.year,
          version: port.version,
          controller: port.controller,
          files: port.files,
          works: port.works,
          link: port.link,
          url: port.url,
          dataUrl: port.dataUrl,
          lastUpdate: port.lastUpdate,
          dateAdded: port.dateAdded,
          notes: port.notes,
        };
        if (port.githubRepo) publicPort.githubRepo = port.githubRepo;
        return publicPort;
      }),
    })),
  };
}

async function ghFetch(apiPath, env = {}, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "NAPL-Catalog-Sync/3.0",
    ...(options.headers || {}),
  };
  const token = options.token || env.GITHUB_TOKEN || env.CATALOG_DATA_GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchWithTimeout(
    `https://api.github.com${apiPath}`,
    {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    options.timeoutMs || UPSTREAM_TIMEOUT_MS
  );
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { res, data };
}

export async function inspectGithubRepo(repoSlug, env = {}) {
  const parsed = parseGithubRepo(repoSlug);
  if (!parsed) throw new Error("URL de GitHub inválida.");

  const { res: repoRes, data: repoData } = await ghFetch(
    `/repos/${parsed.owner}/${parsed.repo}`,
    env
  );

  if (repoRes.status === 404 || repoRes.status === 410) {
    return {
      provider: "github",
      status: "down",
      syncTarget: `${parsed.owner}/${parsed.repo}`,
      githubRepo: `${parsed.owner}/${parsed.repo}`,
      repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
      error: `Repositorio no disponible (HTTP ${repoRes.status}).`,
      checkedAt: new Date().toISOString(),
    };
  }

  if (!repoRes.ok) {
    throw new Error(repoData.message || `GitHub HTTP ${repoRes.status}`);
  }

  const canonicalRepo = String(
    repoData.full_name || `${parsed.owner}/${parsed.repo}`
  );
  const repoUrl = String(
    repoData.html_url || `https://github.com/${canonicalRepo}`
  );
  const moved =
    canonicalRepo.toLowerCase() !==
    `${parsed.owner}/${parsed.repo}`.toLowerCase();

  let release = null;
  const latest = await ghFetch(`/repos/${canonicalRepo}/releases/latest`, env);
  if (latest.res.ok && latest.data && latest.data.tag_name) {
    release = latest.data;
  } else {
    const list = await ghFetch(
      `/repos/${canonicalRepo}/releases?per_page=1`,
      env
    );
    if (list.res.ok && Array.isArray(list.data) && list.data.length > 0) {
      release = list.data[0];
    }
  }

  let tagFallback = null;
  if (!release) {
    const tags = await ghFetch(`/repos/${canonicalRepo}/tags?per_page=1`, env);
    if (tags.res.ok && Array.isArray(tags.data) && tags.data.length > 0) {
      tagFallback = tags.data[0];
    }
  }

  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const apkAsset =
    assets.find(
      (a) =>
        /\.apk$/i.test(String(a.name || "")) &&
        !/debug/i.test(String(a.name || ""))
    ) || assets.find((a) => /\.apk$/i.test(String(a.name || "")));

  const version = String(
    release?.tag_name || tagFallback?.name || ""
  ).trim();
  const updatedIso =
    release?.published_at || repoData.pushed_at || repoData.updated_at || "";

  return {
    provider: "github",
    syncTarget: canonicalRepo,
    status: moved ? "moved" : "ok",
    moved,
    archived: Boolean(repoData.archived),
    githubRepo: canonicalRepo,
    repoUrl,
    releaseUrl: release?.html_url || repoUrl,
    apkUrl: apkAsset?.browser_download_url || "",
    recommendedUrl: repoUrl,
    project: String(repoData.name || parsed.repo),
    developer: String(repoData.owner?.login || parsed.owner),
    version,
    lastUpdate: formatNaplDate(updatedIso),
    link: repoData.archived ? "Free (Github - Archived)" : "Free (Github)",
    description: String(repoData.description || ""),
    checkedAt: new Date().toISOString(),
  };
}

async function glFetch(apiPath, env = {}) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "NAPL-Catalog-Sync/3.0",
  };
  if (env?.GITLAB_TOKEN) {
    headers["PRIVATE-TOKEN"] = env.GITLAB_TOKEN;
  }
  const res = await fetchWithTimeout(`https://gitlab.com/api/v4${apiPath}`, {
    headers,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { res, data };
}

export async function inspectGitlabProject(projectInput, env = {}) {
  const parsed = parseGitlabProject(projectInput);
  if (!parsed) throw new Error("URL de GitLab inválida.");

  const encoded = encodeURIComponent(parsed.projectPath);
  const { res: projRes, data: projData } = await glFetch(
    `/projects/${encoded}`,
    env
  );
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

  const canonicalPath = String(
    projData.path_with_namespace || parsed.projectPath
  );
  const canonicalEncoded = encodeURIComponent(canonicalPath);
  const repoUrl = String(
    projData.web_url || `https://gitlab.com/${canonicalPath}`
  );
  const moved =
    canonicalPath.toLowerCase() !== parsed.projectPath.toLowerCase();

  let release = null;
  const rels = await glFetch(
    `/projects/${canonicalEncoded}/releases?per_page=1`,
    env
  );
  if (rels.res.ok && Array.isArray(rels.data) && rels.data.length > 0) {
    release = rels.data[0];
  }

  let tagFallback = null;
  if (!release) {
    const tags = await glFetch(
      `/projects/${canonicalEncoded}/repository/tags?per_page=1`,
      env
    );
    if (tags.res.ok && Array.isArray(tags.data) && tags.data.length > 0) {
      tagFallback = tags.data[0];
    }
  }

  let commitFallback = null;
  if (!release && !tagFallback) {
    const commits = await glFetch(
      `/projects/${canonicalEncoded}/repository/commits?per_page=1`,
      env
    );
    if (
      commits.res.ok &&
      Array.isArray(commits.data) &&
      commits.data.length > 0
    ) {
      commitFallback = commits.data[0];
    }
  }

  const assetLinks = Array.isArray(release?.assets?.links)
    ? release.assets.links
    : [];
  const apkAsset =
    assetLinks.find(
      (l) =>
        /\.apk(?:$|[?#])/i.test(
          String(l?.name || l?.direct_asset_url || l?.url || "")
        ) && !/debug/i.test(String(l?.name || ""))
    ) ||
    assetLinks.find((l) =>
      /\.apk(?:$|[?#])/i.test(
        String(l?.name || l?.direct_asset_url || l?.url || "")
      )
    );
  let apkUrl = String(
    apkAsset?.direct_asset_url || apkAsset?.url || ""
  ).trim();
  if (!apkUrl && release?.description) {
    const mdApk = String(release.description).match(
      /https?:\/\/[^\s)"']+\.apk/i
    );
    if (mdApk) apkUrl = mdApk[0];
  }

  const version = String(
    release?.tag_name || tagFallback?.name || ""
  ).trim();
  const updatedIso =
    release?.released_at ||
    release?.created_at ||
    tagFallback?.commit?.committed_date ||
    commitFallback?.committed_date ||
    projData.last_activity_at ||
    "";
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
    developer: String(
      projData.namespace?.name ||
        projData.namespace?.full_path ||
        parsed.namespace
    ),
    version,
    lastUpdate: formatNaplDate(updatedIso),
    link: projData.archived ? "Free (Gitlab - Archived)" : "Free (Gitlab)",
    description: String(projData.description || ""),
    checkedAt: new Date().toISOString(),
  };
}

export async function inspectPlayStoreApp(appInput) {
  const parsed = parsePlayStorePackage(appInput);
  if (!parsed) throw new Error("URL o ID de Google Play Store inválido.");

  const packageId = parsed.packageId;
  const storeUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(
    packageId
  )}`;
  const res = await fetchWithTimeout(`${storeUrl}&hl=en&gl=US`, {
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
  const cbRegex =
    /AF_initDataCallback\(\{key:\s*['"](ds:\d+)['"][\s\S]*?data:([\s\S]*?),\s*sideChannel:/g;
  for (const m of html.matchAll(cbRegex)) {
    if (m[1] !== "ds:5" && !m[2].includes(packageId)) continue;
    try {
      const parsedJson = JSON.parse(m[2]);
      const candidate = parsedJson?.[1]?.[2];
      if (
        Array.isArray(candidate) &&
        (candidate?.[77]?.[0] === packageId ||
          (m[1] === "ds:5" && candidate?.[0]?.[0]))
      ) {
        appInfo = candidate;
        if (candidate?.[77]?.[0] === packageId) break;
      }
    } catch {
      // Continue scanning
    }
  }

  if (!appInfo) {
    throw new Error(
      "No se pudieron leer los datos de la ficha en Google Play Store."
    );
  }

  const title = decodeHtmlEntities(String(appInfo?.[0]?.[0] || "").trim());
  const developer = decodeHtmlEntities(
    String(appInfo?.[37]?.[0] || appInfo?.[68]?.[0] || "").trim()
  );

  const priceMicros = Number(
    appInfo?.[57]?.[0]?.[0]?.[0]?.[0]?.[1]?.[0]?.[0] || 0
  );
  const priceFormatted = String(
    appInfo?.[57]?.[0]?.[0]?.[0]?.[0]?.[1]?.[0]?.[2] || ""
  ).trim();
  const isPaid =
    priceMicros > 0 ||
    Boolean(
      priceFormatted && !/^(\$?0(\.0+)?|free)$/i.test(priceFormatted)
    );

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

export async function inspectPortSource(rawInput, env = {}) {
  const value = String(rawInput || "").trim();
  if (!value) throw new Error("Ingresá una URL de GitHub, GitLab o Play Store.");
  if (parsePlayStorePackage(value)) return inspectPlayStoreApp(value);
  if (parseGitlabProject(value)) return inspectGitlabProject(value, env);
  if (parseGithubRepo(value)) return inspectGithubRepo(value, env);
  throw new Error(
    "URL no reconocida. Usá enlaces de GitHub, GitLab o Google Play Store."
  );
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

export async function inspectLaunchboxUrl(rawUrl) {
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

  const res = await fetchWithTimeout(targetUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`LaunchBox respondió HTTP ${res.status}.`);

  const html = await res.text();
  let name = "";
  let year = "";
  let genre = "";
  let description = "";
  let coverUrl = "";
  let developer = "";

  const nuxtMatch = html.match(
    /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nuxtMatch) {
    try {
      const pool = JSON.parse(nuxtMatch[1]);
      const gameIdx = pool.findIndex(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          "gameGenres" in item &&
          "gameImages" in item
      );
      if (gameIdx >= 0) {
        const resolveVal = (v, depth = 0) => {
          if (depth > 5) return v;
          if (
            typeof v === "number" &&
            Number.isInteger(v) &&
            v >= 0 &&
            v < pool.length
          ) {
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
        const ym = String(game.releaseYear || game.releaseDate || "").match(
          /\b(19\d\d|20\d\d)\b/
        );
        if (ym) year = ym[1];
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
            game.gameImages.find((img) =>
              /box\s*-\s*front/i.test(String(img?.imageTypeName || ""))
            ) ||
            game.gameImages.find((img) =>
              /fanart|poster|clear logo/i.test(String(img?.imageTypeName || ""))
            ) ||
            game.gameImages[0];
          if (preferred) {
            coverUrl = resolveLaunchboxImageUrl(
              preferred.fullGameImageFileName || preferred.imageFileName || ""
            );
          }
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (!name) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) name = decodeHtmlEntities(h1[1].replace(/<[^>]+>/g, "")).trim();
  }
  if (!description) {
    const metaDesc = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    );
    if (metaDesc) description = decodeHtmlEntities(metaDesc[1]).trim();
  }
  if (!year) {
    const timeMatch = html.match(
      /<time[^>]*datetime=["']([^"']+)["']/i
    );
    const ym = timeMatch && timeMatch[1].match(/\b(19\d\d|20\d\d)\b/);
    if (ym) year = ym[1];
  }
  if (!coverUrl) {
    const ogImg = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    );
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

export function extractSteamAppId(rawInput) {
  const raw = String(rawInput || "").trim();
  if (/^\d{1,10}$/.test(raw)) return raw;
  const match = raw.match(/store\.steampowered\.com\/app\/(\d{1,10})/i);
  if (match) return match[1];
  const pathMatch = raw.match(/\/steam\/apps\/(\d{1,10})\//i);
  return pathMatch ? pathMatch[1] : "";
}

export async function inspectSteamApp(rawInput, env = {}) {
  const appId = extractSteamAppId(rawInput);
  if (!appId) {
    throw new Error("Ingresá una URL de Steam o AppID numérico válido.");
  }

  const steamUrl = `https://store.steampowered.com/app/${appId}`;
  let name = "";
  let year = "";
  let genre = "";
  let description = "";
  let developer = "";

  const detailsRes = await fetchWithTimeout(
    `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(
      appId
    )}&l=english&cc=US`
  );
  if (detailsRes.ok) {
    const detailsPayload = await detailsRes.json().catch(() => ({}));
    const entry = detailsPayload?.[appId];
    if (entry?.success && entry.data) {
      const d = entry.data;
      name = String(d.name || "").trim();
      description = decodeHtmlEntities(
        String(d.short_description || "").replace(/<[^>]+>/g, " ")
      )
        .replace(/\s+/g, " ")
        .trim();
      if (Array.isArray(d.genres) && d.genres.length) {
        genre = d.genres
          .map((g) => String(g?.description || "").trim())
          .filter(Boolean)
          .slice(0, 2)
          .join(", ");
      }
      if (Array.isArray(d.developers) && d.developers.length) {
        developer = String(d.developers[0] || "").trim();
      }
      const ym = String(d.release_date?.date || "").match(
        /\b(19\d\d|20\d\d)\b/
      );
      if (ym) year = ym[1];
    }
  }

  const candidates = [];
  const browseInput = JSON.stringify({
    ids: [{ appid: Number(appId) }],
    context: { country_code: "US" },
    data_request: { include_assets: true },
  });
  const browseRes = await fetchWithTimeout(
    `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(
      browseInput
    )}`
  );
  if (browseRes.ok) {
    const browsePayload = await browseRes.json().catch(() => ({}));
    const assets = browsePayload?.response?.store_items?.[0]?.assets;
    if (assets) {
      const format = String(
        assets.asset_url_format || `steam/apps/${appId}/\${FILENAME}`
      );
      for (const file of [
        assets.library_capsule_2x,
        assets.library_capsule,
        assets.library_600x900_2x,
        assets.library_600x900,
      ].filter(Boolean)) {
        candidates.push(
          `https://shared.akamai.steamstatic.com/store_item_assets/${format.replace(
            "${FILENAME}",
            file
          )}`
        );
      }
    }
  }

  candidates.push(
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_capsule_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_capsule.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`
  );

  let coverUrl = "";
  for (const url of [...new Set(candidates)]) {
    try {
      const check = await fetchWithTimeout(url, { method: "HEAD" }, 5000);
      const ct = String(check.headers.get("content-type") || "").toLowerCase();
      if (check.ok && ct.startsWith("image/")) {
        coverUrl = url;
        break;
      }
    } catch {
      // Try next vertical candidate
    }
  }

  if (!coverUrl && env.STEAMGRIDDB_API_KEY) {
    try {
      const headers = { Authorization: `Bearer ${env.STEAMGRIDDB_API_KEY}` };
      const gameRes = await fetchWithTimeout(
        `https://www.steamgriddb.com/api/v2/games/steam/${encodeURIComponent(
          appId
        )}`,
        { headers }
      );
      if (gameRes.ok) {
        const gameData = await gameRes.json().catch(() => ({}));
        const sgdbId = gameData?.data?.id;
        if (sgdbId) {
          const gridsRes = await fetchWithTimeout(
            `https://www.steamgriddb.com/api/v2/grids/game/${sgdbId}?dimensions=600x900,342x482&types=static`,
            { headers }
          );
          if (gridsRes.ok) {
            const gridsData = await gridsRes.json().catch(() => ({}));
            const firstGrid = Array.isArray(gridsData?.data)
              ? gridsData.data.find((g) => g?.url)
              : null;
            if (firstGrid?.url) coverUrl = String(firstGrid.url);
          }
        }
      }
    } catch {
      // Optional SteamGridDB fallback
    }
  }

  if (!name) {
    throw new Error(`No se encontraron datos de Steam para AppID ${appId}.`);
  }

  return {
    appId,
    name,
    year,
    genre,
    description,
    coverUrl,
    developer,
    steamUrl,
  };
}

export async function syncSinglePortWithSource(env, port) {
  const syncInfo = resolvePortSyncTarget(port);
  if (!syncInfo.provider || !syncInfo.target) {
    return {
      portId: port.portId,
      status: "skipped",
      reason: "Sin fuente sincronizable",
      changed: false,
    };
  }

  const now = new Date().toISOString();
  const oldVersion = port.version;
  let info;
  if (syncInfo.provider === "playstore") {
    info = await inspectPlayStoreApp(syncInfo.target);
  } else if (syncInfo.provider === "gitlab") {
    const target = /^https?:\/\//i.test(syncInfo.target)
      ? syncInfo.target
      : `https://gitlab.com/${syncInfo.target.replace(/^\/+/, "")}`;
    info = await inspectGitlabProject(target, env);
  } else {
    info = await inspectGithubRepo(syncInfo.target, env);
  }

  if (info.status === "down") {
    const downLabel =
      syncInfo.provider === "playstore" ? "App Down" : "Repo Down";
    const changed =
      port.githubStatus !== "down" ||
      port.link !== downLabel ||
      port.syncProvider !== syncInfo.provider ||
      port.syncTarget !== syncInfo.target;
    Object.assign(port, {
      githubRepo: syncInfo.githubRepo || "",
      syncProvider: syncInfo.provider,
      syncTarget: syncInfo.target,
      githubStatus: "down",
      link: downLabel,
      lastCheckedAt: now,
    });
    return {
      portId: port.portId,
      gameSlug: port.gameSlug || "",
      project: port.project,
      provider: syncInfo.provider,
      syncTarget: syncInfo.target,
      githubRepo: syncInfo.githubRepo,
      status: "down",
      changed,
      message: info.error,
    };
  }

  const nextVersion = info.version || port.version;
  const nextLastUpdate = info.lastUpdate || port.lastUpdate;
  const nextLink =
    port.link === "Repo Down" ||
    port.link === "App Down" ||
    !port.link ||
    /github|gitlab|play\s*store|playstore/i.test(port.link)
      ? info.link
      : port.link;

  let nextUrl = port.url;
  if (syncInfo.provider === "github") {
    const parsed = parseGithubRepo(port.url);
    if (
      !nextUrl ||
      info.moved ||
      (parsed && info.apkUrl && /\/releases\/|github\.com/i.test(nextUrl))
    ) {
      nextUrl = info.repoUrl;
    }
  } else if (syncInfo.provider === "gitlab") {
    const parsed = parseGitlabProject(port.url);
    if (
      !nextUrl ||
      info.moved ||
      (parsed && info.apkUrl && /\/releases\/|gitlab\.com/i.test(nextUrl))
    ) {
      nextUrl = info.apkUrl || info.repoUrl;
    }
  } else if (syncInfo.provider === "playstore" && !nextUrl) {
    nextUrl = info.storeUrl;
  }

  const nextGithubRepo =
    syncInfo.provider === "github" ? info.githubRepo : "";
  const nextSyncTarget = info.syncTarget || syncInfo.target;
  const changed =
    nextVersion !== port.version ||
    nextLastUpdate !== port.lastUpdate ||
    nextGithubRepo !== port.githubRepo ||
    syncInfo.provider !== (port.syncProvider || "") ||
    nextSyncTarget !== (port.syncTarget || "") ||
    nextUrl !== port.url ||
    nextLink !== port.link ||
    port.githubStatus !== info.status;

  Object.assign(port, {
    githubRepo: nextGithubRepo,
    syncProvider: syncInfo.provider,
    syncTarget: nextSyncTarget,
    githubStatus: info.status,
    version: nextVersion,
    lastUpdate: nextLastUpdate,
    url: nextUrl,
    link: nextLink,
    lastCheckedAt: now,
  });

  return {
    portId: port.portId,
    gameSlug: port.gameSlug || "",
    project: port.project || info.project,
    provider: syncInfo.provider,
    syncTarget: nextSyncTarget,
    githubRepo: nextGithubRepo,
    status: info.status,
    changed,
    oldVersion,
    newVersion: nextVersion,
    url: nextUrl,
    lastUpdate: nextLastUpdate,
  };
}
