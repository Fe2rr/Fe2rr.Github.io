const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders, ...headers },
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
    } catch { /* handled below */ }
  }
  throw new Error("Supabase server key is not configured.");
}

async function rpc(name: string, args: Record<string, unknown>) {
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) throw new Error("SUPABASE_URL is not configured.");
  const { key, legacy } = getBackendKey();
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (legacy) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: "POST", headers, body: JSON.stringify(args),
  });
  const raw = await response.text();
  let data: unknown = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { throw new Error("Invalid database response."); }
  if (!response.ok) {
    console.error("Popularity database error:", response.status, data);
    throw new Error("database_error");
  }
  return data;
}

async function hashIp(request: Request): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || forwarded || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + ":" + day));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const period = (url.searchParams.get("period") || "week").toLowerCase();
      if (!["week", "month", "alltime"].includes(period)) return json({ error: "invalid_period" }, 400);
      const games = await rpc("napl_get_popularity", { p_period: period });
      return json({ success: true, period, games: Array.isArray(games) ? games : [] }, 200, {
        "Cache-Control": "public, max-age=20, s-maxage=30",
      });
    }
    if (request.method === "POST") {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 1024) return json({ error: "body_too_large" }, 413);
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid_json" }, 400);
        body = parsed as Record<string, unknown>;
      } catch { return json({ error: "invalid_json" }, 400); }
      const gameKey = typeof body.game === "string" ? body.game.trim().toLowerCase() : "";
      if (!/^[a-z0-9][a-z0-9-]{0,179}$/.test(gameKey)) return json({ error: "invalid_game" }, 400);
      const accepted = await rpc("napl_register_game_visit", {
        p_game_key: gameKey,
        p_ip_hash: await hashIp(request),
      });
      return json({ success: true, counted: accepted === true }, 200, { "Cache-Control": "no-store" });
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    console.error("Popularity function error:", error);
    return json({ error: "server_error" }, 500);
  }
});
