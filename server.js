import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const LOCAL_CATALOG_CACHE = path.join(__dirname, ".local", "catalog-seed.json");
const UPSTREAM_SITE_ORIGIN = "https://fe2rr.github.io";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const COMPRESSIBLE_RE = /^(?:text\/|application\/(?:json|javascript|manifest\+json)|image\/svg\+xml)/i;

const remoteJsonCache = new Map(); // path -> { body: Buffer, fetchedAt: number }
const REMOTE_JSON_TTL_MS = 5 * 60 * 1000;
const steamCoverUrlCache = new Map();
const STEAM_COVER_TTL_MS = 24 * 60 * 60 * 1000;

function sendBuffer(req, res, statusCode, buffer, contentType, cacheControl = "no-store") {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  };

  const acceptEncoding = String(req.headers["accept-encoding"] || "");
  if (
    req.method !== "HEAD" &&
    buffer.length >= 512 &&
    COMPRESSIBLE_RE.test(contentType)
  ) {
    if (/\bbr\b/i.test(acceptEncoding)) {
      const compressed = zlib.brotliCompressSync(buffer, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
      });
      res.writeHead(statusCode, {
        ...headers,
        "Content-Encoding": "br",
        Vary: "Accept-Encoding",
        "Content-Length": compressed.length,
      });
      return res.end(compressed);
    }
    if (/\bgzip\b/i.test(acceptEncoding)) {
      const compressed = zlib.gzipSync(buffer, { level: 6 });
      res.writeHead(statusCode, {
        ...headers,
        "Content-Encoding": "gzip",
        Vary: "Accept-Encoding",
        "Content-Length": compressed.length,
      });
      return res.end(compressed);
    }
  }

  res.writeHead(statusCode, { ...headers, "Content-Length": buffer.length });
  return req.method === "HEAD" ? res.end() : res.end(buffer);
}

