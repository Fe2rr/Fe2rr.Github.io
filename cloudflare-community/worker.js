/**
 * NAPL Community-Only Cloudflare Worker + D1
 *
 * Handles ONLY real-time anonymous community writes and interactive queries
 * (ratings, popularity, compatibility, link reports, plus GitHub PAT-protected
 * snapshot/digest/dashboard endpoints). All catalog files, images, sync,
 * lookups, admin edits, and public summaries run on GitHub.
 */

const TOKEN_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.([A-Za-z0-9_-]{40,50}))?$/i;
const PORT_ID_RE = /^[a-z0-9][a-z0-9|._-]{0,119}$/i;
const GAME_KEY_RE = /^[a-z0-9][a-z0-9-]{0,179}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COMPAT_STATUSES = new Set(["crash", "low_fps", "playable_30", "playable_60"]);
const LINK_REASONS = new Set([
  "Dead / 404 link",
  "Wrong game or version",
  "Requires account / paywall",
  "Suspicious / broken file",
]);

const DEFAULT_ORIGINS = [
  "https://fe2rr.github.io",
  "https://napl-admin.pages.dev",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  return Boolean(origin) && getAllowedOrigins(env).includes(origin);
}

function buildSecurityHeaders(origin, env, extra = {}) {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...extra,
  });
  if (origin && isAllowedOrigin(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(origin, env, status, data, cacheControl = "no-store", extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: buildSecurityHeaders(origin, env, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      ...extraHeaders,
    }),
  });
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(req) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function dailyIpHash(req) {
  const day = new Date().toISOString().slice(0, 10);
  return sha256Hex(`${clientIp(req)}:${day}`);
}

async function readJsonBody(req, maxBytes = 4096) {
  const cl = Number(req.headers.get("content-length") || 0);
  if (cl > maxBytes) {
    throw Object.assign(new Error("body_too_large"), { status: 413 });
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw Object.assign(new Error("body_too_large"), { status: 413 });
  }
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
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
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function hashVoterToken(value) {
  if (typeof value !== "string" || value.length > 200) {
    throw Object.assign(new Error("invalid_token"), { status: 401 });
  }
  const match = value.trim().match(TOKEN_RE);
  if (!match) {
    throw Object.assign(new Error("invalid_token"), { status: 401 });
  }
  return sha256Hex(match[1].toLowerCase());
}

async function isValidVoterTokenHash(db, tokenHash) {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM rating_tokens WHERE token_hash = ?
       UNION ALL
       SELECT 1 AS ok FROM rating_votes WHERE token_hash = ?
       LIMIT 1`
    )
    .bind(tokenHash, tokenHash)
    .first();
  return Boolean(row?.ok);
}

const patCache = new Map();
async function verifyGithubAdminPat(req, env) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.length > 256) return false;

  const key = await sha256Hex(token);
  const cached = patCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.ok;

  const repoSlug = env.GITHUB_DATA_REPO || "Fe2rr/NAPL-Data";
  try {
    const res = await fetch(`https://api.github.com/repos/${repoSlug}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NAPL-Community-D1/1.0",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      patCache.set(key, { at: Date.now(), ok: false });
      return false;
    }
    const repo = await res.json().catch(() => ({}));
    const ok = Boolean(repo?.permissions?.push || repo?.permissions?.admin);
    if (patCache.size > 64) patCache.clear();
    patCache.set(key, { at: Date.now(), ok });
    return ok;
  } catch {
    return false;
  }
}

async function getRatingsSummary(db, maxPorts = 249) {
  const meta = await db
    .prepare("SELECT total_votes, total_sum FROM rating_global_meta WHERE id = 1")
    .first();
  const totalVotes = Number(meta?.total_votes || 0);
  const totalSum = Number(meta?.total_sum || 0);
  const globalAvg = totalVotes > 0 ? totalSum / totalVotes : 0;
  const limit = Math.min(Math.max(Number(maxPorts) || 249, 1), 1000);

  const { results } = await db
    .prepare(
      "SELECT port_id, votes, sum_stars FROM rating_port_stats WHERE votes > 0 ORDER BY votes DESC, port_id ASC LIMIT ?"
    )
    .bind(limit)
    .all();

  const ports = (results || []).map((r) => {
    const votes = Number(r.votes || 0);
    const avg = votes > 0 ? Number(r.sum_stars || 0) / votes : 0;
    const score = (votes / (votes + 5)) * avg + (5 / (votes + 5)) * globalAvg;
    return {
      port_id: r.port_id,
      votes,
      avg: Number(avg.toFixed(2)),
      score: Number(score.toFixed(2)),
    };
  });

  return { ports, global_avg: Number(globalAvg.toFixed(2)) };
}

