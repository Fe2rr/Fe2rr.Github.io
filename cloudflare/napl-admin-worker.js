const OWNER = "Fe2rr";
const REPO = "Napl-prueba";
const BRANCH = "main";
const CATALOG_PATH = "public/assets/data/catalog.json";
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv";
const SESSION_TTL = 8 * 60 * 60 * 1000;
const DEFAULT_CRON_BATCH = 20;

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

let schemaBootstrapped = false;

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
  if (list.includes(origin)) return true;
  if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") {
    return true;
  }
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith(".run.app") || u.hostname === "fe2rr.github.io") {
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
  for (let i = 0; i < bytes.length; i += 32768) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  }
  return btoa(bin);
}

function normHead(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(v) {
  return norm(v).replace(/\s+/g, "-");
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

async function ghFetch(path, env, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "NAPL-Catalog-Sync/2.0",
    ...(options.headers || {}),
  };
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }
  const res = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
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

async function ghCommitCatalog(catalog, env, message = "NAPL: sincronizar catálogo desde D1") {
  if (!env.GITHUB_TOKEN) {
    throw new Error("Falta el secreto GITHUB_TOKEN en Cloudflare.");
  }
  const { res: metaRes, data: meta } = await ghFetch(
    `/repos/${OWNER}/${REPO}/contents/${CATALOG_PATH}?ref=${BRANCH}`,
    env
  );
  const payload = {
    message,
    content: toB64(JSON.stringify(catalog)),
    branch: BRANCH,
  };
  if (metaRes.ok && meta.sha) {
    payload.sha = meta.sha;
  }
  const { res, data } = await ghFetch(`/repos/${OWNER}/${REPO}/contents/${CATALOG_PATH}`, env, {
    method: "PUT",
    body: payload,
  });
  if (!res.ok) {
    throw new Error(data.message || `GitHub HTTP ${res.status}`);
  }
  return {
    commit: data.commit?.html_url || "",
    sha: data.commit?.sha || "",
  };
}

function csvParse(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let q = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (q && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (c === "," && !q) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !q) {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((v) => v.trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map(normHead);
  return rows.map((values) => {
    const o = {};
    headers.forEach((h, i) => {
      if (h) o[h] = String(values[i] || "").trim();
    });
    return o;
  });
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
  let currentGame = "";
  let currentYear = "";
  const flat = [];
  const platforms = new Map();
  for (const row of rows) {
    const gv = col(row, ["GAME", "GAME NAME", "NAME", "JUEGO"]);
    const yv = col(row, ["YEAR", "ANO", "AÑO"]);
    const platform = col(row, ["PLATFORM", "PLATAFORM", "PLATAFORMA"]);
    if (gv) currentGame = gv;
    if (yv) currentYear = yv;
    if (platform) {
      const k = norm(platform);
      if (k !== "multi game apps" && !platforms.has(k)) {
        platforms.set(k, platform);
      }
    }
    const project = col(row, ["PROJECT", "PROYECTO"]);
    const rawId = col(row, ["PORTS_ID", "PORT ID", "PORT_ID"]);
    const portId =
      /^unofficial-port(?:-\d+)?$/i.test(rawId) && currentGame
        ? `${slugify(currentGame)}-${rawId.toLowerCase()}`
        : rawId;
    const url = col(row, ["URL", "PORT URL", "PORT LINK"]);
    const link = col(row, ["LINK", "PROJECT LINK", "ENLACE"]);
    const port = {
      portId,
      project,
      platform,
      developer: col(row, ["DEVELOPER", "DEVELOPER/PUBLISHER", "DESARROLLADOR"]),
      year: currentYear,
      version: col(row, ["VERSION", "VERSIÓN"]),
      controller: col(row, ["CONTROLLER SUPPORT", "CONTROLLER", "GAMEPAD", "MANDO"]),
      files: col(row, ["NEEDS GAME FILES?", "NEEDS GAME FILES", "GAME FILES", "NECESITA ARCHIVOS"]),
      works: col(row, ["WORKS?", "WORKS", "FUNCIONA"]),
      link,
      url,
      dataUrl: col(row, ["DATA URL", "DATA LINK", "GAME FILES URL"]),
      githubRepo: normalizeGithubSlug(url) || normalizeGithubSlug(link),
      lastUpdate: col(row, ["LAST UPDATE", "LAST UPDATED", "ÚLTIMA ACTUALIZACIÓN"]),
      dateAdded: col(row, ["DATE ADDED"]),
      notes: col(row, ["NOTES", "NOTE", "NOTAS"]),
    };
    const has = [
      port.project,
      port.link,
      port.url,
      port.dataUrl,
      port.developer,
      port.version,
      port.controller,
      port.files,
      port.works,
      port.lastUpdate,
      port.dateAdded,
      port.notes,
    ].some((v) => String(v || "").trim());
    if (!currentGame || !has) continue;
    flat.push({
      game: currentGame,
      year: currentYear,
      coverUrl: col(row, ["COVER_URL", "COVER URL", "COVER", "COVER IMAGE", "IMAGE URL", "PORTADA"]),
      genre: col(row, ["GENRE", "GÉNERO", "GENERO"]),
      description: col(row, ["DESCRIPTION", "DESCRIPCIÓN", "DESCRIPCION"]),
      port,
    });
  }

  const groups = new Map();
  for (const x of flat) {
    const k = norm(x.game);
    if (!k) continue;
    if (!groups.has(k)) {
      groups.set(k, {
        name: x.game,
        slug: slugify(x.game),
        year: x.year || "",
        coverUrl: x.coverUrl || "",
        genre: x.genre || "",
        description: x.description || "",
        launchboxUrl: "",
        platforms: [],
        ports: [],
      });
    }
    const g = groups.get(k);
    if (!g.year && x.year) g.year = x.year;
    if (!g.coverUrl && x.coverUrl) g.coverUrl = x.coverUrl;
    if (!g.genre && x.genre) g.genre = x.genre;
    if (!g.description && x.description) g.description = x.description;
    if (x.port.platform && !g.platforms.includes(x.port.platform)) {
      g.platforms.push(x.port.platform);
    }
    g.ports.push(x.port);
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    platformOrder: Array.from(platforms.values()),
    games: Array.from(groups.values()),
  };
}

function validateCatalog(input) {
  if (!input || !Array.isArray(input.games) || !Array.isArray(input.platformOrder)) {
    throw new Error("Formato JSON inválido.");
  }
  if (input.games.length > 5000) {
    throw new Error("Máximo 5.000 juegos.");
  }
  const slugs = new Set();
  const ids = new Set();
  const games = input.games.map((g) => {
    if (!g || typeof g.name !== "string" || !g.name.trim()) {
      throw new Error("Cada juego necesita nombre.");
    }
    const s = String(g.slug || slugify(g.name)).trim();
    if (!s || slugs.has(s)) {
      throw new Error(`Slug vacío o duplicado: ${s}`);
    }
    slugs.add(s);
    if (!Array.isArray(g.ports)) {
      throw new Error(`Ports inválidos en ${g.name}`);
    }
    const ports = g.ports.map((p, idx) => {
      const o = {};
      for (const k of [
        "portId",
        "project",
        "platform",
        "developer",
        "year",
        "version",
        "controller",
        "files",
        "works",
        "link",
        "url",
        "dataUrl",
        "githubRepo",
        "githubStatus",
        "lastCheckedAt",
        "lastUpdate",
        "dateAdded",
        "notes",
      ]) {
        o[k] = String(p?.[k] == null ? "" : p[k]);
      }
      if (!o.portId) {
        o.portId = `${s}-port-${idx + 1}`;
      }
      if (ids.has(o.portId)) {
        throw new Error(`ID de port duplicado: ${o.portId}`);
      }
      ids.add(o.portId);
      if (!o.githubRepo) {
        o.githubRepo = normalizeGithubSlug(o.url) || normalizeGithubSlug(o.link);
      } else {
        o.githubRepo = normalizeGithubSlug(o.githubRepo) || o.githubRepo;
      }
      return o;
    });
    return {
      name: g.name.trim(),
      slug: s,
      year: String(g.year || ""),
      coverUrl: String(g.coverUrl || ""),
      genre: String(g.genre || ""),
      description: String(g.description || ""),
      launchboxUrl: String(g.launchboxUrl || ""),
      platforms: Array.from(new Set(ports.map((p) => p.platform).filter(Boolean))),
      ports,
    };
  });

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    platformOrder: input.platformOrder.map(String).filter(Boolean),
    games,
  };
}

async function ensureSchema(env) {
  if (!env.DB) {
    throw new Error("Falta el binding D1 'DB' en Cloudflare Worker.");
  }
  if (schemaBootstrapped) return;

  const statements = [
    `CREATE TABLE IF NOT EXISTS games (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      year TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      launchbox_url TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ports (
      port_id TEXT PRIMARY KEY,
      game_slug TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      developer TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '',
      controller TEXT NOT NULL DEFAULT '',
      files TEXT NOT NULL DEFAULT '',
      works TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      data_url TEXT NOT NULL DEFAULT '',
      github_repo TEXT NOT NULL DEFAULT '',
      github_status TEXT NOT NULL DEFAULT '',
      github_etag TEXT NOT NULL DEFAULT '',
      last_checked_at TEXT NOT NULL DEFAULT '',
      last_update TEXT NOT NULL DEFAULT '',
      date_added TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (game_slug) REFERENCES games(slug) ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS platform_order (
      position INTEGER NOT NULL,
      platform TEXT PRIMARY KEY
    )`,
    `CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      checked_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      down_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_games_sort ON games(sort_order, name)`,
    `CREATE INDEX IF NOT EXISTS idx_ports_game ON ports(game_slug, sort_order)`,
    `CREATE INDEX IF NOT EXISTS idx_ports_github ON ports(github_repo, last_checked_at)`,
  ];

  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  schemaBootstrapped = true;
}

async function runBatchChunked(db, stmts, chunkSize = 80) {
  for (let i = 0; i < stmts.length; i += chunkSize) {
    await db.batch(stmts.slice(i, i + chunkSize));
  }
}

async function replaceWholeCatalogInD1(env, rawCatalog, options = {}) {
  await ensureSchema(env);
  const catalog = validateCatalog(rawCatalog);
  const now = catalog.updatedAt;
  const pendingGithubSync = options.pendingGithubSync ? "1" : "0";

  await env.DB.batch([
    env.DB.prepare("DELETE FROM ports"),
    env.DB.prepare("DELETE FROM games"),
    env.DB.prepare("DELETE FROM platform_order"),
  ]);

  const stmts = [];
  catalog.platformOrder.forEach((platform, idx) => {
    stmts.push(
      env.DB.prepare("INSERT OR REPLACE INTO platform_order (position, platform) VALUES (?, ?)").bind(
        idx,
        platform
      )
    );
  });

  catalog.games.forEach((g, gIdx) => {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO games (slug, name, year, cover_url, genre, description, launchbox_url, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        g.slug,
        g.name,
        g.year || "",
        g.coverUrl || "",
        g.genre || "",
        g.description || "",
        g.launchboxUrl || "",
        gIdx,
        now
      )
    );

    g.ports.forEach((p, pIdx) => {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO ports (
            port_id, game_slug, project, platform, developer, year, version,
            controller, files, works, link, url, data_url,
            github_repo, github_status, github_etag, last_checked_at,
            last_update, date_added, notes, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`
        ).bind(
          p.portId,
          g.slug,
          p.project || "",
          p.platform || "",
          p.developer || "",
          p.year || g.year || "",
          p.version || "",
          p.controller || "",
          p.files || "",
          p.works || "",
          p.link || "",
          p.url || "",
          p.dataUrl || "",
          p.githubRepo || "",
          p.githubStatus || (p.githubRepo ? "unknown" : ""),
          p.lastCheckedAt || "",
          p.lastUpdate || "",
          p.dateAdded || "",
          p.notes || "",
          pIdx
        )
      );
    });
  });

  stmts.push(
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "updated_at",
      now,
      now
    ),
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "pending_github_sync",
      pendingGithubSync,
      now
    )
  );
  if (options.publishedAt) {
    stmts.push(
      env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
        "last_github_publish_at",
        options.publishedAt,
        now
      )
    );
  }

  await runBatchChunked(env.DB, stmts);
  return catalog;
}

async function ensureSeeded(env) {
  await ensureSchema(env);
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM games").first();
  if (countRow && Number(countRow.count) > 0) return false;

  const rawUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${CATALOG_PATH}`;
  const res = await fetch(rawUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) return false;
  const doc = await res.json().catch(() => null);
  if (!doc || !Array.isArray(doc.games) || !doc.games.length) return false;

  await replaceWholeCatalogInD1(env, doc, {
    pendingGithubSync: false,
    publishedAt: String(doc.updatedAt || new Date().toISOString()),
  });
  return true;
}

async function readMetaMap(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM catalog_meta").all();
  const map = {};
  for (const row of results || []) {
    map[row.key] = row.value;
  }
  return map;
}

async function readCatalogFromD1(env, options = {}) {
  await ensureSeeded(env);
  const { includeInternal = false } = options;

  const [platformsRes, gamesRes, portsRes, meta] = await Promise.all([
    env.DB.prepare("SELECT platform FROM platform_order ORDER BY position ASC").all(),
    env.DB.prepare("SELECT * FROM games ORDER BY sort_order ASC, name ASC").all(),
    env.DB.prepare("SELECT * FROM ports ORDER BY sort_order ASC").all(),
    readMetaMap(env),
  ]);

  const portsByGame = new Map();
  let githubCount = 0;
  let downCount = 0;

  for (const r of portsRes.results || []) {
    if (r.github_repo) githubCount += 1;
    if (r.github_status === "down") downCount += 1;

    const port = {
      portId: r.port_id,
      project: r.project,
      platform: r.platform,
      developer: r.developer,
      year: r.year,
      version: r.version,
      controller: r.controller,
      files: r.files,
      works: r.works,
      link: r.link,
      url: r.url,
      dataUrl: r.data_url,
      lastUpdate: r.last_update,
      dateAdded: r.date_added,
      notes: r.notes,
    };

    if (includeInternal) {
      port.githubRepo = r.github_repo || "";
      port.githubStatus = r.github_status || "";
      port.lastCheckedAt = r.last_checked_at || "";
    } else if (r.github_repo) {
      port.githubRepo = r.github_repo;
    }

    if (!portsByGame.has(r.game_slug)) portsByGame.set(r.game_slug, []);
    portsByGame.get(r.game_slug).push(port);
  }

  const games = (gamesRes.results || []).map((g) => {
    const ports = portsByGame.get(g.slug) || [];
    const entry = {
      name: g.name,
      slug: g.slug,
      year: g.year || "",
      coverUrl: g.cover_url || "",
      genre: g.genre || "",
      description: g.description || "",
      platforms: Array.from(new Set(ports.map((p) => p.platform).filter(Boolean))),
      ports,
    };
    if (includeInternal || g.launchbox_url) {
      entry.launchboxUrl = g.launchbox_url || "";
    }
    return entry;
  });

  const catalog = {
    version: 1,
    updatedAt: meta.updated_at || new Date().toISOString(),
    platformOrder: (platformsRes.results || []).map((x) => x.platform).filter(Boolean),
    games,
  };

  if (!includeInternal) return { catalog, meta };

  const logsRes = await env.DB.prepare(
    "SELECT id, source, checked_count, updated_count, down_count, error_count, summary_json, created_at FROM sync_logs ORDER BY id DESC LIMIT 12"
  ).all();

  return {
    catalog,
    meta,
    stats: {
      gamesCount: games.length,
      portsCount: (portsRes.results || []).length,
      githubCount,
      downCount,
      lastSyncAt: meta.last_sync_at || "",
      lastGitHubPublishAt: meta.last_github_publish_at || "",
      pendingGitHubSync: meta.pending_github_sync === "1",
    },
    syncLogs: (logsRes.results || []).map((l) => ({
      id: l.id,
      source: l.source,
      checkedCount: l.checked_count,
      updatedCount: l.updated_count,
      downCount: l.down_count,
      errorCount: l.error_count,
      summary: (() => {
        try {
          return JSON.parse(l.summary_json || "[]");
        } catch {
          return [];
        }
      })(),
      createdAt: l.created_at,
    })),
  };
}

async function saveSingleGameInD1(env, targetSlug, rawGame, isCreate = false) {
  await ensureSeeded(env);
  if (!rawGame || typeof rawGame.name !== "string" || !rawGame.name.trim()) {
    throw new Error("El juego necesita un nombre.");
  }

  const nextSlug = String(rawGame.slug || slugify(rawGame.name)).trim();
  if (!nextSlug) throw new Error("Slug inválido.");
  const now = new Date().toISOString();

  let sortOrder = 0;
  if (!isCreate && targetSlug) {
    const existing = await env.DB.prepare("SELECT sort_order FROM games WHERE slug = ?")
      .bind(targetSlug)
      .first();
    if (!existing) {
      throw new Error(`No existe el juego '${targetSlug}'.`);
    }
    sortOrder = Number(existing.sort_order) || 0;
  } else {
    const minRow = await env.DB.prepare("SELECT MIN(sort_order) AS min_order FROM games").first();
    sortOrder = minRow && minRow.min_order != null ? Number(minRow.min_order) - 1 : 0;
  }

  if ((isCreate || nextSlug !== targetSlug)) {
    const conflict = await env.DB.prepare("SELECT slug FROM games WHERE slug = ?").bind(nextSlug).first();
    if (conflict) {
      throw new Error(`Ya existe un juego con el slug '${nextSlug}'.`);
    }
  }

  const rawPorts = Array.isArray(rawGame.ports) ? rawGame.ports : [];
  const seenPortIds = new Set();
  const normalizedPorts = rawPorts.map((p, idx) => {
    let portId = String(p?.portId || "").trim() || `${nextSlug}-port-${idx + 1}`;
    while (seenPortIds.has(portId)) {
      portId = `${portId}-${idx + 1}`;
    }
    seenPortIds.add(portId);
    const url = String(p?.url || "").trim();
    const link = String(p?.link || "").trim();
    const githubRepo =
      normalizeGithubSlug(p?.githubRepo) ||
      normalizeGithubSlug(url) ||
      normalizeGithubSlug(link);

    return {
      portId,
      project: String(p?.project || ""),
      platform: String(p?.platform || ""),
      developer: String(p?.developer || ""),
      year: String(p?.year || rawGame.year || ""),
      version: String(p?.version || ""),
      controller: String(p?.controller || ""),
      files: String(p?.files || ""),
      works: String(p?.works || ""),
      link,
      url,
      dataUrl: String(p?.dataUrl || ""),
      githubRepo,
      githubStatus: String(p?.githubStatus || (githubRepo ? "unknown" : "")),
      lastCheckedAt: String(p?.lastCheckedAt || ""),
      lastUpdate: String(p?.lastUpdate || ""),
      dateAdded: String(p?.dateAdded || now.slice(0, 10)),
      notes: String(p?.notes || ""),
    };
  });

  const stmts = [];
  if (!isCreate && targetSlug) {
    stmts.push(env.DB.prepare("DELETE FROM ports WHERE game_slug = ?").bind(targetSlug));
    if (nextSlug !== targetSlug) {
      stmts.push(env.DB.prepare("DELETE FROM games WHERE slug = ?").bind(targetSlug));
    }
  }

  stmts.push(
    env.DB.prepare(
      `INSERT OR REPLACE INTO games (slug, name, year, cover_url, genre, description, launchbox_url, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      nextSlug,
      rawGame.name.trim(),
      String(rawGame.year || ""),
      String(rawGame.coverUrl || ""),
      String(rawGame.genre || ""),
      String(rawGame.description || ""),
      String(rawGame.launchboxUrl || ""),
      sortOrder,
      now
    )
  );

  normalizedPorts.forEach((p, idx) => {
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO ports (
          port_id, game_slug, project, platform, developer, year, version,
          controller, files, works, link, url, data_url,
          github_repo, github_status, github_etag, last_checked_at,
          last_update, date_added, notes, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`
      ).bind(
        p.portId,
        nextSlug,
        p.project,
        p.platform,
        p.developer,
        p.year,
        p.version,
        p.controller,
        p.files,
        p.works,
        p.link,
        p.url,
        p.dataUrl,
        p.githubRepo,
        p.githubStatus,
        p.lastCheckedAt,
        p.lastUpdate,
        p.dateAdded,
        p.notes,
        idx
      )
    );
  });

  // Add any newly used platform to platform_order (excluding Multi-Game Apps)
  const platRows = await env.DB.prepare("SELECT platform, position FROM platform_order ORDER BY position ASC").all();
  const knownPlats = new Set((platRows.results || []).map((r) => norm(r.platform)));
  let nextPos = (platRows.results || []).reduce((m, r) => Math.max(m, Number(r.position) || 0), -1) + 1;
  for (const p of normalizedPorts) {
    if (p.platform && norm(p.platform) !== "multi game apps" && !knownPlats.has(norm(p.platform))) {
      knownPlats.add(norm(p.platform));
      stmts.push(
        env.DB.prepare("INSERT OR IGNORE INTO platform_order (position, platform) VALUES (?, ?)").bind(
          nextPos++,
          p.platform
        )
      );
    }
  }

  stmts.push(
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "updated_at",
      now,
      now
    ),
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "pending_github_sync",
      "1",
      now
    )
  );

  await runBatchChunked(env.DB, stmts);
  return {
    slug: nextSlug,
    updatedAt: now,
    portsCount: normalizedPorts.length,
  };
}

async function deleteGameFromD1(env, slug) {
  await ensureSeeded(env);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ports WHERE game_slug = ?").bind(slug),
    env.DB.prepare("DELETE FROM games WHERE slug = ?").bind(slug),
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "updated_at",
      now,
      now
    ),
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "pending_github_sync",
      "1",
      now
    ),
  ]);
  return { deleted: true, slug, updatedAt: now };
}

