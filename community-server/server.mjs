import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787) || 8787;
const HOST = process.env.HOST || "0.0.0.0";
const SQLITE_PATH = path.resolve(
  __dirname,
  process.env.SQLITE_PATH || "./data/napl-community.sqlite"
);
const SCHEMA_PATH = path.join(__dirname, "schema.sql");
const GITHUB_DATA_REPO = process.env.GITHUB_DATA_REPO || "Fe2rr/NAPL-Data";
const TRUST_PROXY = String(process.env.TRUST_PROXY || "1") !== "0";
const DISCORD_WEBHOOK_URL = String(process.env.DISCORD_WEBHOOK_URL || "").trim();
const REPORTER_HASH_SECRET =
  String(process.env.REPORTER_HASH_SECRET || "").trim() ||
  crypto.randomBytes(32).toString("hex");

if (!process.env.REPORTER_HASH_SECRET) {
  console.warn(
    "NAPL community server: REPORTER_HASH_SECRET not set; using an ephemeral process key for link-report cooldown hashes."
  );
}

const DEFAULT_ORIGINS = [
  "https://fe2rr.github.io",
  "https://napl-catalog.pages.dev",
  "https://napl-admin.pages.dev",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const TOKEN_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.([A-Za-z0-9_-]{40,50}))?$/i;
const PORT_ID_RE = /^[a-z0-9][a-z0-9|._-]{0,119}$/i;
const GAME_KEY_RE = /^[a-z0-9][a-z0-9-]{0,179}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPAT_STATUSES = new Set([
  "crash",
  "low_fps",
  "playable_30",
  "playable_60",
]);
const LINK_REASONS = new Set([
  "Dead / 404 link",
  "Wrong game or version",
  "Requires account / paywall",
  "Suspicious / broken file",
]);

fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
const db = new DatabaseSync(SQLITE_PATH);
db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));

function withTransaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors
    }
    throw err;
  }
}

function seedDevicesIfEmpty() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM devices").get();
  if (Number(row?.count || 0) > 0) return;

  const candidates = [
    process.env.DEVICES_JSON_PATH,
    path.resolve(__dirname, "../public/assets/data/devices.json"),
    path.join(__dirname, "devices.json"),
  ].filter(Boolean);

  for (const devicesFile of candidates) {
    if (!fs.existsSync(devicesFile)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(devicesFile, "utf8"));
      const records = [];
      if (Array.isArray(parsed)) {
        records.push(...parsed);
      } else if (
        parsed?.format === "napl-device-catalog-shards-v1" &&
        Array.isArray(parsed.chunks)
      ) {
        const shardsDir = path.join(path.dirname(devicesFile), "device-catalog");
        for (const chunk of parsed.chunks) {
          const file = String(chunk?.file || "");
          if (!/^devices-part-\d{3}\.json$/.test(file)) continue;
          const chunkPath = path.join(shardsDir, file);
          if (!fs.existsSync(chunkPath)) continue;
          const part = JSON.parse(fs.readFileSync(chunkPath, "utf8"));
          if (Array.isArray(part)) records.push(...part);
        }
      }

      if (records.length > 0) {
        const insert = db.prepare(
          `INSERT INTO devices (id, name, manufacturer, model, soc, device_type)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             manufacturer = excluded.manufacturer,
             model = excluded.model,
             soc = excluded.soc,
             device_type = excluded.device_type`
        );
        withTransaction(() => {
          for (const d of records) {
            if (!d || typeof d.id !== "string" || typeof d.name !== "string") {
              continue;
            }
            const id = d.id.trim().slice(0, 200);
            const name = d.name.trim().slice(0, 240);
            if (!id || !name) continue;
            insert.run(
              id,
              name,
              String(d.manufacturer || ""),
              String(d.model || name),
              String(d.soc || ""),
              String(d.device_type || d.deviceType || "phone")
            );
          }
        });
        console.log(`Seeded ${records.length} devices from ${devicesFile}`);
        return;
      }
    } catch (err) {
      console.warn(`Could not seed devices from ${devicesFile}:`, err?.message || err);
    }
  }
}