async function handleRatings(req, url, env, origin) {
  const db = env.DB;
  const subPath = url.pathname.replace(/^\/(?:api\/)?ratings\/?/, "");

  if (req.method === "GET") {
    const action = String(url.searchParams.get("action") || subPath || "");
    if (action === "my-votes") {
      const tokenHash = await hashVoterToken(url.searchParams.get("token") || "");
      if (!(await isValidVoterTokenHash(db, tokenHash))) {
        return json(origin, env, 401, { error: "invalid_token" });
      }
      const { results } = await db
        .prepare("SELECT port_id, stars FROM rating_votes WHERE token_hash = ? LIMIT 250")
        .bind(tokenHash)
        .all();
      const votes = {};
      for (const r of results || []) votes[r.port_id] = Number(r.stars);
      return json(origin, env, 200, { votes });
    }

    return json(origin, env, 200, await getRatingsSummary(db, 249), "public, max-age=60, s-maxage=300");
  }

  if (req.method !== "POST") {
    return json(origin, env, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "GET, POST, OPTIONS",
    });
  }

  const body = await readJsonBody(req, 2048);
  const action = String(body.action || url.searchParams.get("action") || subPath || "");

  if (action === "token") {
    const rawToken = crypto.randomUUID();
    const tokenHash = await hashVoterToken(rawToken);
    const ipHash = await dailyIpHash(req);
    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const countRow = await db
      .prepare("SELECT COUNT(*) AS n FROM rating_token_issues WHERE ip_hash = ? AND created_at > ?")
      .bind(ipHash, cutoff1h)
      .first();
    if (Number(countRow?.n || 0) >= 10) {
      return json(origin, env, 429, { error: "rate_limited" });
    }

    await db.batch([
      db.prepare("DELETE FROM rating_token_issues WHERE created_at < ?").bind(cutoff24h),
      db
        .prepare("INSERT INTO rating_token_issues (ip_hash, created_at) VALUES (?, ?)")
        .bind(ipHash, nowIso),
      db
        .prepare("INSERT OR IGNORE INTO rating_tokens (token_hash, ip_hash, created_at) VALUES (?, ?, ?)")
        .bind(tokenHash, ipHash, nowIso),
    ]);

    return json(origin, env, 200, { token: rawToken });
  }

  const tokenHash = await hashVoterToken(body.token);
  if (!(await isValidVoterTokenHash(db, tokenHash))) {
    return json(origin, env, 401, { error: "invalid_token" });
  }

  if (action === "my-votes") {
    const { results } = await db
      .prepare("SELECT port_id, stars FROM rating_votes WHERE token_hash = ? LIMIT 250")
      .bind(tokenHash)
      .all();
    const votes = {};
    for (const r of results || []) votes[r.port_id] = Number(r.stars);
    return json(origin, env, 200, { votes });
  }

  if (action === "vote" || action === "unvote") {
    const portId = typeof body.port_id === "string" ? body.port_id.trim() : "";
    if (!PORT_ID_RE.test(portId)) {
      return json(origin, env, 400, { error: "invalid_port_id" });
    }

    const existing = await db
      .prepare("SELECT stars FROM rating_votes WHERE port_id = ? AND token_hash = ?")
      .bind(portId, tokenHash)
      .first();
    const nowIso = new Date().toISOString();

    if (action === "unvote") {
      if (!existing) return json(origin, env, 200, { ok: true, port_id: portId });
      const oldStars = Number(existing.stars || 0);
      await db.batch([
        db
          .prepare("DELETE FROM rating_votes WHERE port_id = ? AND token_hash = ?")
          .bind(portId, tokenHash),
        db
          .prepare(
            `UPDATE rating_port_stats
             SET votes = MAX(0, votes - 1),
                 sum_stars = MAX(0, sum_stars - ?),
                 updated_at = ?
             WHERE port_id = ?`
          )
          .bind(oldStars, nowIso, portId),
        db
          .prepare(
            `UPDATE rating_global_meta
             SET total_votes = MAX(0, total_votes - 1),
                 total_sum = MAX(0, total_sum - ?),
                 updated_at = ?
             WHERE id = 1`
          )
          .bind(oldStars, nowIso),
      ]);
      return json(origin, env, 200, { ok: true, port_id: portId });
    }

    const stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return json(origin, env, 400, { error: "invalid_stars" });
    }

    const cutoff1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    if (!existing) {
      const recent = await db
        .prepare("SELECT COUNT(*) AS n FROM rating_votes WHERE token_hash = ? AND created_at > ?")
        .bind(tokenHash, cutoff1h)
        .first();
      if (Number(recent?.n || 0) >= 20) {
        return json(origin, env, 429, { error: "rate_limited" });
      }
    }

    const oldStars = Number(existing?.stars || 0);
    const voteDelta = existing ? 0 : 1;
    const starDelta = stars - oldStars;

    await db.batch([
      db
        .prepare(
          `INSERT INTO rating_votes (port_id, token_hash, stars, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(port_id, token_hash) DO UPDATE SET
             stars = excluded.stars,
             updated_at = excluded.updated_at`
        )
        .bind(portId, tokenHash, stars, nowIso, nowIso),
      db
        .prepare(
          `INSERT INTO rating_port_stats (port_id, votes, sum_stars, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(port_id) DO UPDATE SET
             votes = MAX(0, rating_port_stats.votes + ?),
             sum_stars = MAX(0, rating_port_stats.sum_stars + ?),
             updated_at = excluded.updated_at`
        )
        .bind(portId, voteDelta, starDelta, nowIso, voteDelta, starDelta),
      db
        .prepare(
          `UPDATE rating_global_meta
           SET total_votes = MAX(0, total_votes + ?),
               total_sum = MAX(0, total_sum + ?),
               updated_at = ?
           WHERE id = 1`
        )
        .bind(voteDelta, starDelta, nowIso),
    ]);

    const [portStats, globalMeta] = await Promise.all([
      db.prepare("SELECT votes, sum_stars FROM rating_port_stats WHERE port_id = ?").bind(portId).first(),
      db.prepare("SELECT total_votes, total_sum FROM rating_global_meta WHERE id = 1").first(),
    ]);
    const votes = Number(portStats?.votes || 0);
    const avg = votes > 0 ? Number(portStats?.sum_stars || 0) / votes : 0;
    const totalVotes = Number(globalMeta?.total_votes || 0);
    const globalAvg = totalVotes > 0 ? Number(globalMeta?.total_sum || 0) / totalVotes : 0;
    const score = votes > 0 ? (votes / (votes + 5)) * avg + (5 / (votes + 5)) * globalAvg : 0;
    return json(origin, env, 200, {
      ok: true, port_id: portId, stars,
      rating: { avg: Number(avg.toFixed(2)), votes, score: Number(score.toFixed(2)) },
    });
  }

  return json(origin, env, 404, { error: "not_found" });
}

