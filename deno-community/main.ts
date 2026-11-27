import {
  bucketForKey,
  buildCompatSummaryFromList,
  getManyBatched,
  getPopularityBucketKeys,
  getRatingsKeys,
  rebuildAllSummaries,
  type CompatPortSummary,
  type CompatReportRecord,
  type CompatStatus,
  type DeviceRecord,
  type LinkReportRecord,
  type PopularityBucketEntry,
  type PopularityRecord,
  type PortStats,
  type RatingsMeta,
  type RatingSummaryPort,
  utcMonthStart,
  utcWeekStart,
} from "./kv-store.ts";

const GITHUB_DATA_REPO = Deno.env.get("GITHUB_DATA_REPO") || "Fe2rr/NAPL-Data";
const DISCORD_WEBHOOK_URL = (Deno.env.get("DISCORD_WEBHOOK_URL") || "").trim();
const PORT = Number(Deno.env.get("PORT") || "8787") || 8787;
const HOST = Deno.env.get("HOST") || "0.0.0.0";
const KV_PATH = (Deno.env.get("DENO_KV_PATH") || "").trim();

const DEFAULT_ORIGINS = [
  "https://fe2rr.github.io",
  "https://napl-catalog.pages.dev",
  "https://napl-admin.pages.dev",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || DEFAULT_ORIGINS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const TOKEN_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.([A-Za-z0-9_-]{40,50}))?$/i;