seedDevicesIfEmpty();

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (
      u.protocol === "https:" &&
      (u.hostname.endsWith(".run.app") ||
        u.hostname.endsWith(".napl-admin.pages.dev") ||
        u.hostname.endsWith(".napl-catalog.pages.dev"))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function setSecurityHeaders(res, origin) {
  res.setHeader("Vary", "Origin");
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

function sendJson(res, status, data, cacheControl = "no-store") {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(data));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hmacSha256(value) {
  return crypto
    .createHmac("sha256", REPORTER_HASH_SECRET)
    .update(String(value))
    .digest("hex");
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const cfIp = String(req.headers["cf-connecting-ip"] || "").trim();
    if (cfIp) return cfIp;
    const realIp = String(req.headers["x-real-ip"] || "").trim();
    if (realIp) return realIp;
    const xff = String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    if (xff) return xff;
  }
  return String(req.socket?.remoteAddress || "unknown");
}

function dailyIpHash(req) {
  const day = new Date().toISOString().slice(0, 10);
  return sha256(`${clientIp(req)}:${day}`);
}

function readJsonBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("body_too_large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {}
        );
      } catch {
        reject(Object.assign(new Error("invalid_json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function utcWeekStart(date = new Date()) {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff)
  );
  return monday.toISOString().slice(0, 10);
}

function utcMonthStart(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-01`;
}

function hashVoterToken(value) {
  if (typeof value !== "string" || value.length > 200) {
    throw Object.assign(new Error("invalid_token"), { status: 401 });
  }
  const match = value.trim().match(TOKEN_RE);
  if (!match) {
    throw Object.assign(new Error("invalid_token"), { status: 401 });
  }
  return sha256(match[1].toLowerCase());
}

function isValidVoterTokenHash(tokenHash) {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM rating_tokens WHERE token_hash = ?
       UNION ALL
       SELECT 1 AS ok FROM rating_votes WHERE token_hash = ?
       LIMIT 1`
    )
    .get(tokenHash, tokenHash);
  return Boolean(row?.ok);
}

function getRatingsSummary() {
  const globalRow = db
    .prepare("SELECT COALESCE(AVG(stars), 0) AS global_avg FROM rating_votes")
    .get();
  const globalAvg = Number(globalRow?.global_avg || 0);
  const rows = db
    .prepare(
      `SELECT port_id, COUNT(*) AS votes, AVG(stars) AS avg
       FROM rating_votes
       GROUP BY port_id
       ORDER BY port_id ASC`
    )
    .all();

  const ports = rows.map((r) => {
    const votes = Number(r.votes || 0);
    const avg = Number(r.avg || 0);
    const score = (votes / (votes + 5)) * avg + (5 / (votes + 5)) * globalAvg;
    return {
      port_id: r.port_id,
      votes,
      avg: Number(avg.toFixed(2)),
      score: Number(score.toFixed(2)),
    };
  });

  return {
    ports,
    global_avg: Number(globalAvg.toFixed(2)),
  };
}

function getMyVotesMap(tokenHash) {
  const rows = db
    .prepare("SELECT port_id, stars FROM rating_votes WHERE token_hash = ?")
    .all(tokenHash);
  const votes = {};
  for (const r of rows) {
    votes[r.port_id] = Number(r.stars);
  }
  return votes;
}

function buildCompatibilityForPorts(portIds) {
  const out = {};
  const countsStmt = db.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('playable_30', 'playable_60') THEN 1 ELSE 0 END) AS yes_count,
       SUM(CASE WHEN status IN ('crash', 'low_fps') THEN 1 ELSE 0 END) AS no_count,
       SUM(CASE WHEN status = 'playable_60' THEN 1 ELSE 0 END) AS p60,
       SUM(CASE WHEN status = 'playable_30' THEN 1 ELSE 0 END) AS p30,
       SUM(CASE WHEN status = 'low_fps' THEN 1 ELSE 0 END) AS low_fps,
       SUM(CASE WHEN status = 'crash' THEN 1 ELSE 0 END) AS crash
     FROM compatibility_reports
     WHERE port_id = ?`
  );
  const reportsStmt = db.prepare(
    `SELECT
       r.device_id AS deviceId,
       COALESCE(NULLIF(d.model, ''), r.device_name) AS deviceName,
       COALESCE(d.soc, '') AS deviceSoc,
       COALESCE(NULLIF(d.device_type, ''), 'phone') AS deviceType,
       r.status AS status,
       r.updated_at AS updatedAt
     FROM compatibility_reports r
     LEFT JOIN devices d ON d.id = r.device_id
     WHERE r.port_id = ?
     ORDER BY r.updated_at DESC, r.id DESC
     LIMIT 30`
  );

  for (const portId of portIds) {
    const c = countsStmt.get(portId) || {};
    const reports = reportsStmt.all(portId).map((r) => ({
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      deviceSoc: r.deviceSoc,
      deviceType: r.deviceType,
      status: r.status,
      works: r.status === "playable_30" || r.status === "playable_60",
      updatedAt: r.updatedAt,
    }));

    out[portId] = {
      yes: Number(c.yes_count || 0),
      no: Number(c.no_count || 0),
      counts: {
        playable_60: Number(c.p60 || 0),
        playable_30: Number(c.p30 || 0),
        low_fps: Number(c.low_fps || 0),
        crash: Number(c.crash || 0),
      },
      reports,
    };
  }
  return out;
}

const patCache = new Map();
async function verifyGithubAdminPat(req) {
  const auth = String(req.headers.authorization || "");
  const pat = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!pat || pat.length > 256) return false;

  const key = sha256(pat);
  const cached = patCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) {
    return cached.ok;
  }

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_DATA_REPO}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "NAPL-Community-Server/1.0",
          Authorization: `Bearer ${pat}`,
        },
        signal: AbortSignal.timeout(7000),
      }
    );
    if (!ghRes.ok) {
      patCache.set(key, { ok: false, at: Date.now() });
      return false;
    }
    const repo = await ghRes.json().catch(() => ({}));
    const ok = Boolean(repo?.permissions?.push || repo?.permissions?.admin);
    if (patCache.size > 128) patCache.clear();
    patCache.set(key, { ok, at: Date.now() });
    return ok;
  } catch {
    return false;
  }
}

async function handleRatings(req, res, url) {
  const subPath = url.pathname.replace(/^\/(?:api\/)?ratings\/?/, "");
  if (req.method === "GET") {
    const action = String(url.searchParams.get("action") || subPath || "");
    if (action === "my-votes") {
      const tokenHash = hashVoterToken(String(url.searchParams.get("token") || ""));
      if (!isValidVoterTokenHash(tokenHash)) {
        return sendJson(res, 401, { error: "invalid_token" });
      }
      return sendJson(res, 200, { votes: getMyVotesMap(tokenHash) });
    }
    return sendJson(
      res,
      200,
      getRatingsSummary(),
      "public, max-age=15, s-maxage=30"
    );
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = await readJsonBody(req, 2048);
  const action = String(
    body.action || url.searchParams.get("action") || subPath || ""
  );

  if (action === "token") {
    const rawToken = crypto.randomUUID();
    const tokenHash = hashVoterToken(rawToken);
    const ipHash = dailyIpHash(req);
    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const allowed = withTransaction(() => {
      db.prepare("DELETE FROM rating_token_issues WHERE created_at < ?").run(
        cutoff24h
      );
      const countRow = db
        .prepare(
          "SELECT COUNT(*) AS n FROM rating_token_issues WHERE ip_hash = ? AND created_at > ?"
        )
        .get(ipHash, cutoff1h);
      if (Number(countRow?.n || 0) >= 10) return false;
      db.prepare(
        "INSERT INTO rating_token_issues (ip_hash, created_at) VALUES (?, ?)"
      ).run(ipHash, nowIso);
      db.prepare(
        "INSERT OR IGNORE INTO rating_tokens (token_hash, ip_hash, created_at) VALUES (?, ?, ?)"
      ).run(tokenHash, ipHash, nowIso);
      return true;
    });

    if (!allowed) return sendJson(res, 429, { error: "rate_limited" });
    return sendJson(res, 200, { token: rawToken });
  }

  const tokenHash = hashVoterToken(body.token);
  if (!isValidVoterTokenHash(tokenHash)) {
    return sendJson(res, 401, { error: "invalid_token" });
  }

  if (action === "my-votes") {
    return sendJson(res, 200, { votes: getMyVotesMap(tokenHash) });
  }

  if (action === "vote" || action === "unvote") {
    const portId = typeof body.port_id === "string" ? body.port_id.trim() : "";
    if (!PORT_ID_RE.test(portId)) {
      return sendJson(res, 400, { error: "invalid_port_id" });
    }
    if (action === "unvote") {
      db.prepare(
        "DELETE FROM rating_votes WHERE port_id = ? AND token_hash = ?"
      ).run(portId, tokenHash);
      return sendJson(res, 200, { ok: true, port_id: portId });
    }
    const stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return sendJson(res, 400, { error: "invalid_stars" });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const cutoff1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const rateLimited = withTransaction(() => {
      const existing = db
        .prepare(
          "SELECT 1 AS ok FROM rating_votes WHERE port_id = ? AND token_hash = ?"
        )
        .get(portId, tokenHash);
      if (!existing) {
        const recent = db
          .prepare(
            "SELECT COUNT(*) AS n FROM rating_votes WHERE token_hash = ? AND created_at > ?"
          )
          .get(tokenHash, cutoff1h);
        if (Number(recent?.n || 0) >= 20) return true;
      }
      db.prepare(
        `INSERT INTO rating_votes (port_id, token_hash, stars, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(port_id, token_hash) DO UPDATE SET
           stars = excluded.stars,
           updated_at = excluded.updated_at`
      ).run(portId, tokenHash, stars, nowIso, nowIso);
      return false;
    });

    if (rateLimited) return sendJson(res, 429, { error: "rate_limited" });
    return sendJson(res, 200, { ok: true, port_id: portId, stars });
  }

  return sendJson(res, 404, { error: "not_found" });
}

async function handlePopularity(req, res, url) {
  if (req.method === "GET") {
    const period = String(url.searchParams.get("period") || "week").toLowerCase();
    if (!["week", "month", "alltime"].includes(period)) {
      return sendJson(res, 400, { error: "invalid_period" });
    }

    const weekStart = utcWeekStart();
    const monthStart = utcMonthStart();
    let rows = [];
    if (period === "alltime") {
      rows = db
        .prepare(
          `SELECT game_key AS slug, all_time_visits AS visits
           FROM game_popularity
           WHERE all_time_visits > 0
           ORDER BY visits DESC, slug ASC`
        )
        .all();
    } else if (period === "month") {
      rows = db
        .prepare(
          `SELECT game_key AS slug, month_visits AS visits
           FROM game_popularity
           WHERE month_start = ? AND month_visits > 0
           ORDER BY visits DESC, slug ASC`
        )
        .all(monthStart);
    } else {
      rows = db
        .prepare(
          `SELECT game_key AS slug, week_visits AS visits
           FROM game_popularity
           WHERE week_start = ? AND week_visits > 0
           ORDER BY visits DESC, slug ASC`
        )
        .all(weekStart);
    }

    return sendJson(
      res,
      200,
      {
        success: true,
        period,
        games: rows.map((r) => ({ slug: r.slug, visits: Number(r.visits) || 0 })),
      },
      "public, max-age=20, s-maxage=30"
    );
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = await readJsonBody(req, 1024);
  const gameKey =
    typeof body.game === "string" ? body.game.trim().toLowerCase() : "";
  if (!GAME_KEY_RE.test(gameKey)) {
    return sendJson(res, 400, { error: "invalid_game" });
  }

  const ipHash = dailyIpHash(req);
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff20s = new Date(now.getTime() - 20_000).toISOString();
  const weekStart = utcWeekStart(now);
  const monthStart = utcMonthStart(now);

  const accepted = withTransaction(() => {
    const prev = db
      .prepare(
        "SELECT last_visit_at FROM game_popularity_visit_limits WHERE ip_hash = ? AND game_key = ?"
      )
      .get(ipHash, gameKey);
    if (prev && prev.last_visit_at >= cutoff20s) {
      return false;
    }

    db.prepare(
      `INSERT INTO game_popularity_visit_limits (ip_hash, game_key, last_visit_at)
       VALUES (?, ?, ?)
       ON CONFLICT(ip_hash, game_key) DO UPDATE SET last_visit_at = excluded.last_visit_at`
    ).run(ipHash, gameKey, nowIso);

    db.prepare(
      `INSERT INTO game_popularity (
         game_key, all_time_visits, week_visits, month_visits, week_start, month_start, updated_at
       ) VALUES (?, 1, 1, 1, ?, ?, ?)
       ON CONFLICT(game_key) DO UPDATE SET
         all_time_visits = game_popularity.all_time_visits + 1,
         week_visits = CASE
           WHEN game_popularity.week_start = excluded.week_start THEN game_popularity.week_visits + 1
           ELSE 1
         END,
         month_visits = CASE
           WHEN game_popularity.month_start = excluded.month_start THEN game_popularity.month_visits + 1
           ELSE 1
         END,
         week_start = excluded.week_start,
         month_start = excluded.month_start,
         updated_at = excluded.updated_at`
    ).run(gameKey, weekStart, monthStart, nowIso);
    return true;
  });

  return sendJson(res, 200, { success: true, counted: accepted });
}

async function handleCompatibility(req, res, url) {
  if (req.method === "GET") {
    const action = String(url.searchParams.get("action") || "");
    if (action === "devices") {
      const devices = db
        .prepare(
          `SELECT id, name, manufacturer, model, soc, device_type AS deviceType
           FROM devices
           WHERE trim(manufacturer) <> '' AND trim(model) <> '' AND trim(soc) <> ''
           ORDER BY name ASC`
        )
        .all();
      return sendJson(
        res,
        200,
        { success: true, devices },
        "public, max-age=3600"
      );
    }

    if (action === "search") {
      const deviceId = String(url.searchParams.get("device_id") || "").slice(
        0,
        200
      );
      const soc = String(url.searchParams.get("soc") || "").slice(0, 120);
      const q = String(url.searchParams.get("q") || "").slice(0, 120);
      const limit = Math.min(
        Math.max(Number(url.searchParams.get("limit")) || 500, 1),
        1000
      );

      if (!deviceId && !soc && !q) {
        return sendJson(res, 200, { success: true, reports: [] });
      }

      let rows = [];
      if (deviceId) {
        rows = db
          .prepare(
            `SELECT r.port_id AS portId, r.device_id AS deviceId,
                    COALESCE(NULLIF(d.model, ''), r.device_name) AS deviceName,
                    COALESCE(d.soc, '') AS deviceSoc,
                    COALESCE(NULLIF(d.device_type, ''), 'phone') AS deviceType,
                    r.status, r.updated_at AS updatedAt
             FROM compatibility_reports r
             LEFT JOIN devices d ON d.id = r.device_id
             WHERE r.device_id = ?
             ORDER BY r.updated_at DESC, r.id DESC
             LIMIT ?`
          )
          .all(deviceId, limit);
      } else if (soc) {
        rows = db
          .prepare(
            `SELECT r.port_id AS portId, r.device_id AS deviceId,
                    COALESCE(NULLIF(d.model, ''), r.device_name) AS deviceName,
                    COALESCE(d.soc, '') AS deviceSoc,
                    COALESCE(NULLIF(d.device_type, ''), 'phone') AS deviceType,
                    r.status, r.updated_at AS updatedAt
             FROM compatibility_reports r
             JOIN devices d ON d.id = r.device_id
             WHERE lower(d.soc) = lower(?)
             ORDER BY r.updated_at DESC, r.id DESC
             LIMIT ?`
          )
          .all(soc, limit);
      } else {
        const pattern = `%${q.toLowerCase()}%`;
        rows = db
          .prepare(
            `SELECT r.port_id AS portId, r.device_id AS deviceId,
                    COALESCE(NULLIF(d.model, ''), r.device_name) AS deviceName,
                    COALESCE(d.soc, '') AS deviceSoc,
                    COALESCE(NULLIF(d.device_type, ''), 'phone') AS deviceType,
                    r.status, r.updated_at AS updatedAt
             FROM compatibility_reports r
             LEFT JOIN devices d ON d.id = r.device_id
             WHERE lower(r.device_name) LIKE ?
                OR lower(COALESCE(d.model, '')) LIKE ?
                OR lower(COALESCE(d.soc, '')) LIKE ?
             ORDER BY r.updated_at DESC, r.id DESC
             LIMIT ?`
          )
          .all(pattern, pattern, pattern, limit);
      }

      const reports = rows.map((r) => ({
        portId: r.portId,
        deviceId: r.deviceId,
        deviceName: r.deviceName,
        deviceSoc: r.deviceSoc,
        deviceType: r.deviceType,
        status: r.status,
        works: r.status === "playable_30" || r.status === "playable_60",
        updatedAt: r.updatedAt,
      }));

      return sendJson(
        res,
        200,
        { success: true, reports },
        "public, max-age=20, s-maxage=40"
      );
    }

    const ids = [
      ...new Set(
        String(url.searchParams.get("port_ids") || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      ),
    ].slice(0, 50);

    if (ids.some((x) => x.length > 120)) {
      return sendJson(res, 400, { success: false, error: "Invalid port ID." });
    }

    const compatibility = buildCompatibilityForPorts(ids);
    return sendJson(
      res,
      200,
      { success: true, compatibility },
      "public, max-age=30, s-maxage=60"
    );
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const b = await readJsonBody(req, 4096);
  const portId = String(b.port_id || "").trim();
  const deviceId = String(b.device_id || "").trim();
  const rawToken = String(b.token || "").trim();
  const rawStatus = String(b.status || "").trim();
  const worksInput =
    typeof b.works === "boolean"
      ? b.works
      : b.works === 1
      ? true
      : b.works === 0
      ? false
      : null;

  const status = COMPAT_STATUSES.has(rawStatus)
    ? rawStatus
    : worksInput === true
    ? "playable_30"
    : worksInput === false
    ? "crash"
    : "";

  if (
    !portId ||
    portId.length > 120 ||
    !PORT_ID_RE.test(portId) ||
    !deviceId ||
    deviceId.length > 200 ||
    !rawToken ||
    rawToken.length > 512 ||
    !status
  ) {
    return sendJson(res, 400, {
      success: false,
      error: "port_id, device_id, token, and a valid status are required.",
    });
  }

  const device = db
    .prepare(
      "SELECT id, name, model, soc, device_type FROM devices WHERE id = ?"
    )
    .get(deviceId);
  if (!device) {
    return sendJson(res, 400, {
      success: false,
      error: "Invalid device_id. Please select a device from the list.",
    });
  }

  const works = status === "playable_30" || status === "playable_60" ? 1 : 0;
  const tokenHash = sha256(rawToken);
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO compatibility_reports (port_id, token_hash, device_id, device_name, works, updated_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(port_id, token_hash, device_id) DO UPDATE SET
       device_name = excluded.device_name,
       works = excluded.works,
       updated_at = excluded.updated_at,
       status = excluded.status`
  ).run(portId, tokenHash, device.id, device.name, works, nowIso, status);

  const summaryMap = buildCompatibilityForPorts([portId]);
  return sendJson(res, 200, {
    success: true,
    report: {
      portId,
      deviceId: device.id,
      deviceName: device.model || device.name,
      deviceSoc: device.soc || "",
      deviceType: device.device_type || "phone",
      status,
      works: Boolean(works),
      updatedAt: nowIso,
    },
    summary: summaryMap[portId] || null,
  });
}