async function getPopularityPeriod(db, period) {
  const weekStart = utcWeekStart();
  const monthStart = utcMonthStart();
  let rows = [];

  if (period === "alltime") {
    const res = await db
      .prepare(
        `SELECT game_key AS slug, all_time_visits AS visits
         FROM game_popularity
         WHERE all_time_visits > 0
         ORDER BY all_time_visits DESC, game_key ASC
         LIMIT 250`
      )
      .all();
    rows = res.results || [];
  } else if (period === "month") {
    const res = await db
      .prepare(
        `SELECT game_key AS slug, month_visits AS visits
         FROM game_popularity
         WHERE month_start = ? AND month_visits > 0
         ORDER BY month_visits DESC, game_key ASC
         LIMIT 250`
      )
      .bind(monthStart)
      .all();
    rows = res.results || [];
  } else {
    const res = await db
      .prepare(
        `SELECT game_key AS slug, week_visits AS visits
         FROM game_popularity
         WHERE week_start = ? AND week_visits > 0
         ORDER BY week_visits DESC, game_key ASC
         LIMIT 250`
      )
      .bind(weekStart)
      .all();
    rows = res.results || [];
  }

  return rows.map((r) => ({ slug: r.slug, visits: Number(r.visits) || 0 }));
}

async function handlePopularity(req, url, env, origin) {
  const db = env.DB;

  if (req.method === "GET") {
    const period = String(url.searchParams.get("period") || "week").toLowerCase();
    if (!["week", "month", "alltime"].includes(period)) {
      return json(origin, env, 400, { error: "invalid_period" });
    }
    const games = await getPopularityPeriod(db, period);
    return json(
      origin,
      env,
      200,
      { success: true, period, games },
      "public, max-age=60, s-maxage=300"
    );
  }

  if (req.method !== "POST") {
    return json(origin, env, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "GET, POST, OPTIONS",
    });
  }

  const body = await readJsonBody(req, 1024);
  const gameKey = typeof body.game === "string" ? body.game.trim().toLowerCase() : "";
  if (!GAME_KEY_RE.test(gameKey)) {
    return json(origin, env, 400, { error: "invalid_game" });
  }

  const ipHash = await dailyIpHash(req);
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff20s = new Date(now.getTime() - 20_000).toISOString();

  const visitLimit = await db
    .prepare(
      "INSERT INTO game_popularity_visit_limits (ip_hash, game_key, last_visit_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(ip_hash, game_key) DO UPDATE SET last_visit_at = excluded.last_visit_at " +
      "WHERE game_popularity_visit_limits.last_visit_at < ?"
    )
    .bind(ipHash, gameKey, nowIso, cutoff20s)
    .run();

  if (Number(visitLimit.meta?.changes || 0) === 0) {
    return json(origin, env, 200, { success: true, counted: false });
  }

  const weekStart = utcWeekStart(now);
  const monthStart = utcMonthStart(now);
  await db
    .prepare(
      "INSERT INTO game_popularity (game_key, all_time_visits, week_visits, month_visits, week_start, month_start, updated_at) " +
      "VALUES (?, 1, 1, 1, ?, ?, ?) " +
      "ON CONFLICT(game_key) DO UPDATE SET " +
      "all_time_visits = game_popularity.all_time_visits + 1, " +
      "week_visits = CASE WHEN game_popularity.week_start = excluded.week_start THEN game_popularity.week_visits + 1 ELSE 1 END, " +
      "month_visits = CASE WHEN game_popularity.month_start = excluded.month_start THEN game_popularity.month_visits + 1 ELSE 1 END, " +
      "week_start = excluded.week_start, month_start = excluded.month_start, updated_at = excluded.updated_at"
    )
    .bind(gameKey, weekStart, monthStart, nowIso)
    .run();

  return json(origin, env, 200, { success: true, counted: true });
}