async function fetchUpstreamBuffer(upstreamPath, validateJson = false) {
  const target = `${UPSTREAM_SITE_ORIGIN}${upstreamPath}`;
  const response = await fetch(target, {
    method: "GET",
    headers: { Accept: validateJson ? "application/json" : "*/*" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Upstream ${upstreamPath} returned HTTP ${response.status}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (validateJson) {
    JSON.parse(buf.toString("utf8"));
  }
  return {
    buf,
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

async function serveCatalogJson(req, res) {
  const localPublicPath = path.join(PUBLIC_DIR, "assets", "data", "catalog.json");
  if (fs.existsSync(localPublicPath)) {
    const buf = fs.readFileSync(localPublicPath);
    return sendBuffer(req, res, 200, buf, MIME_TYPES[".json"], "public, max-age=60");
  }

  const cached = remoteJsonCache.get("/assets/data/catalog.json");
  if (cached && Date.now() - cached.fetchedAt < REMOTE_JSON_TTL_MS) {
    return sendBuffer(req, res, 200, cached.body, MIME_TYPES[".json"], "public, max-age=60");
  }

  try {
    const { buf } = await fetchUpstreamBuffer("/assets/data/catalog.json", true);
    remoteJsonCache.set("/assets/data/catalog.json", { body: buf, fetchedAt: Date.now() });
    try {
      fs.mkdirSync(path.dirname(LOCAL_CATALOG_CACHE), { recursive: true });
      fs.writeFileSync(LOCAL_CATALOG_CACHE, buf);
    } catch {
      // Ignore cache disk write errors
    }
    return sendBuffer(req, res, 200, buf, MIME_TYPES[".json"], "public, max-age=60");
  } catch (err) {
    if (cached) {
      return sendBuffer(req, res, 200, cached.body, MIME_TYPES[".json"], "public, max-age=10");
    }
    if (fs.existsSync(LOCAL_CATALOG_CACHE)) {
      const buf = fs.readFileSync(LOCAL_CATALOG_CACHE);
      return sendBuffer(req, res, 200, buf, MIME_TYPES[".json"], "public, max-age=10");
    }
    const errBuf = Buffer.from(JSON.stringify({ error: err?.message || "Catalog unavailable" }));
    return sendBuffer(req, res, 502, errBuf, MIME_TYPES[".json"]);
  }
}

async function serveCommunitySummaryJson(req, res) {
  const localPath = path.join(PUBLIC_DIR, "assets", "data", "community-summary.json");
  if (fs.existsSync(localPath)) {
    const buf = fs.readFileSync(localPath);
    return sendBuffer(req, res, 200, buf, MIME_TYPES[".json"], "public, max-age=60");
  }

  const cached = remoteJsonCache.get("/assets/data/community-summary.json");
  if (cached && Date.now() - cached.fetchedAt < REMOTE_JSON_TTL_MS) {
    return sendBuffer(req, res, 200, cached.body, MIME_TYPES[".json"], "public, max-age=60");
  }

  try {
    const { buf } = await fetchUpstreamBuffer("/assets/data/community-summary.json", true);
    remoteJsonCache.set("/assets/data/community-summary.json", { body: buf, fetchedAt: Date.now() });
    return sendBuffer(req, res, 200, buf, MIME_TYPES[".json"], "public, max-age=60");
  } catch {
    if (cached) {
      return sendBuffer(req, res, 200, cached.body, MIME_TYPES[".json"], "public, max-age=10");
    }
    const empty = Buffer.from(
      JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        ratings: { ports: [], global_avg: 0 },
        popularity: { week: [], month: [], alltime: [] },
        compatibility: {},
      })
    );
    return sendBuffer(req, res, 200, empty, MIME_TYPES[".json"], "no-store");
  }
}

async function serveCoverAsset(req, res, pathname) {
  const rel = pathname.replace(/^\/+/, "");
  const safePath = path.resolve(PUBLIC_DIR, rel);
  if (safePath.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    const ext = path.extname(safePath).toLowerCase();
    return sendBuffer(req, res, 200, fs.readFileSync(safePath), MIME_TYPES[ext] || "application/octet-stream", "public, max-age=3600");
  }

  const isManifest = pathname === "/assets/covers/manifest.json";
  if (isManifest) {
    const cached = remoteJsonCache.get(pathname);
    if (cached && Date.now() - cached.fetchedAt < REMOTE_JSON_TTL_MS) {
      return sendBuffer(req, res, 200, cached.body, MIME_TYPES[".json"], "public, max-age=300");
    }
  }

  try {
    const { buf, contentType } = await fetchUpstreamBuffer(pathname, isManifest);
    if (isManifest) {
      remoteJsonCache.set(pathname, { body: buf, fetchedAt: Date.now() });
    }
    return sendBuffer(req, res, 200, buf, contentType, "public, max-age=3600");
  } catch {
    if (isManifest) {
      const empty = Buffer.from(JSON.stringify({ version: 1, covers: {} }));
      return sendBuffer(req, res, 200, empty, MIME_TYPES[".json"], "no-store");
    }
    res.writeHead(404);
    return res.end();
  }
}

async function serveSteamCoverProxy(req, res, appid) {
  if (!/^\d{1,10}$/.test(appid)) {
    res.writeHead(400);
    return res.end("Invalid Steam App ID.");
  }

  const now = Date.now();
  const cached = steamCoverUrlCache.get(appid);
  const candidates =
    cached && now - cached.time < STEAM_COVER_TTL_MS
      ? [cached.url]
      : [
          `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
          `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
          `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_capsule.jpg`,
          `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
        ];

  for (const url of candidates) {
    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      const contentType = upstream.headers.get("content-type") || "";
      if (!upstream.ok || !contentType.toLowerCase().startsWith("image/")) {
        continue;
      }
      steamCoverUrlCache.set(appid, { url, time: now });
      const buf = Buffer.from(await upstream.arrayBuffer());
      return sendBuffer(req, res, 200, buf, contentType, "public, max-age=86400");
    } catch {
      // Try next candidate
    }
  }

  res.writeHead(404);
  return res.end();
}

function resolveLegacyRedirect(rawPath, search) {
  const isPublicPrefixed = rawPath === "/public" || rawPath.startsWith("/public/");
  const cleanPath = isPublicPrefixed ? rawPath.replace(/^\/public/, "") || "/" : rawPath;

  if (cleanPath === "/compatibility" || cleanPath === "/compatibility.html") {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    if (!params.has("page")) params.set("page", "compatibility");
    const qs = params.toString();
    return qs ? `/?${qs}` : "/?page=compatibility";
  }

  if (
    cleanPath === "/index.html" ||
    cleanPath === "/game" ||
    cleanPath === "/game.html" ||
    cleanPath === "/all-games" ||
    cleanPath === "/all-games.html"
  ) {
    return "/" + search;
  }

  return isPublicPrefixed ? cleanPath + search : null;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end("Method Not Allowed");
    }

    const reqUrl = new URL(req.url || "/", "http://localhost");
    const pathname = decodeURIComponent(reqUrl.pathname);
    const search = reqUrl.search || "";

    if (pathname === "/api/health") {
      const body = Buffer.from(JSON.stringify({ ok: true, mode: "preview-proxy" }));
      return sendBuffer(req, res, 200, body, MIME_TYPES[".json"]);
    }

    if (pathname === "/api/public-catalog" || pathname === "/assets/data/catalog.json") {
      return await serveCatalogJson(req, res);
    }

    if (pathname === "/assets/data/community-summary.json") {
      return await serveCommunitySummaryJson(req, res);
    }

    if (pathname.startsWith("/assets/covers/")) {
      return await serveCoverAsset(req, res, pathname);
    }

    if (pathname.startsWith("/api/steam-cover/")) {
      const appid = pathname.slice("/api/steam-cover/".length).trim();
      return await serveSteamCoverProxy(req, res, appid);
    }

    const redirectTarget = resolveLegacyRedirect(pathname, search);
    if (redirectTarget) {
      res.writeHead(301, { Location: redirectTarget });
      return res.end();
    }

    let relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    let filePath = path.resolve(PUBLIC_DIR, relPath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      return res.end("Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const cacheControl =
      ext === ".json"
        ? "public, max-age=3600, must-revalidate"
        : /\.(html|css|js|mjs)$/i.test(ext)
        ? "no-store, no-cache, must-revalidate"
        : "public, max-age=3600";

    return sendBuffer(req, res, 200, fs.readFileSync(filePath), contentType, cacheControl);
  } catch (err) {
    console.error("Preview server error:", err);
    res.writeHead(500);
    return res.end("Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NAPL preview server running at http://${HOST}:${PORT}`);
});