const PORT_ID_RE = /^[a-z0-9][a-z0-9|._-]{0,119}$/i;
const GAME_KEY_RE = /^[a-z0-9][a-z0-9-]{0,179}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPAT_STATUSES = new Set<CompatStatus>([
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

const ephemeralSecret = crypto.randomUUID() + crypto.randomUUID();
const REPORTER_HASH_SECRET =
  (Deno.env.get("REPORTER_HASH_SECRET") || "").trim() || ephemeralSecret;

if (!Deno.env.get("REPORTER_HASH_SECRET")) {
  console.warn(
    "NAPL Deno community API: REPORTER_HASH_SECRET not set; using an ephemeral process secret.",
  );
}

const kv = await Deno.openKv(KV_PATH || undefined);

// Load strict device catalog into isolate memory at startup (zero KV read cost)
const deviceMap = new Map<string, DeviceRecord>();
const deviceList: DeviceRecord[] = [];

async function loadDeviceCatalog(): Promise<void> {
  const candidates: string[] = [];
  const envPath = (Deno.env.get("DEVICES_JSON_PATH") || "").trim();
  if (envPath) candidates.push(envPath);
  candidates.push(
    new URL("../public/assets/data/devices.json", import.meta.url).pathname,
    new URL("./devices.json", import.meta.url).pathname,
  );

  for (const filePath of candidates) {
    try {
      const raw = await Deno.readTextFile(filePath);
      const parsed = JSON.parse(raw);
      const records: Array<Record<string, unknown>> = [];
      if (Array.isArray(parsed)) {
        records.push(...parsed);
      } else if (
        parsed?.format === "napl-device-catalog-shards-v1" &&
        Array.isArray(parsed.chunks)
      ) {
        const dir = filePath.slice(0, filePath.lastIndexOf("/"));
        for (const chunk of parsed.chunks) {
          const name = String(chunk?.file || "");
          if (!/^devices-part-\d{3}\.json$/.test(name)) continue;
          const partRaw = await Deno.readTextFile(`${dir}/device-catalog/${name}`);
          const part = JSON.parse(partRaw);
          if (Array.isArray(part)) records.push(...part);
        }
      }
      if (records.length > 0) {
        for (const d of records) {
          if (!d || typeof d.id !== "string" || typeof d.name !== "string") continue;
          const id = d.id.trim().slice(0, 200);
          const name = d.name.trim().slice(0, 240);
          if (!id || !name) continue;
          const entry: DeviceRecord = {
            id,
            name,
            manufacturer: String(d.manufacturer || ""),
            model: String(d.model || name),
            soc: String(d.soc || ""),
            deviceType: String(d.device_type || d.deviceType || "phone"),
          };
          deviceMap.set(id, entry);
          deviceList.push(entry);
        }
        console.log(`Loaded ${deviceList.length} devices from ${filePath}`);
        return;
      }
    } catch {
      // Try next candidate
    }
  }
  console.warn("NAPL Deno community API: devices.json could not be loaded.");
}

await loadDeviceCatalog();

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let hmacKeyPromise: Promise<CryptoKey> | null = null;
function getHmacKey(): Promise<CryptoKey> {
  if (!hmacKeyPromise) {
    hmacKeyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(REPORTER_HASH_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return hmacKeyPromise;
}

async function hmacSha256Hex(value: string): Promise<string> {
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isAllowedOrigin(origin: string): boolean {
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

function securityHeaders(origin: string, extra: Record<string, string> = {}): Headers {
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
  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function jsonResponse(
  origin: string,
  status: number,
  body: unknown,
  cacheControl = "no-store",
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = securityHeaders(origin, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

function clientIp(req: Request, info?: Deno.ServeHandlerInfo): string {
  const cfIp = (req.headers.get("cf-connecting-ip") || "").trim();
  if (cfIp) return cfIp;
  const realIp = (req.headers.get("x-real-ip") || "").trim();
  if (realIp) return realIp;
  const xff = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (xff) return xff;
  const addr = info?.remoteAddr as Deno.NetAddr | undefined;
  return addr?.hostname || "unknown";
}

function dailyIpHash(req: Request, info?: Deno.ServeHandlerInfo): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  return sha256Hex(`${clientIp(req, info)}:${day}`);
}

async function readJsonBody(
  req: Request,
  maxBytes = 4096,
): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw Object.assign(new Error("body_too_large"), { status: 413 });
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw Object.assign(new Error("body_too_large"), { status: 413 });
  }
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

async function hashVoterToken(value: unknown): Promise<string> {
  if (typeof value !== "string" || value.length > 200) {
    throw Object.assign(new Error("invalid_token"), { status: 401 });
  }
  const match = value.trim().match(TOKEN_RE);
  if (!match) {
    throw Object.assign(new Error("invalid_token"), { status: 401 });
  }
  return await sha256Hex(match[1].toLowerCase());
}

async function isValidVoterTokenHash(tokenHash: string): Promise<boolean> {
  const res = await kv.get(["rating_tokens", tokenHash]);
  if (res.value) return true;
  for await (const _ of kv.list({ prefix: ["rating_votes_by_token", tokenHash] }, { limit: 1 })) {
    return true;
  }
  return false;
}

// Short isolate RAM caches to slash Deno KV read units under heavy read traffic
let ratingsMemCache: { at: number; data: { ports: RatingSummaryPort[]; global_avg: number } } | null = null;
const popularityMemCache = new Map<string, { at: number; games: Array<{ slug: string; visits: number }> }>();
const patCache = new Map<string, { at: number; ok: boolean }>();

async function verifyGithubAdminPat(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  const pat = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!pat || pat.length > 256) return false;

  const key = await sha256Hex(pat);
  const cached = patCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.ok;

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_DATA_REPO}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NAPL-Deno-Community/1.0",
        Authorization: `Bearer ${pat}`,
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!ghRes.ok) {
      patCache.set(key, { at: Date.now(), ok: false });
      return false;
    }
    const repo = await ghRes.json().catch(() => ({}));
    const ok = Boolean(repo?.permissions?.push || repo?.permissions?.admin);
    if (patCache.size > 128) patCache.clear();
    patCache.set(key, { at: Date.now(), ok });
    return ok;
  } catch {
    return false;
  }
}

async function getRatingsSummary(): Promise<{ ports: RatingSummaryPort[]; global_avg: number }> {
  if (ratingsMemCache && Date.now() - ratingsMemCache.at < 15_000) {
    return ratingsMemCache.data;
  }

  const entries = await getManyBatched<unknown>(kv, getRatingsKeys());
  const meta = (entries[0]?.value as RatingsMeta | null) || {
    totalVotes: 0,
    totalSum: 0,
    global_avg: 0,
    updatedAt: "",
  };
  const globalAvg = meta.totalVotes > 0 ? meta.totalSum / meta.totalVotes : 0;

  const ports: RatingSummaryPort[] = [];
  for (let i = 1; i < entries.length; i++) {
    const bucket = (entries[i]?.value as Record<string, PortStats> | null) || {};
    for (const st of Object.values(bucket)) {
      if (!st || st.votes <= 0) continue;
      const avg = st.sum / st.votes;
      const score = (st.votes / (st.votes + 5)) * avg + (5 / (st.votes + 5)) * globalAvg;
      ports.push({
        port_id: st.port_id,
        votes: st.votes,
        avg: Number(avg.toFixed(2)),
        score: Number(score.toFixed(2)),
      });
    }
  }
  ports.sort((a, b) => a.port_id.localeCompare(b.port_id));

  const data = {
    ports,
    global_avg: Number(globalAvg.toFixed(2)),
  };
  ratingsMemCache = { at: Date.now(), data };
  return data;
}

async function updateRatingsAggregates(
  portId: string,
  voteDelta: number,
  starDelta: number,
): Promise<void> {
  const bucketIdx = bucketForKey(portId);
  const metaKey: Deno.KvKey = ["summary", "ratings_meta"];
  const bucketKey: Deno.KvKey = ["summary", "ratings_bucket", bucketIdx];
  const portStatKey: Deno.KvKey = ["rating_port_stats", portId];

  for (let attempt = 0; attempt < 12; attempt++) {
    const [metaRes, bucketRes, portStatRes] = await kv.getMany([
      metaKey,
      bucketKey,
      portStatKey,
    ]);

    const prevMeta = (metaRes.value as RatingsMeta | null) || {
      totalVotes: 0,
      totalSum: 0,
      global_avg: 0,
      updatedAt: "",
    };
    const nextTotalVotes = Math.max(0, prevMeta.totalVotes + voteDelta);
    const nextTotalSum = Math.max(0, prevMeta.totalSum + starDelta);
    const nextMeta: RatingsMeta = {
      totalVotes: nextTotalVotes,
      totalSum: nextTotalSum,
      global_avg:
        nextTotalVotes > 0 ? Number((nextTotalSum / nextTotalVotes).toFixed(4)) : 0,
      updatedAt: new Date().toISOString(),
    };

    const prevPort = (portStatRes.value as PortStats | null) || {
      port_id: portId,
      votes: 0,
      sum: 0,
    };
    const nextPort: PortStats = {
      port_id: portId,
      votes: Math.max(0, prevPort.votes + voteDelta),
      sum: Math.max(0, prevPort.sum + starDelta),
    };

    const nextBucket: Record<string, PortStats> = {
      ...((bucketRes.value as Record<string, PortStats> | null) || {}),
    };
    if (nextPort.votes > 0) {
      nextBucket[portId] = nextPort;
    } else {
      delete nextBucket[portId];
    }

    const atomic = kv
      .atomic()
      .check(metaRes)
      .check(bucketRes)
      .check(portStatRes)
      .set(metaKey, nextMeta)
      .set(bucketKey, nextBucket);

    if (nextPort.votes > 0) {
      atomic.set(portStatKey, nextPort);
    } else {
      atomic.delete(portStatKey);
    }

    const commit = await atomic.commit();
    if (commit.ok) {
      ratingsMemCache = null;
      return;
    }
  }
}

async function getMyVotesMap(tokenHash: string): Promise<Record<string, number>> {
  const votes: Record<string, number> = {};
  for await (const entry of kv.list<number>({
    prefix: ["rating_votes_by_token", tokenHash],
  })) {
    const portId = String(entry.key[2] || "");
    if (portId && Number.isInteger(entry.value)) {
      votes[portId] = Number(entry.value);
    }
  }
  return votes;
}

async function handleRatings(
  req: Request,
  url: URL,
  origin: string,
  info?: Deno.ServeHandlerInfo,
): Promise<Response> {
  const subPath = url.pathname.replace(/^\/(?:api\/)?ratings\/?/, "");
  if (req.method === "GET") {
    const action = String(url.searchParams.get("action") || subPath || "");
    if (action === "my-votes") {
      const tokenHash = await hashVoterToken(url.searchParams.get("token") || "");
      if (!(await isValidVoterTokenHash(tokenHash))) {
        return jsonResponse(origin, 401, { error: "invalid_token" });
      }
      return jsonResponse(origin, 200, { votes: await getMyVotesMap(tokenHash) });
    }
    return jsonResponse(
      origin,
      200,
      await getRatingsSummary(),
      "public, max-age=15, s-maxage=30",
    );
  }

  if (req.method !== "POST") {
    return jsonResponse(origin, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "GET, POST, OPTIONS",
    });
  }

  const body = await readJsonBody(req, 2048);
  const action = String(body.action || url.searchParams.get("action") || subPath || "");

  if (action === "token") {
    const ipHash = await dailyIpHash(req, info);
    const hourBucket = new Date().toISOString().slice(0, 13);
    const limitKey: Deno.KvKey = ["rating_token_issues", ipHash, hourBucket];

    for (let i = 0; i < 8; i++) {
      const existing = await kv.get<number>(limitKey);
      const count = Number(existing.value || 0);
      if (count >= 10) {
        return jsonResponse(origin, 429, { error: "rate_limited" });
      }
      const rawToken = crypto.randomUUID();
      const tokenHash = await hashVoterToken(rawToken);
      const commit = await kv
        .atomic()
        .check(existing)
        .set(limitKey, count + 1, { expireIn: 2 * 60 * 60 * 1000 })
        .set(["rating_tokens", tokenHash], {
          ipHash,
          createdAt: new Date().toISOString(),
        })
        .commit();
      if (commit.ok) {
        return jsonResponse(origin, 200, { token: rawToken });
      }
    }
    return jsonResponse(origin, 429, { error: "rate_limited" });
  }

  const tokenHash = await hashVoterToken(body.token);
  if (!(await isValidVoterTokenHash(tokenHash))) {
    return jsonResponse(origin, 401, { error: "invalid_token" });
  }

  if (action === "my-votes") {
    return jsonResponse(origin, 200, { votes: await getMyVotesMap(tokenHash) });
  }

  if (action === "vote" || action === "unvote") {
    const portId = typeof body.port_id === "string" ? body.port_id.trim() : "";
    if (!PORT_ID_RE.test(portId)) {
      return jsonResponse(origin, 400, { error: "invalid_port_id" });
    }

    const voteKey: Deno.KvKey = ["rating_votes", portId, tokenHash];
    const indexKey: Deno.KvKey = ["rating_votes_by_token", tokenHash, portId];

    if (action === "unvote") {
      for (let i = 0; i < 8; i++) {
        const prev = await kv.get<{ stars: number }>(voteKey);
        if (!prev.value) {
          return jsonResponse(origin, 200, { ok: true, port_id: portId });
        }
        const commit = await kv
          .atomic()
          .check(prev)
          .delete(voteKey)
          .delete(indexKey)
          .commit();
        if (commit.ok) {
          await updateRatingsAggregates(portId, -1, -Number(prev.value.stars || 0));
          return jsonResponse(origin, 200, { ok: true, port_id: portId });
        }
      }
      return jsonResponse(origin, 409, { error: "conflict" });
    }

    const stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return jsonResponse(origin, 400, { error: "invalid_stars" });
    }

    const hourBucket = new Date().toISOString().slice(0, 13);
    const rateKey: Deno.KvKey = ["rating_vote_hour", tokenHash, hourBucket];
    const nowIso = new Date().toISOString();

    for (let i = 0; i < 8; i++) {
      const [prevVote, rateRes] = await kv.getMany([voteKey, rateKey]);
      const oldStars = Number((prevVote.value as { stars?: number } | null)?.stars || 0);
      const isNewVote = !prevVote.value;
      const hourCount = Number((rateRes.value as number | null) || 0);
      if (isNewVote && hourCount >= 20) {
        return jsonResponse(origin, 429, { error: "rate_limited" });
      }

      const atomic = kv
        .atomic()
        .check(prevVote)
        .check(rateRes)
        .set(voteKey, {
          portId,
          tokenHash,
          stars,
          createdAt: (prevVote.value as { createdAt?: string } | null)?.createdAt || nowIso,
          updatedAt: nowIso,
        })
        .set(indexKey, stars);

      if (isNewVote) {
        atomic.set(rateKey, hourCount + 1, { expireIn: 2 * 60 * 60 * 1000 });
      }

      const commit = await atomic.commit();
      if (commit.ok) {
        const voteDelta = isNewVote ? 1 : 0;
        const starDelta = stars - oldStars;
        if (voteDelta !== 0 || starDelta !== 0) {
          await updateRatingsAggregates(portId, voteDelta, starDelta);
        }
        return jsonResponse(origin, 200, { ok: true, port_id: portId, stars });
      }
    }
    return jsonResponse(origin, 409, { error: "conflict" });
  }

  return jsonResponse(origin, 404, { error: "not_found" });
}

async function handlePopularity(
  req: Request,
  url: URL,
  origin: string,
  info?: Deno.ServeHandlerInfo,
): Promise<Response> {
  if (req.method === "GET") {
    const period = (url.searchParams.get("period") || "week").toLowerCase();
    if (!["week", "month", "alltime"].includes(period)) {
      return jsonResponse(origin, 400, { error: "invalid_period" });
    }

    const mem = popularityMemCache.get(period);
    if (mem && Date.now() - mem.at < 20_000) {
      return jsonResponse(
        origin,
        200,
        { success: true, period, games: mem.games },
        "public, max-age=20, s-maxage=30",
      );
    }

    const weekStart = utcWeekStart();
    const monthStart = utcMonthStart();
    const bucketEntries = await getManyBatched<Record<string, PopularityBucketEntry>>(
      kv,
      getPopularityBucketKeys(),
    );

    const games: Array<{ slug: string; visits: number }> = [];
    for (const entry of bucketEntries) {
      const bucket = (entry.value || {}) as Record<string, PopularityBucketEntry>;
      for (const [slug, val] of Object.entries(bucket)) {
        let visits = 0;
        if (period === "alltime") visits = Number(val.a || 0);
        else if (period === "month") visits = val.ms === monthStart ? Number(val.m || 0) : 0;
        else visits = val.ws === weekStart ? Number(val.w || 0) : 0;
        if (visits > 0) {
          games.push({ slug, visits });
        }
      }
    }

    games.sort((a, b) => b.visits - a.visits || a.slug.localeCompare(b.slug));
    popularityMemCache.set(period, { at: Date.now(), games });

    return jsonResponse(
      origin,
      200,
      { success: true, period, games },
      "public, max-age=20, s-maxage=30",
    );
  }

  if (req.method !== "POST") {
    return jsonResponse(origin, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "GET, POST, OPTIONS",
    });
  }

  const body = await readJsonBody(req, 1024);
  const gameKey = typeof body.game === "string" ? body.game.trim().toLowerCase() : "";
  if (!GAME_KEY_RE.test(gameKey)) {
    return jsonResponse(origin, 400, { error: "invalid_game" });
  }

  const ipHash = await dailyIpHash(req, info);
  const limitKey: Deno.KvKey = ["pop_limit", ipHash, gameKey];
  const popKey: Deno.KvKey = ["popularity", gameKey];
  const bucketKey: Deno.KvKey = ["summary", "popularity_bucket", bucketForKey(gameKey)];

  const now = new Date();
  const nowIso = now.toISOString();
  const weekStart = utcWeekStart(now);
  const monthStart = utcMonthStart(now);

  for (let i = 0; i < 8; i++) {
    const [limitRes, popRes, bucketRes] = await kv.getMany([limitKey, popKey, bucketKey]);
    if (limitRes.value) {
      return jsonResponse(origin, 200, { success: true, counted: false });
    }

    const prev = (popRes.value as PopularityRecord | null) || null;
    const nextPop: PopularityRecord = {
      gameKey,
      allTimeVisits: (prev?.allTimeVisits || 0) + 1,
      weekVisits: prev && prev.weekStart === weekStart ? prev.weekVisits + 1 : 1,
      monthVisits: prev && prev.monthStart === monthStart ? prev.monthVisits + 1 : 1,
      weekStart,
      monthStart,
      updatedAt: nowIso,
    };

    const nextBucket: Record<string, PopularityBucketEntry> = {
      ...((bucketRes.value as Record<string, PopularityBucketEntry> | null) || {}),
      [gameKey]: {
        a: nextPop.allTimeVisits,
        w: nextPop.weekVisits,
        m: nextPop.monthVisits,
        ws: weekStart,
        ms: monthStart,
        u: nowIso,
      },
    };

    const commit = await kv
      .atomic()
      .check(limitRes)
      .check(popRes)
      .check(bucketRes)
      .set(limitKey, 1, { expireIn: 20_000 })
      .set(popKey, nextPop)
      .set(bucketKey, nextBucket)
      .commit();

    if (commit.ok) {
      popularityMemCache.clear();
      return jsonResponse(origin, 200, { success: true, counted: true });
    }
  }

  return jsonResponse(origin, 200, { success: true, counted: false });
}

