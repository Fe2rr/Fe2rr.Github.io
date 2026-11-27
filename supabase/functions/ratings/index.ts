const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
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

  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    try {
      const keys = JSON.parse(secretKeysRaw);
      const key = keys?.default;
      if (typeof key === "string" && key) return { key, legacy: false };
    } catch {
      // Fall through to a clear configuration error.
    }
  }
  throw new Error("Supabase server key is not configured for this Edge Function.");
}

async function rpc(name: string, args: Record<string, unknown>) {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  if (!baseUrl) throw new Error("SUPABASE_URL is not configured.");

  const { key, legacy } = getBackendKey();
  const headers: Record<string, string> = {
    "apikey": key,
    "Content-Type": "application/json",
  };
  if (legacy) headers.Authorization = `Bearer ${key}`;

  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("Database returned an invalid response.");
  }
  if (!response.ok) {
    console.error("Ratings database error:", response.status, data);
    const detail = JSON.stringify(data);
    if (detail.includes("rate_limited")) {
      const error = new Error("rate_limited");
      (error as Error & { status?: number }).status = 429;
      throw error;
    }
    if (response.status === 400) {
      const error = new Error("invalid_request");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    throw new Error("Could not process ratings data.");
  }
  return data;
}

async function issueToken(request: Request): Promise<{ token: string }> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || forwarded
    || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip}:${day}`),
  );
  const ipHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const token = crypto.randomUUID();
  const tokenHash = await hashVoterToken(token);
  const allowed = await rpc("napl_issue_rating_token", {
    p_ip_hash: ipHash,
    p_token_hash: tokenHash,
  });
  if (allowed !== true) throw new Error("rate_limited");

  return { token };
}

async function hashVoterToken(token: unknown): Promise<string> {
  if (typeof token !== "string" || token.length > 200) {
    throw new Error("invalid_token");
  }

  // Legacy Cloudflare tokens are UUID.HMAC. The UUID is the random bearer
  // identity already used to derive the historical D1 voter hash.
  const match = token.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.([A-Za-z0-9_-]{40,50}))?$/i);
  if (!match) throw new Error("invalid_token");

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(match[1].toLowerCase()),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/ratings")) {
      const result = await rpc("napl_get_ratings", {});
      return json(result || { ports: [], global_avg: 0 }, 200, {
        "Cache-Control": "public, max-age=30, s-maxage=60",
      });
    }

    if (request.method === "POST") {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 2048) {
        return json({ error: "body_too_large" }, 413);
      }

      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return json({ error: "invalid_json" }, 400);
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      if (url.pathname.endsWith("/token")) {
        const issued = await issueToken(request);
        return json(issued, 200, { "Cache-Control": "no-store" });
      }

      const tokenHash = await hashVoterToken(body.token);
      const validToken = await rpc("napl_is_valid_rating_token", {
        p_token_hash: tokenHash,
      });
      if (validToken !== true) throw new Error("invalid_token");

      if (url.pathname.endsWith("/my-votes")) {
        const votes = await rpc("napl_get_my_votes", { p_token_hash: tokenHash });
        return json({ votes: votes || {} }, 200, { "Cache-Control": "no-store" });
      }

      if (url.pathname.endsWith("/vote")) {
        const portId = typeof body.port_id === "string" ? body.port_id.trim() : "";
        const stars = body.stars;
        if (!/^[a-z0-9][a-z0-9|._-]{0,119}$/i.test(portId)) {
          return json({ error: "invalid_port_id" }, 400);
        }
        if (!Number.isInteger(stars) || Number(stars) < 1 || Number(stars) > 5) {
          return json({ error: "invalid_stars" }, 400);
        }
        const result = await rpc("napl_submit_vote", {
          p_port_id: portId,
          p_token_hash: tokenHash,
          p_stars: Number(stars),
        });
        return json(result || { ok: true, port_id: portId, stars }, 200, {
          "Cache-Control": "no-store",
        });
      }

      if (url.pathname.endsWith("/unvote")) {
        const portId = typeof body.port_id === "string" ? body.port_id.trim() : "";
        if (!/^[a-z0-9][a-z0-9|._-]{0,119}$/i.test(portId)) {
          return json({ error: "invalid_port_id" }, 400);
        }
        const result = await rpc("napl_remove_vote", {
          p_port_id: portId,
          p_token_hash: tokenHash,
        });
        return json(result || { ok: true, port_id: portId }, 200, {
          "Cache-Control": "no-store",
        });
      }
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    if (message === "invalid_token") return json({ error: message }, 401);
    if (message === "rate_limited") return json({ error: message }, 429);
    console.error("Ratings function error:", error);
    return json({ error: "server_error" }, 500);
  }
});
