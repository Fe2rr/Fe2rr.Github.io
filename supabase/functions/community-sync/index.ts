const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...headers,
    },
  });
}

function getBackendKey(): { key: string; legacy: boolean } {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return { key: legacyKey, legacy: true };

  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const key = JSON.parse(raw)?.default;
      if (typeof key === "string" && key) return { key, legacy: false };
    } catch {
      // Report a clear configuration error below.
    }
  }
  throw new Error("Supabase server key is not configured.");
}

function getBaseUrl() {
  const value = Deno.env.get("SUPABASE_URL");
  if (!value) throw new Error("SUPABASE_URL is not configured.");
  return value.replace(/\/+$/, "");
}

function backendHeaders(extra: Record<string, string> = {}) {
  const { key, legacy } = getBackendKey();
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    ...extra,
  };
  if (legacy) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function dbRequest(path: string, method = "GET", body?: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${getBaseUrl()}/rest/v1/${path}`, {
    method,
    headers: backendHeaders(extraHeaders),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("Database returned an invalid response.");
  }
  if (!response.ok) {
    console.error("Community sync database error:", response.status, data);
    throw new Error("Could not read or update community data.");
  }
  return data;
}

async function rpc(name: string, args: Record<string, unknown>) {
  return await dbRequest(`rpc/${name}`, "POST", args);
}

const githubPermissionCache = new Map<string, { expiresAt: number; allowed: boolean }>();

async function verifyGithubAdminPat(request: Request): Promise<boolean> {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() || "";
  if (!token || token.length > 512) return false;

  const cached = githubPermissionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  try {
    const response = await fetch("https://api.github.com/repos/Fe2rr/NAPL-Data", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NAPL-community-sync",
      },
    });
    if (!response.ok) return false;
    const repository = await response.json();
    const allowed = repository?.permissions?.push === true || repository?.permissions?.admin === true;
    githubPermissionCache.set(token, { allowed, expiresAt: Date.now() + 60_000 });
    return allowed;
  } catch {
    return false;
  }
}

async function handleSnapshot() {
  const [ratings, week, month, alltime, compatibility] = await Promise.all([
    rpc("napl_get_ratings", {}),
    rpc("napl_get_popularity", { p_period: "week" }),
    rpc("napl_get_popularity", { p_period: "month" }),
    rpc("napl_get_popularity", { p_period: "alltime" }),
    rpc("napl_get_compatibility_summary", {}),
  ]);

  return json({
    version: 1,
    generatedAt: new Date().toISOString(),
    ratings: ratings || { ports: [], global_avg: 0 },
    popularity: {
      week: Array.isArray(week) ? week : [],
      month: Array.isArray(month) ? month : [],
      alltime: Array.isArray(alltime) ? alltime : [],
    },
    compatibility: compatibility && typeof compatibility === "object" ? compatibility : {},
  }, 200, { "Cache-Control": "no-store" });
}

async function handlePendingReports() {
  const reports = await dbRequest(
    "link_reports?select=id,port_id,reason,note,url,created_at,updated_at&discord_notified_at=is.null&order=id.asc&limit=50"
  );
  return json({ success: true, reports: Array.isArray(reports) ? reports : [] }, 200, {
    "Cache-Control": "no-store",
  });
}

async function handleAck(request: Request) {
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids)
    ? body.ids.map((value: unknown) => Number(value)).filter((value: number) => Number.isSafeInteger(value) && value > 0).slice(0, 100)
    : [];
  if (!ids.length) return json({ success: true, acked: 0 });

  await dbRequest(
    `link_reports?id=in.(${ids.join(",")})`,
    "PATCH",
    { discord_notified_at: new Date().toISOString() },
    { Prefer: "return=minimal" },
  );
  return json({ success: true, acked: ids.length });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/health")) {
    return json({ ok: true, service: "napl-community-sync" });
  }

  if (!(await verifyGithubAdminPat(request))) {
    return json({ success: false, error: "admin_github_pat_invalid" }, 401, { "Cache-Control": "no-store" });
  }

  try {
    if (request.method === "GET" && url.pathname.endsWith("/admin-dashboard")) {
      const [snapshotResponse, reports] = await Promise.all([
        handleSnapshot(),
        dbRequest("link_reports?select=id,port_id,reason,note,url,created_at,updated_at,discord_notified_at&order=updated_at.desc&limit=100"),
      ]);
      if (!snapshotResponse.ok) {
        throw new Error("Could not assemble community dashboard.");
      }
      const snapshot = await snapshotResponse.json();
      return json({
        success: true,
        snapshot,
        reports: Array.isArray(reports) ? reports : [],
      }, 200, { "Cache-Control": "no-store" });
    }
    if (request.method === "GET" && url.pathname.endsWith("/community-snapshot")) {
      return await handleSnapshot();
    }
    if (request.method === "GET" && url.pathname.endsWith("/link-reports-pending")) {
      return await handlePendingReports();
    }
    if (request.method === "POST" && url.pathname.endsWith("/link-reports-pending/ack")) {
      return await handleAck(request);
    }
    return json({ success: false, error: "not_found" }, 404);
  } catch (error) {
    console.error("NAPL community sync error:", error);
    return json({ success: false, error: "community_data_unavailable" }, 500);
  }
});