async function handleCompatibility(
  req: Request,
  url: URL,
  origin: string,
): Promise<Response> {
  if (req.method === "GET") {
    const action = String(url.searchParams.get("action") || "");
    if (action === "devices") {
      return jsonResponse(
        origin,
        200,
        { success: true, devices: deviceList },
        "public, max-age=3600",
      );
    }

    if (action === "search") {
      const deviceId = (url.searchParams.get("device_id") || "").slice(0, 200);
      const soc = (url.searchParams.get("soc") || "").slice(0, 120);
      const q = (url.searchParams.get("q") || "").slice(0, 120).toLowerCase();
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 500, 1), 1000);

      if (!deviceId && !soc && !q) {
        return jsonResponse(origin, 200, { success: true, reports: [] });
      }

      const matched: Array<{
        portId: string;
        deviceId: string;
        deviceName: string;
        deviceSoc: string;
        deviceType: string;
        status: CompatStatus;
        works: boolean;
        updatedAt: string;
      }> = [];

      if (deviceId) {
        for await (const entry of kv.list<CompatReportRecord>({
          prefix: ["compat_by_device", deviceId],
        })) {
          const r = entry.value;
          if (!r) continue;
          const dev = deviceMap.get(r.deviceId);
          matched.push({
            portId: r.portId,
            deviceId: r.deviceId,
            deviceName: dev?.model || r.deviceName,
            deviceSoc: dev?.soc || r.deviceSoc || "",
            deviceType: dev?.deviceType || r.deviceType || "phone",
            status: r.status,
            works: r.works,
            updatedAt: r.updatedAt,
          });
        }
      } else if (soc) {
        for await (const entry of kv.list<CompatReportRecord>({
          prefix: ["compat_by_soc", soc.toLowerCase()],
        })) {
          const r = entry.value;
          if (!r) continue;
          const dev = deviceMap.get(r.deviceId);
          matched.push({
            portId: r.portId,
            deviceId: r.deviceId,
            deviceName: dev?.model || r.deviceName,
            deviceSoc: dev?.soc || r.deviceSoc || "",
            deviceType: dev?.deviceType || r.deviceType || "phone",
            status: r.status,
            works: r.works,
            updatedAt: r.updatedAt,
          });
        }
      } else {
        for await (const entry of kv.list<CompatReportRecord>({
          prefix: ["compat_reports"],
        })) {
          const r = entry.value;
          if (!r) continue;
          const dev = deviceMap.get(r.deviceId);
          const model = (dev?.model || r.deviceName || "").toLowerCase();
          const devSoc = (dev?.soc || r.deviceSoc || "").toLowerCase();
          if (model.includes(q) || devSoc.includes(q) || r.deviceName.toLowerCase().includes(q)) {
            matched.push({
              portId: r.portId,
              deviceId: r.deviceId,
              deviceName: dev?.model || r.deviceName,
              deviceSoc: dev?.soc || r.deviceSoc || "",
              deviceType: dev?.deviceType || r.deviceType || "phone",
              status: r.status,
              works: r.works,
              updatedAt: r.updatedAt,
            });
          }
        }
      }

      matched.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return jsonResponse(
        origin,
        200,
        { success: true, reports: matched.slice(0, limit) },
        "public, max-age=20, s-maxage=40",
      );
    }

    const ids = [
      ...new Set(
        (url.searchParams.get("port_ids") || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ].slice(0, 50);

    if (ids.some((x) => x.length > 120)) {
      return jsonResponse(origin, 400, { success: false, error: "Invalid port ID." });
    }

    const compatibility: Record<string, CompatPortSummary> = {};
    if (ids.length > 0) {
      const keys: Deno.KvKey[] = ids.map((id) => ["compat_summary", id]);
      const summaries = await getManyBatched<CompatPortSummary>(kv, keys);
      for (let i = 0; i < ids.length; i++) {
        compatibility[ids[i]] = summaries[i]?.value || {
          yes: 0,
          no: 0,
          counts: { playable_60: 0, playable_30: 0, low_fps: 0, crash: 0 },
          reports: [],
        };
      }
    }

    return jsonResponse(
      origin,
      200,
      { success: true, compatibility },
      "public, max-age=30, s-maxage=60",
    );
  }

  if (req.method !== "POST") {
    return jsonResponse(origin, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "GET, POST, OPTIONS",
    });
  }

  const b = await readJsonBody(req, 4096);
  const portId = String(b.port_id || "").trim();
  const deviceId = String(b.device_id || "").trim();
  const rawToken = String(b.token || "").trim();
  const rawStatus = String(b.status || "").trim() as CompatStatus;
  const worksInput =
    typeof b.works === "boolean"
      ? b.works
      : b.works === 1
      ? true
      : b.works === 0
      ? false
      : null;

  const status: CompatStatus | "" = COMPAT_STATUSES.has(rawStatus)
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
    return jsonResponse(origin, 400, {
      success: false,
      error: "port_id, device_id, token, and a valid status are required.",
    });
  }

  const device = deviceMap.get(deviceId);
  if (!device) {
    return jsonResponse(origin, 400, {
      success: false,
      error: "Invalid device_id. Please select a device from the list.",
    });
  }

  const works = status === "playable_30" || status === "playable_60";
  const tokenHash = await sha256Hex(rawToken);
  const nowIso = new Date().toISOString();
  const reportKey: Deno.KvKey = ["compat_reports", portId, tokenHash, device.id];

  const record: CompatReportRecord = {
    portId,
    tokenHash,
    deviceId: device.id,
    deviceName: device.name,
    deviceSoc: device.soc,
    deviceType: device.deviceType,
    status,
    works,
    updatedAt: nowIso,
  };

  await kv.set(reportKey, record);
  await kv.set(["compat_by_device", device.id, portId, tokenHash], record);
  if (device.soc) {
    await kv.set(
      ["compat_by_soc", device.soc.toLowerCase(), portId, tokenHash, device.id],
      record,
    );
  }

  const portReports: CompatReportRecord[] = [];
  for await (const entry of kv.list<CompatReportRecord>({
    prefix: ["compat_reports", portId],
  })) {
    if (entry.value) portReports.push(entry.value);
  }
  const summary = buildCompatSummaryFromList(portReports, deviceMap);
  await kv.set(["compat_summary", portId], summary);

  return jsonResponse(origin, 200, {
    success: true,
    report: {
      portId,
      deviceId: device.id,
      deviceName: device.model || device.name,
      deviceSoc: device.soc || "",
      deviceType: device.deviceType || "phone",
      status,
      works,
      updatedAt: nowIso,
    },
    summary,
  });
}

