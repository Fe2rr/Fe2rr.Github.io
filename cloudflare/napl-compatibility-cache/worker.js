const UPSTREAM_BASE = "https://gsksanvcdbdoevairzpj.supabase.co/functions/v1";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};
const POST_ROUTES = new Set([
  "/compatibility",
  "/popularity",
  "/ratings/token",
  "/ratings/my-votes",
  "/ratings/vote",
  "/ratings/unvote",
  "/report-link",
]);
const inflight = new Map();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors, ...extra },
  });
}

function normalizeGet(url) {
  const action = (url.searchParams.get("action") || "").trim();
  const params = new URLSearchParams();
  if (action === "devices") return { retired: true };
  if (action === "search") {
    const deviceId = (url.searchParams.get("device_id") || "").trim().slice(0, 200);
    const soc = (url.searchParams.get("soc") || "").trim().slice(0, 120);
    const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const rawLimit = Number(url.searchParams.get("limit") || 200);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 200;
    if (!deviceId && !soc && !query) return { error: "A device, SoC or query is required." };
    params.set("action", "search");
    if (deviceId) params.set("device_id", deviceId);
    if (soc) params.set("soc", soc);
    if (query) params.set("q", query);
    params.set("limit", String(limit));
    return { params, ttl: 120 };
  }
  if (action) return { error: "Unsupported compatibility action." };

  const ids = Array.from(new Set((url.searchParams.get("port_ids") || "")
    .split(",").map((id) => id.trim()).filter(Boolean))).slice(0, 50);
  if (!ids.length) return { empty: true };
  if (ids.some((id) => id.length > 120)) return { error: "Invalid port ID." };
  params.set("port_ids", ids.join(","));
  const fresh = url.searchParams.get("fresh") === "1";
  if (fresh) params.set("fresh", "1");
  return { params, ttl: 60, fresh };
}

async function cachedCompatibilityGet(url) {
  const normalized = normalizeGet(url);
  if (normalized.retired) {
    return json({ success: false, error: "The device catalog is served from static JSON." }, 410, {
      "Cache-Control": "no-store",
    });
  }
  if (normalized.error) return json({ success: false, error: normalized.error }, 400);
  if (normalized.empty) return json({ success: true, compatibility: {} });

  const upstreamUrl = new URL(UPSTREAM_BASE + "/compatibility");
  upstreamUrl.search = normalized.params.toString();
  if (normalized.fresh) {
    const response = await fetch(upstreamUrl, { headers: { Accept: "application/json" } });
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    headers.set("Cache-Control", "no-store");
    headers.set("X-NAPL-Cache", "BYPASS");
    return new Response(response.body, { status: response.status, headers });
  }

  const cacheKey = new Request(`${url.origin}${url.pathname}?${normalized.params.toString()}`, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-NAPL-Cache", "HIT");
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(cached.body, { status: cached.status, headers });
  }

  const key = cacheKey.url;
  if (inflight.has(key)) {
    const shared = await inflight.get(key);
    const headers = new Headers(shared.headers);
    headers.set("X-NAPL-Cache", "COALESCED");
    return new Response(shared.clone().body, { status: shared.status, headers });
  }

  const task = (async () => {
    const response = await fetch(upstreamUrl, { headers: { Accept: "application/json" } });
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    headers.set("X-NAPL-Cache", "MISS");
    if (response.ok) {
      headers.set("Cache-Control", `public, max-age=${normalized.ttl}`);
      await cache.put(cacheKey, new Response(response.clone().body, {
        status: response.status,
        headers,
      }));
    } else {
      headers.set("Cache-Control", "no-store");
    }
    return new Response(response.body, { status: response.status, headers });
  })();

  inflight.set(key, task);
  try {
    return (await task).clone();
  } finally {
    inflight.delete(key);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") {
      if (!POST_ROUTES.has(routePath) && routePath !== "/compatibility") {
        return json({ success: false, error: "Not found." }, 404);
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET" && routePath === "/compatibility") {
      try {
        return await cachedCompatibilityGet(url);
      } catch {
        return json({ success: false, error: "Compatibility service temporarily unavailable." }, 502, {
          "Cache-Control": "no-store",
        });
      }
    }

    if (request.method === "GET" && (routePath === "/popularity" || routePath === "/ratings")) {
      return json({ success: false, error: "Public data is served from static snapshots." }, 410, {
        "Cache-Control": "no-store",
      });
    }

    if (request.method === "POST" && POST_ROUTES.has(routePath)) {
      try {
        const upstream = await fetch(UPSTREAM_BASE + routePath, {
          method: "POST",
          headers: {
            "Content-Type": request.headers.get("Content-Type") || "application/json",
            ...(request.headers.get("Authorization") ? { Authorization: request.headers.get("Authorization") } : {}),
            ...(request.headers.get("apikey") ? { apikey: request.headers.get("apikey") } : {}),
          },
          body: request.body,
        });
        const headers = new Headers(upstream.headers);
        for (const [key, value] of Object.entries(cors)) headers.set(key, value);
        headers.set("Cache-Control", "no-store");
        return new Response(upstream.body, { status: upstream.status, headers });
      } catch {
        return json({ success: false, error: "Community request could not be processed." }, 502, {
          "Cache-Control": "no-store",
        });
      }
    }

    return json({ success: false, error: "Method not allowed or route not found." }, 405, {
      "Allow": "GET, POST, OPTIONS",
    });
  },
};