async function inspectGithubRepo(repoSlug, env) {
  const parsed = parseGithubRepo(repoSlug);
  if (!parsed) {
    throw new Error("URL de GitHub inválida.");
  }

  const { res: repoRes, data: repoData } = await ghFetch(
    `/repos/${parsed.owner}/${parsed.repo}`,
    env
  );

  if (repoRes.status === 404 || repoRes.status === 410) {
    return {
      status: "down",
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
  const latest = await ghFetch(`/repos/${canonicalRepo}/releases/latest`, env);
  if (latest.res.ok && latest.data && latest.data.tag_name) {
    release = latest.data;
  } else {
    const list = await ghFetch(`/repos/${canonicalRepo}/releases?per_page=1`, env);
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
    assets.find((a) => /\.apk$/i.test(String(a.name || "")) && !/debug/i.test(String(a.name || ""))) ||
    assets.find((a) => /\.apk$/i.test(String(a.name || "")));

  const version = String(release?.tag_name || tagFallback?.name || "").trim();
  const updatedIso = release?.published_at || repoData.pushed_at || repoData.updated_at || "";
  const lastUpdate = formatNaplDate(updatedIso);
  const releaseUrl = release?.html_url || repoUrl;
  const apkUrl = apkAsset?.browser_download_url || "";
  const recommendedUrl = apkUrl || releaseUrl || repoUrl;

  return {
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

async function syncSinglePortWithGithub(env, portRow) {
  const repoSlug =
    normalizeGithubSlug(portRow.github_repo) ||
    normalizeGithubSlug(portRow.url) ||
    normalizeGithubSlug(portRow.link);
  if (!repoSlug) {
    return { portId: portRow.port_id, status: "skipped", reason: "Sin repositorio GitHub" };
  }

  const now = new Date().toISOString();
  const info = await inspectGithubRepo(repoSlug, env);

  if (info.status === "down") {
    const changed = portRow.github_status !== "down" || portRow.link !== "Repo Down";
    await env.DB.prepare(
      `UPDATE ports SET github_repo = ?, github_status = 'down', link = ?, last_checked_at = ? WHERE port_id = ?`
    )
      .bind(repoSlug, "Repo Down", now, portRow.port_id)
      .run();
    return {
      portId: portRow.port_id,
      gameSlug: portRow.game_slug,
      project: portRow.project,
      githubRepo: repoSlug,
      status: "down",
      changed,
      message: info.error,
    };
  }

  const nextVersion = info.version || portRow.version;
  const nextLastUpdate = info.lastUpdate || portRow.last_update;
  const nextLink =
    portRow.link === "Repo Down" || !portRow.link || /github/i.test(portRow.link)
      ? info.link
      : portRow.link;

  // Keep user's explicit custom url unless it was pointing to old repo/release or empty
  let nextUrl = portRow.url;
  const curParsed = parseGithubRepo(portRow.url);
  if (!nextUrl || info.moved || (curParsed && info.apkUrl && /\/releases\/|github\.com/i.test(nextUrl))) {
    nextUrl = info.apkUrl || info.repoUrl;
  }

  const changed =
    nextVersion !== portRow.version ||
    nextLastUpdate !== portRow.last_update ||
    info.githubRepo !== portRow.github_repo ||
    nextUrl !== portRow.url ||
    nextLink !== portRow.link ||
    portRow.github_status !== info.status;

  await env.DB.prepare(
    `UPDATE ports
     SET github_repo = ?, github_status = ?, version = ?, last_update = ?, url = ?, link = ?, last_checked_at = ?
     WHERE port_id = ?`
  )
    .bind(
      info.githubRepo,
      info.status,
      nextVersion,
      nextLastUpdate,
      nextUrl,
      nextLink,
      now,
      portRow.port_id
    )
    .run();

  return {
    portId: portRow.port_id,
    gameSlug: portRow.game_slug,
    project: portRow.project || info.project,
    githubRepo: info.githubRepo,
    status: info.status,
    changed,
    oldVersion: portRow.version,
    newVersion: nextVersion,
    url: nextUrl,
    lastUpdate: nextLastUpdate,
  };
}

async function runGithubSyncBatch(env, options = {}) {
  await ensureSeeded(env);
  const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_CRON_BATCH, 1), 22);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const source = options.source || "manual";

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ports
     WHERE github_repo != '' OR url LIKE '%github.com/%' OR link LIKE '%github.com/%'`
  ).first();
  const totalGithubPorts = Number(totalRow?.count || 0);

  const query = options.useOffset
    ? `SELECT * FROM ports
       WHERE github_repo != '' OR url LIKE '%github.com/%' OR link LIKE '%github.com/%'
       ORDER BY port_id ASC
       LIMIT ? OFFSET ?`
    : `SELECT * FROM ports
       WHERE github_repo != '' OR url LIKE '%github.com/%' OR link LIKE '%github.com/%'
       ORDER BY last_checked_at ASC, port_id ASC
       LIMIT ?`;

  const stmt = options.useOffset
    ? env.DB.prepare(query).bind(limit, offset)
    : env.DB.prepare(query).bind(limit);
  const { results: ports } = await stmt.all();

  let checkedCount = 0;
  let updatedCount = 0;
  let downCount = 0;
  let errorCount = 0;
  const details = [];

  for (const row of ports || []) {
    checkedCount += 1;
    try {
      const outcome = await syncSinglePortWithGithub(env, row);
      if (outcome.status === "down") downCount += 1;
      if (outcome.changed) {
        updatedCount += 1;
        details.push(outcome);
      }
    } catch (err) {
      errorCount += 1;
      details.push({
        portId: row.port_id,
        gameSlug: row.game_slug,
        project: row.project,
        githubRepo: row.github_repo,
        status: "error",
        error: err?.message || "Error consultando GitHub",
      });
    }
  }

  const now = new Date().toISOString();
  const metaOps = [
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "last_sync_at",
      now,
      now
    ),
    env.DB.prepare(
      `INSERT INTO sync_logs (source, checked_count, updated_count, down_count, error_count, summary_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(source, checkedCount, updatedCount, downCount, errorCount, JSON.stringify(details.slice(0, 40)), now),
  ];

  if (updatedCount > 0) {
    metaOps.push(
      env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
        "updated_at",
        now,
        now
      ),
      env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
        "pending_github_sync",
        "1",
        now
      )
    );
  }

  await env.DB.batch(metaOps);

  let autoPublishedCommit = "";
  if (
    source === "cron" &&
    updatedCount > 0 &&
    String(env.AUTO_PUBLISH_CRON || "true").toLowerCase() !== "false" &&
    env.GITHUB_TOKEN
  ) {
    try {
      const { catalog } = await readCatalogFromD1(env, { includeInternal: false });
      const pub = await ghCommitCatalog(
        catalog,
        env,
        `NAPL: sincronización automática de GitHub (${updatedCount} ports actualizados)`
      );
      autoPublishedCommit = pub.commit;
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
          "pending_github_sync",
          "0",
          now
        ),
        env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
          "last_github_publish_at",
          now,
          now
        ),
      ]);
    } catch {
      // Cron keeps D1 updated even if GitHub commit fails
    }
  }

  return {
    source,
    totalGithubPorts,
    checkedCount,
    updatedCount,
    downCount,
    errorCount,
    nextOffset: offset + checkedCount,
    hasMore: options.useOffset ? offset + checkedCount < totalGithubPorts : false,
    autoPublishedCommit,
    details,
    syncedAt: now,
  };
}