async function buildCompatibilityForPorts(db, portIds) {
  const out = {};
  if (!portIds.length) return out;

  // Dynamic limit ensures total rows read stays strictly <= 220 even with multiple ports
  const perPortReportLimit = portIds.length > 5 ? 20 : 30;
  const placeholders = portIds.map(() => "?").join(", ");
  const statsRes = await db
    .prepare(
      `SELECT port_id, yes_count, no_count, p60, p30, low_fps, crash
       FROM compat_port_stats
       WHERE port_id IN (${placeholders})`
    )
    .bind(...portIds)
    .all();

  const statsMap = new Map();
  for (const row of statsRes.results || []) {
    statsMap.set(row.port_id, row);
  }

  for (const portId of portIds) {
    const c = statsMap.get(portId);
    const reportsRes = await db
      .prepare(
        `SELECT device_id AS deviceId, device_name AS deviceName, device_soc AS deviceSoc,
                device_type AS deviceType, status, updated_at AS updatedAt
         FROM compatibility_reports
         WHERE port_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`
      )
      .bind(portId, perPortReportLimit)
      .all();

    out[portId] = {
      yes: Number(c?.yes_count || 0),
      no: Number(c?.no_count || 0),
      counts: {
        playable_60: Number(c?.p60 || 0),
        playable_30: Number(c?.p30 || 0),
        low_fps: Number(c?.low_fps || 0),
        crash: Number(c?.crash || 0),
      },
      reports: (reportsRes.results || []).map((r) => ({
        deviceId: r.deviceId,
        deviceName: r.deviceName,
        deviceSoc: r.deviceSoc || "",
        deviceType: r.deviceType || "phone",
        status: r.status,
        works: r.status === "playable_30" || r.status === "playable_60",
        updatedAt: r.updatedAt,
      })),
    };
  }

  return out;
}