async function handleReportLink(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const b = await readJsonBody(req, 2048);
  const portId = String(b.port_id || "")
    .trim()
    .slice(0, 120);
  const reason = String(b.reason || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const note = String(b.note || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const clientId = String(b.client_id || b.token || "").trim();
  const rawUrl = String(b.url || "")
    .trim()
    .slice(0, 500);

  const validReason = LINK_REASONS.has(reason);
  const validCustomNote = !reason && note.length >= 3;
  if (
    !PORT_ID_RE.test(portId) ||
    (!validReason && !validCustomNote) ||
    !UUID_RE.test(clientId)
  ) {
    return sendJson(res, 400, {
      success: false,
      error: "Invalid report details.",
    });
  }

  let normalizedUrl = "";
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!["https:", "http:"].includes(parsed.protocol)) {
        throw new Error("bad_protocol");
      }
      normalizedUrl = parsed.toString();
    } catch {
      return sendJson(res, 400, {
        success: false,
        error: "Invalid report URL.",
      });
    }
  }

  const reporterHash = hmacSha256(`${clientId}:${clientIp(req)}`);
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff10mMs = now.getTime() - 10 * 60 * 1000;

  const reservation = withTransaction(() => {
    const existing = db
      .prepare(
        "SELECT last_report_at FROM link_report_rate_limits WHERE reporter_hash = ?"
      )
      .get(reporterHash);
    if (existing) {
      const lastMs = Date.parse(existing.last_report_at);
      if (Number.isFinite(lastMs) && lastMs > cutoff10mMs) {
        const retry = Math.max(
          1,
          Math.ceil((lastMs + 10 * 60 * 1000 - now.getTime()) / 1000)
        );
        return { allowed: false, retry_after_seconds: retry };
      }
    }
    db.prepare(
      `INSERT INTO link_report_rate_limits (reporter_hash, last_report_at)
       VALUES (?, ?)
       ON CONFLICT(reporter_hash) DO UPDATE SET last_report_at = excluded.last_report_at`
    ).run(reporterHash, nowIso);
    return { allowed: true, retry_after_seconds: 0 };
  });

  if (!reservation.allowed) {
    const retry = reservation.retry_after_seconds || 600;
    res.setHeader("Retry-After", String(retry));
    return sendJson(res, 429, {
      success: false,
      error: `You can submit another report in ${Math.ceil(retry / 60)} minute(s).`,
      retry_after_seconds: retry,
    });
  }

  const displayReason = reason || "Custom note";
  db.prepare(
    `INSERT INTO link_reports (port_id, reporter_hash, reason, note, url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(port_id, reporter_hash) DO UPDATE SET
       reason = excluded.reason,
       note = excluded.note,
       url = excluded.url,
       updated_at = excluded.updated_at`
  ).run(
    portId,
    reporterHash,
    displayReason,
    note,
    normalizedUrl,
    nowIso,
    nowIso
  );

  let notified = false;
  if (DISCORD_WEBHOOK_URL) {
    try {
      const r = await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allowed_mentions: { parse: [] },
          embeds: [
            {
              title: "NAPL — Broken Link Report",
              color: 15158332,
              fields: [
                { name: "Port ID", value: portId },
                { name: "Reason", value: displayReason },
                { name: "Note", value: note || "N/A" },
                { name: "URL", value: normalizedUrl || "N/A" },
              ],
              timestamp: nowIso,
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      });
      notified = r.ok;
    } catch (err) {
      console.warn("Discord webhook notification failed:", err?.message || err);
    }
  }

  return sendJson(res, 200, {
    success: true,
    portId,
    reason: displayReason,
    note,
    notification_sent: notified,
  });
}