async function handleReportLink(
  req: Request,
  origin: string,
  info?: Deno.ServeHandlerInfo,
): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse(origin, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "POST, OPTIONS",
    });
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
    return jsonResponse(origin, 400, { success: false, error: "Invalid report details." });
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
      return jsonResponse(origin, 400, { success: false, error: "Invalid report URL." });
    }
  }

  const reporterHash = await hmacSha256Hex(`${clientId}:${clientIp(req, info)}`);
  const limitKey: Deno.KvKey = ["link_report_limit", reporterHash];
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cooldownMs = 10 * 60 * 1000;

  for (let i = 0; i < 6; i++) {
    const existingLimit = await kv.get<{ expiresAt: number }>(limitKey);
    if (existingLimit.value && existingLimit.value.expiresAt > nowMs) {
      const retry = Math.max(
        1,
        Math.ceil((existingLimit.value.expiresAt - nowMs) / 1000),
      );
      return jsonResponse(
        origin,
        429,
        {
          success: false,
          error: `You can submit another report in ${Math.ceil(retry / 60)} minute(s).`,
          retry_after_seconds: retry,
        },
        "no-store",
        { "Retry-After": String(retry) },
      );
    }

    const commit = await kv
      .atomic()
      .check(existingLimit)
      .set(limitKey, { expiresAt: nowMs + cooldownMs }, { expireIn: cooldownMs })
      .commit();
    if (commit.ok) break;
  }

  const displayReason = reason || "Custom note";
  const reportKey: Deno.KvKey = ["link_reports", portId, reporterHash];
  const prevReport = await kv.get<LinkReportRecord>(reportKey);
  const record: LinkReportRecord = {
    portId,
    reporterHash,
    reason: displayReason,
    note,
    url: normalizedUrl,
    createdAt: prevReport.value?.createdAt || nowIso,
    updatedAt: nowIso,
  };
  await kv.set(reportKey, record);

  const recentKey: Deno.KvKey = ["summary", "recent_link_reports"];
  for (let i = 0; i < 6; i++) {
    const cur = await kv.get<LinkReportRecord[]>(recentKey);
    const list = [
      record,
      ...((cur.value || []).filter(
        (x) => !(x.portId === portId && x.reporterHash === reporterHash),
      )),
    ].slice(0, 100);
    const commit = await kv.atomic().check(cur).set(recentKey, list).commit();
    if (commit.ok) break;
  }

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
      console.warn("Discord webhook notification failed:", err);
    }
  }

  return jsonResponse(origin, 200, {
    success: true,
    portId,
    reason: displayReason,
    note,
    notification_sent: notified,
  });
}