async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const isPublic = path === "/api/public/catalog";
  const headers = cors(req, env, isPublic);
  const origin = req.headers.get("Origin") || "";

  if (req.method === "OPTIONS") {
    const okOrigin = isPublic || !origin || isAllowedOrigin(origin, env);
    return new Response(null, { status: okOrigin ? 204 : 403, headers });
  }

  if (!isPublic && origin && !isAllowedOrigin(origin, env)) {
    return json({ error: "Origen no autorizado." }, 403, headers);
  }

  if (path === "/api/public/catalog" && req.method === "GET") {
    const { catalog } = await readCatalogFromD1(env, { includeInternal: false });
    const etag = `"napl-${catalog.updatedAt}"`;
    if (req.headers.get("If-None-Match") === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ...headers,
          ETag: etag,
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    }
    return new Response(JSON.stringify(catalog), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  }

  if (path === "/api/health" && req.method === "GET") {
    return json(
      {
        ok: true,
        localMode: false,
        d1: Boolean(env.DB),
        configured: {
          adminPassword: Boolean(env.ADMIN_PASSWORD),
          githubToken: Boolean(env.GITHUB_TOKEN),
          sessionSecret: Boolean(env.SESSION_SECRET),
          d1: Boolean(env.DB),
        },
      },
      200,
      headers
    );
  }

  if (path === "/api/login" && req.method === "POST") {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return json(
        { error: "Faltan secretos ADMIN_PASSWORD o SESSION_SECRET en Cloudflare." },
        503,
        headers
      );
    }
    const body = await req.json().catch(() => ({}));
    if (!equal(String(body.password || ""), env.ADMIN_PASSWORD)) {
      return json({ error: "Contraseña incorrecta." }, 401, headers);
    }
    return json({ token: await sessionToken(env), expiresIn: SESSION_TTL }, 200, headers);
  }

  if (path === "/api/logout" && req.method === "POST") {
    return json({ success: true }, 200, headers);
  }

  if (!path.startsWith("/api/")) {
    return json({ name: "NAPL API & D1 Sync Worker", ok: true }, 200, headers);
  }

  if (!(await authenticated(req, env))) {
    return json({ error: "Sesión inválida o vencida. Iniciá sesión nuevamente." }, 401, headers);
  }

  if (path === "/api/catalog" && req.method === "GET") {
    const data = await readCatalogFromD1(env, { includeInternal: true });
    return json({ ...data, exists: data.catalog.games.length > 0 }, 200, headers);
  }

  if (path === "/api/games" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const saved = await saveSingleGameInD1(env, null, body.game || body, true);
    const state = await readCatalogFromD1(env, { includeInternal: true });
    return json({ success: true, saved, ...state }, 200, headers);
  }

  const gameMatch = path.match(/^\/api\/games\/([^/]+)$/);
  if (gameMatch) {
    const targetSlug = decodeURIComponent(gameMatch[1]);
    if (req.method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const saved = await saveSingleGameInD1(env, targetSlug, body.game || body, false);
      const state = await readCatalogFromD1(env, { includeInternal: true });
      return json({ success: true, saved, ...state }, 200, headers);
    }
    if (req.method === "DELETE") {
      const removed = await deleteGameFromD1(env, targetSlug);
      const state = await readCatalogFromD1(env, { includeInternal: true });
      return json({ success: true, removed, ...state }, 200, headers);
    }
  }

  if (path === "/api/lookup/github" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const data = await inspectGithubRepo(body.url || body.repo, env);
    return json({ success: true, github: data }, 200, headers);
  }

  if (path === "/api/lookup/launchbox" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const data = await inspectLaunchboxUrl(body.url);
    return json({ success: true, launchbox: data }, 200, headers);
  }

  if (path === "/api/ports/sync" && req.method === "POST") {
    await ensureSeeded(env);
    const body = await req.json().catch(() => ({}));
    const portId = String(body.portId || "").trim();
    if (!portId) return json({ error: "portId requerido." }, 400, headers);
    const row = await env.DB.prepare("SELECT * FROM ports WHERE port_id = ?").bind(portId).first();
    if (!row) return json({ error: "Port no encontrado en D1." }, 404, headers);
    const result = await syncSinglePortWithGithub(env, row);
    if (result.changed) {
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
          "updated_at",
          now,
          now
        ),
        env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
          "pending_github_sync",
          "1",
          now
        ),
      ]);
    }
    const state = await readCatalogFromD1(env, { includeInternal: true });
    return json({ success: true, result, ...state }, 200, headers);
  }

  if (path === "/api/sync-github" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const result = await runGithubSyncBatch(env, {
      source: "manual",
      limit: body.limit || 20,
      offset: body.offset || 0,
      useOffset: Boolean(body.useOffset),
    });
    const state = await readCatalogFromD1(env, { includeInternal: true });
    return json({ success: true, sync: result, ...state }, 200, headers);
  }

  if (path === "/api/import-sheets" && req.method === "POST") {
    await ensureSeeded(env);
    const res = await fetch(SHEET_URL, { headers: { Accept: "text/csv" } });
    if (!res.ok) throw new Error(`Google Sheets HTTP ${res.status}`);
    const csv = await res.text();
    const rows = csvParse(csv);
    if (!rows.length) throw new Error("CSV vacío.");
    const imported = fromRows(rows);
    if (!imported.games.length) throw new Error("No se encontraron juegos válidos.");

    const oldState = await readCatalogFromD1(env, { includeInternal: false });
    const oldSet = new Set(oldState.catalog.games.map((g) => g.slug));
    const newSet = new Set(imported.games.map((g) => g.slug));

    await replaceWholeCatalogInD1(env, imported, { pendingGithubSync: true });
    const state = await readCatalogFromD1(env, { includeInternal: true });

    return json(
      {
        ...state,
        summary: {
          csvRows: rows.length,
          games: imported.games.length,
          ports: imported.games.reduce((n, g) => n + g.ports.length, 0),
          addedGames: imported.games.filter((g) => !oldSet.has(g.slug)).length,
          removedGames: Array.from(oldSet).filter((s) => !newSet.has(s)).length,
          characters: csv.length,
        },
      },
      200,
      headers
    );
  }

  if (path === "/api/publish" && req.method === "POST") {
    await ensureSeeded(env);
    const body = await req.json().catch(() => ({}));
    if (body.catalog) {
      await replaceWholeCatalogInD1(env, body.catalog, { pendingGithubSync: true });
    }
    const { catalog } = await readCatalogFromD1(env, { includeInternal: false });
    const pub = await ghCommitCatalog(catalog, env, "NAPL: actualizar catálogo JSON desde D1");
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
        "pending_github_sync",
        "0",
        now
      ),
      env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(
        "last_github_publish_at",
        now,
        now
      ),
    ]);
    const state = await readCatalogFromD1(env, { includeInternal: true });
    return json({ success: true, commit: pub.commit, sha: pub.sha, ...state }, 200, headers);
  }

  return json({ error: "Ruta no encontrada." }, 404, headers);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      const isPublic = new URL(request.url).pathname === "/api/public/catalog";
      return json(
        { error: error?.message || "Error interno." },
        500,
        cors(request, env, isPublic)
      );
    }
  },

  async scheduled(event, env, ctx) {
    const batchSize = Number(env.CRON_BATCH_SIZE) || DEFAULT_CRON_BATCH;
    ctx.waitUntil(
      runGithubSyncBatch(env, {
        source: "cron",
        limit: batchSize,
        useOffset: false,
      })
    );
  },
};