async function handleCompatibility(req, url, env, origin) {
  const db = env.DB;

  if (req.method === "GET") {
    const action = String(url.searchParams.get("action") || "");
    if (action === "search") {
      const deviceId = String(url.searchParams.get("device_id") || "").slice(0, 200);
      const soc = String(url.searchParams.get("soc") || "").slice(0, 120);
      const q = String(url.searchParams.get("q") || "").slice(0, 120);
      // Cap search reads strictly <= 200 rows per visit
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 200);

      if (!deviceId && !soc && !q) {
        return json(origin, env, 200, { success: true, reports: [] });
      }

      let rows = [];
      if (deviceId) {
        const res = await db
          .prepare(
            `SELECT port_id AS portId, device_id AS deviceId, device_name AS deviceName,
                    device_soc AS deviceSoc, device_type AS deviceType, status, updated_at AS updatedAt
             FROM compatibility_reports
             WHERE device_id = ?
             ORDER BY updated_at DESC, id DESC
             LIMIT ?`
          )
          .bind(deviceId, limit)
          .all();
        rows = res.results || [];
      } else if (soc) {
        const res = await db
          .prepare(
            `SELECT port_id AS portId, device_id AS deviceId, device_name AS deviceName,
                    device_soc AS deviceSoc, device_type AS deviceType, status, updated_at AS updatedAt
             FROM compatibility_reports
             WHERE device_soc = ? COLLATE NOCASE
             ORDER BY updated_at DESC, id DESC
             LIMIT ?`
          )
          .bind(soc, limit)
          .all();
        rows = res.results || [];
      } else {
        const cleanQuery = q.replace(/[\\%_]/g, "").trim().toLowerCase();
        if (cleanQuery) {
          const prefix = cleanQuery + "%";
          const perFieldLimit = Math.max(1, Math.ceil(limit / 2));
          const [nameRes, socRes] = await Promise.all([
            db
              .prepare(
                "SELECT port_id AS portId, device_id AS deviceId, device_name AS deviceName, " +
                "device_soc AS deviceSoc, device_type AS deviceType, status, updated_at AS updatedAt " +
                "FROM compatibility_reports WHERE device_name LIKE ? COLLATE NOCASE " +
                "ORDER BY device_name COLLATE NOCASE, updated_at DESC, id DESC LIMIT ?"
              )
              .bind(prefix, perFieldLimit)
              .all(),
            db
              .prepare(
                "SELECT port_id AS portId, device_id AS deviceId, device_name AS deviceName, " +
                "device_soc AS deviceSoc, device_type AS deviceType, status, updated_at AS updatedAt " +
                "FROM compatibility_reports WHERE device_soc LIKE ? COLLATE NOCASE " +
                "ORDER BY device_soc COLLATE NOCASE, updated_at DESC, id DESC LIMIT ?"
              )
              .bind(prefix, perFieldLimit)
              .all(),
          ]);
          const seen = new Set();
          for (const row of [...(nameRes.results || []), ...(socRes.results || [])]) {
            const key = JSON.stringify([row.portId, row.deviceId]);
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push(row);
            if (rows.length >= limit) break;
          }
        }
      }

      const reports = rows.map((r) => ({
        portId: r.portId,
        deviceId: r.deviceId,
        deviceName: r.deviceName,
        deviceSoc: r.deviceSoc || "",
        deviceType: r.deviceType || "phone",
        status: r.status,
        works: r.status === "playable_30" || r.status === "playable_60",
        updatedAt: r.updatedAt,
      }));

      return json(origin, env, 200, { success: true, reports }, "public, max-age=30, s-maxage=60");
    }

    const ids = [
      ...new Set(
        String(url.searchParams.get("port_ids") || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      ),
    ].slice(0, 10);

    if (ids.some((x) => x.length > 120)) {
      return json(origin, env, 400, { success: false, error: "Invalid port ID." });
    }

    const compatibility = await buildCompatibilityForPorts(db, ids);
    return json(
      origin,
      env,
      200,
      { success: true, compatibility },
      "public, max-age=30, s-maxage=60"
    );
  }

  if (req.method !== "POST") {
    return json(origin, env, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "GET, POST, OPTIONS",
    });
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
    return json(origin, env, 400, {
      success: false,
      error: "port_id, device_id, token, and a valid status are required.",
    });
  }

  // 1-row primary key lookup in D1
  const device = await db
    .prepare("SELECT id, name, model, soc, device_type FROM devices WHERE id = ?")
    .bind(deviceId)
    .first();
  if (!device) {
    return json(origin, env, 400, {
      success: false,
      error: "Invalid device_id. Please select a device from the list.",
    });
  }

  const tokenHash = await sha256Hex(rawToken);
  const prevReport = await db
    .prepare(
      "SELECT status FROM compatibility_reports WHERE port_id = ? AND token_hash = ? AND device_id = ?"
    )
    .bind(portId, tokenHash, device.id)
    .first();

  const works = status === "playable_30" || status === "playable_60" ? 1 : 0;
  const displayName = String(device.model || device.name);
  const soc = String(device.soc || "");
  const deviceType = String(device.device_type || "phone");
  const nowIso = new Date().toISOString();

  const prevStatus = String(prevReport?.status || "");
  const dYes = (works ? 1 : 0) - (prevStatus === "playable_30" || prevStatus === "playable_60" ? 1 : 0);
  const dNo = (!works ? 1 : 0) - (prevStatus === "low_fps" || prevStatus === "crash" ? 1 : 0);
  const d60 = (status === "playable_60" ? 1 : 0) - (prevStatus === "playable_60" ? 1 : 0);
  const d30 = (status === "playable_30" ? 1 : 0) - (prevStatus === "playable_30" ? 1 : 0);
  const dLow = (status === "low_fps" ? 1 : 0) - (prevStatus === "low_fps" ? 1 : 0);
  const dCrash = (status === "crash" ? 1 : 0) - (prevStatus === "crash" ? 1 : 0);

  await db.batch([
    db
      .prepare(
        `INSERT INTO compatibility_reports (
           port_id, token_hash, device_id, device_name, device_soc, device_type, works, updated_at, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(port_id, token_hash, device_id) DO UPDATE SET
           device_name = excluded.device_name,
           device_soc = excluded.device_soc,
           device_type = excluded.device_type,
           works = excluded.works,
           updated_at = excluded.updated_at,
           status = excluded.status`
      )
      .bind(portId, tokenHash, device.id, displayName, soc, deviceType, works, nowIso, status),
    db
      .prepare(
        `INSERT INTO compat_port_stats (
           port_id, yes_count, no_count, p60, p30, low_fps, crash, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(port_id) DO UPDATE SET
           yes_count = MAX(0, compat_port_stats.yes_count + ?),
           no_count = MAX(0, compat_port_stats.no_count + ?),
           p60 = MAX(0, compat_port_stats.p60 + ?),
           p30 = MAX(0, compat_port_stats.p30 + ?),
           low_fps = MAX(0, compat_port_stats.low_fps + ?),
           crash = MAX(0, compat_port_stats.crash + ?),
           updated_at = excluded.updated_at`
      )
      .bind(portId, dYes, dNo, d60, d30, dLow, dCrash, nowIso, dYes, dNo, d60, d30, dLow, dCrash),
  ]);

  const summaryMap = await buildCompatibilityForPorts(db, [portId]);
  return json(origin, env, 200, {
    success: true,
    report: {
      portId,
      deviceId: device.id,
      deviceName: displayName,
      deviceSoc: soc,
      deviceType,
      status,
      works: Boolean(works),
      updatedAt: nowIso,
    },
    summary: summaryMap[portId] || null,
  });
}