async function handleAdminDashboard(req: Request, origin: string): Promise<Response> {
  if (req.method !== "GET") {
    return jsonResponse(origin, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "GET, OPTIONS",
    });
  }
  if (!(await verifyGithubAdminPat(req))) {
    return jsonResponse(origin, 401, {
      success: false,
      error: "admin_github_pat_invalid",
    });
  }

  const recentReportsRes = await kv.get<LinkReportRecord[]>([
    "summary",
    "recent_link_reports",
  ]);
  const reports = (recentReportsRes.value || []).map((r, i) => ({
    id: i + 1,
    port_id: r.portId,
    reason: r.reason,
    note: r.note,
    url: r.url,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));

  const ratingsSummary = await getRatingsSummary();
  const bucketEntries = await getManyBatched<Record<string, PopularityBucketEntry>>(
    kv,
    getPopularityBucketKeys(),
  );
  const weekStart = utcWeekStart();
  const monthStart = utcMonthStart();
  const popularity: Array<Record<string, unknown>> = [];
  let allTimeVisits = 0;
  let weekVisits = 0;
  let monthVisits = 0;

  for (const entry of bucketEntries) {
    const bucket = (entry.value || {}) as Record<string, PopularityBucketEntry>;
    for (const [game_key, v] of Object.entries(bucket)) {
      const a = Number(v.a || 0);
      const w = v.ws === weekStart ? Number(v.w || 0) : 0;
      const m = v.ms === monthStart ? Number(v.m || 0) : 0;
      allTimeVisits += a;
      weekVisits += w;
      monthVisits += m;
      popularity.push({
        game_key,
        all_time_visits: a,
        week_visits: w,
        month_visits: m,
        week_start: v.ws,
        month_start: v.ms,
        updated_at: v.u,
      });
    }
  }
  popularity.sort(
    (a, b) => Number(b.all_time_visits) - Number(a.all_time_visits),
  );

  const compatibility: Array<Record<string, unknown>> = [];
  for await (const entry of kv.list<CompatReportRecord>(
    { prefix: ["compat_reports"] },
    { limit: 100 },
  )) {
    const r = entry.value;
    if (!r) continue;
    compatibility.push({
      port_id: r.portId,
      device_id: r.deviceId,
      device_name: r.deviceName,
      works: Boolean(r.works),
      status: r.status,
      updated_at: r.updatedAt,
    });
  }

  return jsonResponse(origin, 200, {
    success: true,
    totals: {
      linkReports: reports.length,
      compatibilityReports: compatibility.length,
      ratingVotes: ratingsSummary.ports.reduce((s, p) => s + p.votes, 0),
      gamesTracked: popularity.length,
      allTimeVisits,
      weekVisits,
      monthVisits,
    },
    reports,
    compatibility,
    ratings: ratingsSummary.ports,
    popularity: popularity.slice(0, 1000),
  });
}