async function handleAdminDashboard(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  if (!(await verifyGithubAdminPat(req))) {
    return sendJson(res, 401, {
      success: false,
      error: "admin_github_pat_invalid",
    });
  }

  const reports = db
    .prepare(
      "SELECT id, port_id, reason, note, url, created_at, updated_at FROM link_reports ORDER BY updated_at DESC LIMIT 100"
    )
    .all();
  const compatibility = db
    .prepare(
      "SELECT id, port_id, device_id, device_name, works, status, updated_at FROM compatibility_reports ORDER BY updated_at DESC LIMIT 100"
    )
    .all()
    .map((r) => ({ ...r, works: Boolean(r.works) }));
  const ratings = db
    .prepare(
      "SELECT id, port_id, stars, created_at, updated_at FROM rating_votes ORDER BY created_at DESC LIMIT 100"
    )
    .all();
  const popularity = db
    .prepare(
      "SELECT game_key, all_time_visits, week_visits, month_visits, week_start, month_start, updated_at FROM game_popularity ORDER BY all_time_visits DESC LIMIT 1000"
    )
    .all();
  const totals = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM link_reports) AS linkReports,
        (SELECT COUNT(*) FROM compatibility_reports) AS compatibilityReports,
        (SELECT COUNT(*) FROM rating_votes) AS ratingVotes,
        (SELECT COUNT(*) FROM game_popularity) AS gamesTracked,
        (SELECT COALESCE(SUM(all_time_visits), 0) FROM game_popularity) AS allTimeVisits,
        (SELECT COALESCE(SUM(week_visits), 0) FROM game_popularity) AS weekVisits,
        (SELECT COALESCE(SUM(month_visits), 0) FROM game_popularity) AS monthVisits`
    )
    .get();

  return sendJson(res, 200, {
    success: true,
    totals: totals || {},
    reports,
    compatibility,
    ratings,
    popularity,
  });
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || "").trim();
  setSecurityHeaders(res, origin);

  if (req.method === "OPTIONS") {
    res.statusCode = !origin || isAllowedOrigin(origin) ? 204 : 403;
    res.end();
    return;
  }

  if (origin && !isAllowedOrigin(origin)) {
    return sendJson(res, 403, { success: false, error: "Origin not allowed" });
  }

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/health" || pathname === "/api/health") {
      const stats = db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM devices) AS devices,
            (SELECT COUNT(*) FROM rating_votes) AS votes,
            (SELECT COUNT(*) FROM game_popularity) AS gamesTracked,
            (SELECT COUNT(*) FROM compatibility_reports) AS compatibilityReports,
            (SELECT COUNT(*) FROM link_reports) AS linkReports`
        )
        .get();
      return sendJson(res, 200, { ok: true, storage: "sqlite-wal", stats });
    }

    if (pathname === "/ratings" || pathname.startsWith("/ratings/") || pathname === "/api/ratings" || pathname.startsWith("/api/ratings/")) {
      return await handleRatings(req, res, url);
    }
    if (pathname === "/popularity" || pathname === "/api/popularity") {
      return await handlePopularity(req, res, url);
    }
    if (pathname === "/compatibility" || pathname === "/api/compatibility") {
      return await handleCompatibility(req, res, url);
    }
    if (pathname === "/report-link" || pathname === "/api/report-link") {
      return await handleReportLink(req, res);
    }
    if (pathname === "/admin-dashboard" || pathname === "/api/admin-dashboard") {
      return await handleAdminDashboard(req, res);
    }

    return sendJson(res, 404, { error: "not_found" });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status === 401 || status === 400 || status === 413) {
      return sendJson(res, status, { error: err.message });
    }
    console.error("NAPL community server error:", err);
    return sendJson(res, 500, { error: "server_error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NAPL community server listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