async function handleReportLink(req, env, origin) {
  if (req.method !== "POST") {
    return json(origin, env, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "POST, OPTIONS",
    });
  }

  const db = env.DB;
  const secret = String(env.REPORTER_HASH_SECRET || "").trim();
  if (!secret) {
    return json(origin, env, 500, { success: false, error: "server_misconfigured" });
  }

  const b = await readJsonBody(req, 2048);
  const portId = String(b.port_id || "").trim().slice(0, 120);
  const reason = String(b.reason || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const note = String(b.note || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const clientId = String(b.client_id || b.token || "").trim();
  const rawUrl = String(b.url || "").trim().slice(0, 500);

  const validReason = LINK_REASONS.has(reason);
  const validCustomNote = !reason && note.length >= 3;
  if (!PORT_ID_RE.test(portId) || (!validReason && !validCustomNote) || !UUID_RE.test(clientId)) {
    return json(origin, env, 400, { success: false, error: "Invalid report details." });
  }

  let normalizedUrl = "";
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("bad_protocol");
      normalizedUrl = parsed.toString();
    } catch {
      return json(origin, env, 400, { success: false, error: "Invalid report URL." });
    }
  }

  const reporterHash = await hmacSha256Hex(secret, `${clientId}:${clientIp(req)}`);
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff10mMs = now.getTime() - 10 * 60 * 1000;

  const existing = await db
    .prepare("SELECT last_report_at FROM link_report_rate_limits WHERE reporter_hash = ?")
    .bind(reporterHash)
    .first();
  if (existing) {
    const lastMs = Date.parse(existing.last_report_at);
    if (Number.isFinite(lastMs) && lastMs > cutoff10mMs) {
      const retry = Math.max(1, Math.ceil((lastMs + 10 * 60 * 1000 - now.getTime()) / 1000));
      return json(
        origin,
        env,
        429,
        {
          success: false,
          error: `You can submit another report in ${Math.ceil(retry / 60)} minute(s).`,
          retry_after_seconds: retry,
        },
        "no-store",
        { "Retry-After": String(retry) }
      );
    }
  }

  const displayReason = reason || "Custom note";
  await db.batch([
    db
      .prepare(
        `INSERT INTO link_report_rate_limits (reporter_hash, last_report_at)
         VALUES (?, ?)
         ON CONFLICT(reporter_hash) DO UPDATE SET last_report_at = excluded.last_report_at`
      )
      .bind(reporterHash, nowIso),
    db
      .prepare(
        `INSERT INTO link_reports (
           port_id, reporter_hash, reason, note, url, created_at, updated_at, discord_notified_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(port_id, reporter_hash) DO UPDATE SET
           reason = excluded.reason,
           note = excluded.note,
           url = excluded.url,
           updated_at = excluded.updated_at,
           discord_notified_at = NULL`
      )
      .bind(portId, reporterHash, displayReason, note, normalizedUrl, nowIso, nowIso),
  ]);

  return json(origin, env, 200, {
    success: true,
    portId,
    reason: displayReason,
    note,
    queued_for_digest: true,
  });
}