async function handleAdminImport(req: Request, origin: string): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse(origin, 405, { error: "Method not allowed" }, "no-store", {
      Allow: "POST, OPTIONS",
    });
  }
  if (!(await verifyGithubAdminPat(req))) {
    return jsonResponse(origin, 401, {
      success: false,
      error: "admin_github_pat_invalid",
    });
  }

  const body = await readJsonBody(req, 15 * 1024 * 1024);
  const tables = (body.tables || body) as Record<string, Array<Record<string, unknown>>>;
  if (!tables || typeof tables !== "object") {
    return jsonResponse(origin, 400, { success: false, error: "Invalid export JSON." });
  }

  let counts = {
    tokens: 0,
    votes: 0,
    popularity: 0,
    compatibility: 0,
    linkReports: 0,
  };

  for (const r of tables.rating_tokens || []) {
    const tokenHash = String(r.token_hash || "");
    if (!tokenHash) continue;
    await kv.set(["rating_tokens", tokenHash], {
      ipHash: String(r.ip_hash || ""),
      createdAt: String(r.created_at || new Date().toISOString()),
    });
    counts.tokens += 1;
  }

  for (const r of tables.rating_votes || []) {
    const portId = String(r.port_id || "");
    const tokenHash = String(r.token_hash || "");
    const stars = Number(r.stars || 0);
    if (!portId || !tokenHash || stars < 1 || stars > 5) continue;
    await kv.set(["rating_votes", portId, tokenHash], {
      portId,
      tokenHash,
      stars,
      createdAt: String(r.created_at || new Date().toISOString()),
      updatedAt: String(r.updated_at || r.created_at || new Date().toISOString()),
    });
    await kv.set(["rating_votes_by_token", tokenHash, portId], stars);
    counts.votes += 1;
  }

  for (const r of tables.game_popularity || []) {
    const gameKey = String(r.game_key || "").trim().toLowerCase();
    if (!gameKey) continue;
    await kv.set(["popularity", gameKey], {
      gameKey,
      allTimeVisits: Number(r.all_time_visits || 0),
      weekVisits: Number(r.week_visits || 0),
      monthVisits: Number(r.month_visits || 0),
      weekStart: String(r.week_start || utcWeekStart()),
      monthStart: String(r.month_start || utcMonthStart()),
      updatedAt: String(r.updated_at || new Date().toISOString()),
    } satisfies PopularityRecord);
    counts.popularity += 1;
  }

  for (const r of tables.compatibility_reports || []) {
    const portId = String(r.port_id || "");
    const tokenHash = String(r.token_hash || "");
    const deviceId = String(r.device_id || "");
    if (!portId || !tokenHash || !deviceId) continue;
    const statusRaw = String(r.status || "");
    const status: CompatStatus = COMPAT_STATUSES.has(statusRaw as CompatStatus)
      ? (statusRaw as CompatStatus)
      : r.works
      ? "playable_30"
      : "crash";
    const works = status === "playable_30" || status === "playable_60";
    const dev = deviceMap.get(deviceId);
    const rec: CompatReportRecord = {
      portId,
      tokenHash,
      deviceId,
      deviceName: dev?.name || String(r.device_name || deviceId),
      deviceSoc: dev?.soc || "",
      deviceType: dev?.deviceType || "phone",
      status,
      works,
      updatedAt: String(r.updated_at || new Date().toISOString()),
    };
    await kv.set(["compat_reports", portId, tokenHash, deviceId], rec);
    await kv.set(["compat_by_device", deviceId, portId, tokenHash], rec);
    if (dev?.soc) {
      await kv.set(["compat_by_soc", dev.soc.toLowerCase(), portId, tokenHash, deviceId], rec);
    }
    counts.compatibility += 1;
  }

  for (const r of tables.link_reports || []) {
    const portId = String(r.port_id || "");
    const reporterHash = String(r.reporter_hash || "");
    if (!portId || !reporterHash) continue;
    await kv.set(["link_reports", portId, reporterHash], {
      portId,
      reporterHash,
      reason: String(r.reason || "Custom note"),
      note: String(r.note || ""),
      url: String(r.url || ""),
      createdAt: String(r.created_at || new Date().toISOString()),
      updatedAt: String(r.updated_at || r.created_at || new Date().toISOString()),
    } satisfies LinkReportRecord);
    counts.linkReports += 1;
  }

  await rebuildAllSummaries(kv);
  ratingsMemCache = null;
  popularityMemCache.clear();

  return jsonResponse(origin, 200, { success: true, imported: counts });
}