async function handleCommunitySnapshot(req, env, origin) {
  if (req.method !== "GET") {
    return json(origin, env, 405, { error: "Method not allowed" });
  }
  if (!(await verifyGithubAdminPat(req, env))) {
    return json(origin, env, 401, { success: false, error: "admin_github_pat_invalid" });
  }

  const db = env.DB;
  const ratings = await getRatingsSummary(db, 1000);
  const [week, month, alltime] = await Promise.all([
    getPopularityPeriod(db, "week"),
    getPopularityPeriod(db, "month"),
    getPopularityPeriod(db, "alltime"),
  ]);

  const compatRes = await db
    .prepare(
      `SELECT port_id, yes_count, no_count, p60, p30, low_fps, crash
       FROM compat_port_stats
       WHERE yes_count > 0 OR no_count > 0`
    )
    .all();
  const compatibility = {};
  for (const r of compatRes.results || []) {
    compatibility[r.port_id] = {
      yes: Number(r.yes_count || 0),
      no: Number(r.no_count || 0),
      counts: {
        playable_60: Number(r.p60 || 0),
        playable_30: Number(r.p30 || 0),
        low_fps: Number(r.low_fps || 0),
        crash: Number(r.crash || 0),
      },
    };
  }

  return json(origin, env, 200, {
    version: 1,
    generatedAt: new Date().toISOString(),
    ratings,
    popularity: { week, month, alltime },
    compatibility,
  });
}

async function handleLinkReportsDigest(req, url, env, origin) {
  if (!(await verifyGithubAdminPat(req, env))) {
    return json(origin, env, 401, { success: false, error: "admin_github_pat_invalid" });
  }
  const db = env.DB;

  if (req.method === "GET") {
    const { results } = await db
      .prepare(
        `SELECT id, port_id, reason, note, url, created_at, updated_at
         FROM link_reports
         WHERE discord_notified_at IS NULL
         ORDER BY id ASC
         LIMIT 50`
      )
      .all();
    return json(origin, env, 200, { success: true, reports: results || [] });
  }

  if (req.method === "POST" && url.pathname.endsWith("/ack")) {
    const body = await readJsonBody(req, 4096);
    const ids = Array.isArray(body.ids)
      ? body.ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100)
      : [];
    if (!ids.length) return json(origin, env, 200, { success: true, acked: 0 });
    const nowIso = new Date().toISOString();
    const placeholders = ids.map(() => "?").join(", ");
    await db
      .prepare(`UPDATE link_reports SET discord_notified_at = ? WHERE id IN (${placeholders})`)
      .bind(nowIso, ...ids)
      .run();
    return json(origin, env, 200, { success: true, acked: ids.length });
  }

  return json(origin, env, 405, { error: "Method not allowed" });
}

async function handleAdminDashboard(req, env, origin) {
  if (req.method !== "GET") {
    return json(origin, env, 405, { error: "Method not allowed" });
  }
  if (!(await verifyGithubAdminPat(req, env))) {
    return json(origin, env, 401, { success: false, error: "admin_github_pat_invalid" });
  }

  const db = env.DB;
  const [reportsRes, compatRes, ratingsRes, popRes, totals] = await Promise.all([
    db
      .prepare(
        "SELECT id, port_id, reason, note, url, created_at, updated_at, discord_notified_at FROM link_reports ORDER BY updated_at DESC LIMIT 60"
      )
      .all(),
    db
      .prepare(
        "SELECT id, port_id, device_id, device_name, works, status, updated_at FROM compatibility_reports ORDER BY updated_at DESC LIMIT 60"
      )
      .all(),
    db
      .prepare("SELECT port_id, votes, sum_stars, updated_at FROM rating_port_stats ORDER BY votes DESC LIMIT 50")
      .all(),
    db
      .prepare(
        "SELECT game_key, all_time_visits, week_visits, month_visits, week_start, month_start, updated_at FROM game_popularity ORDER BY all_time_visits DESC LIMIT 80"
      )
      .all(),
    db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM link_reports) AS linkReports,
          (SELECT COALESCE(SUM(yes_count + no_count), 0) FROM compat_port_stats) AS compatibilityReports,
          (SELECT total_votes FROM rating_global_meta WHERE id = 1) AS ratingVotes,
          (SELECT COUNT(*) FROM game_popularity) AS gamesTracked,
          (SELECT COALESCE(SUM(all_time_visits), 0) FROM game_popularity) AS allTimeVisits`
      )
      .first(),
  ]);

  return json(origin, env, 200, {
    success: true,
    totals: totals || {},
    reports: reportsRes.results || [],
    compatibility: (compatRes.results || []).map((r) => ({ ...r, works: Boolean(r.works) })),
    ratings: ratingsRes.results || [],
    popularity: popRes.results || [],
  });
}

export default {
  async fetch(req, env) {
    const origin = String(req.headers.get("origin") || "").trim();

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: !origin || isAllowedOrigin(origin, env) ? 204 : 403,
        headers: buildSecurityHeaders(origin, env),
      });
    }

    if (origin && !isAllowedOrigin(origin, env)) {
      return json(origin, env, 403, { success: false, error: "Origin not allowed" });
    }

    try {
      const url = new URL(req.url);
      const pathname = url.pathname;

      if (pathname === "/health" || pathname === "/api/health" || pathname === "/") {
        const dbCheck = await env.DB.prepare("SELECT 1 AS ok").first();
        return json(origin, env, 200, {
          ok: Number(dbCheck?.ok) === 1,
          runtime: "cloudflare-d1-community",
          database: "D1",
        });
      }
      if (
        pathname === "/ratings" ||
        pathname.startsWith("/ratings/") ||
        pathname === "/api/ratings" ||
        pathname.startsWith("/api/ratings/")
      ) {
        return await handleRatings(req, url, env, origin);
      }
      if (pathname === "/popularity" || pathname === "/api/popularity") {
        return await handlePopularity(req, url, env, origin);
      }
      if (pathname === "/compatibility" || pathname === "/api/compatibility") {
        return await handleCompatibility(req, url, env, origin);
      }
      if (pathname === "/report-link" || pathname === "/api/report-link") {
        return await handleReportLink(req, env, origin);
      }
      if (pathname === "/community-snapshot" || pathname === "/api/community-snapshot") {
        return await handleCommunitySnapshot(req, env, origin);
      }
      if (
        pathname === "/link-reports-pending" ||
        pathname === "/link-reports-pending/ack" ||
        pathname === "/api/link-reports-pending" ||
        pathname === "/api/link-reports-pending/ack"
      ) {
        return await handleLinkReportsDigest(req, url, env, origin);
      }
      if (pathname === "/admin-dashboard" || pathname === "/api/admin-dashboard") {
        return await handleAdminDashboard(req, env, origin);
      }

      return json(origin, env, 404, { error: "not_found" });
    } catch (err) {
      const status = Number(err?.status) || 500;
      if (status === 400 || status === 401 || status === 413) {
        return json(origin, env, status, { error: err.message });
      }
      console.error("NAPL Cloudflare D1 community error:", err);
      return json(origin, env, 500, { error: "server_error" });
    }
  },
};