export async function handleRequest(
  req: Request,
  info?: Deno.ServeHandlerInfo,
): Promise<Response> {
  const origin = (req.headers.get("origin") || "").trim();

  if (req.method === "OPTIONS") {
    const status = !origin || isAllowedOrigin(origin) ? 204 : 403;
    return new Response(null, { status, headers: securityHeaders(origin) });
  }

  if (origin && !isAllowedOrigin(origin)) {
    return jsonResponse(origin, 403, { success: false, error: "Origin not allowed" });
  }

  try {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/health" || pathname === "/api/health" || pathname === "/") {
      const ratings = await getRatingsSummary();
      return jsonResponse(origin, 200, {
        ok: true,
        runtime: "deno-deploy",
        storage: "deno-kv",
        devicesLoaded: deviceList.length,
        ratedPorts: ratings.ports.length,
      });
    }

    if (
      pathname === "/ratings" ||
      pathname.startsWith("/ratings/") ||
      pathname === "/api/ratings" ||
      pathname.startsWith("/api/ratings/")
    ) {
      return await handleRatings(req, url, origin, info);
    }

    if (pathname === "/popularity" || pathname === "/api/popularity") {
      return await handlePopularity(req, url, origin, info);
    }

    if (pathname === "/compatibility" || pathname === "/api/compatibility") {
      return await handleCompatibility(req, url, origin);
    }

    if (pathname === "/report-link" || pathname === "/api/report-link") {
      return await handleReportLink(req, origin, info);
    }

    if (pathname === "/admin-dashboard" || pathname === "/api/admin-dashboard") {
      return await handleAdminDashboard(req, origin);
    }

    if (pathname === "/admin-import" || pathname === "/api/admin-import") {
      return await handleAdminImport(req, origin);
    }

    return jsonResponse(origin, 404, { error: "not_found" });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    const status = Number(e?.status) || 500;
    if (status === 400 || status === 401 || status === 413) {
      return jsonResponse(origin, status, { error: e.message || "bad_request" });
    }
    console.error("NAPL Deno community API error:", err);
    return jsonResponse(origin, 500, { error: "server_error" });
  }
}

if (import.meta.main) {
  Deno.serve({ port: PORT, hostname: HOST }, (req, info) => handleRequest(req, info));
}
