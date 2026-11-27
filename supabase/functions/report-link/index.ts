const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_REASONS = [
  "Dead / 404 link",
  "Wrong game or version",
  "Requires account / paywall",
  "Suspicious / broken file",
];

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

function getBackendKey(): string {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;

  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    try {
      const keys = JSON.parse(secretKeysRaw);
      if (typeof keys?.default === "string" && keys.default) return keys.default;
    } catch {
      // Report a clear configuration error below.
    }
  }
  throw new Error("Supabase server key is not configured.");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function postgrest(
  baseUrl: string,
  key: string,
  path: string,
  method: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("Database returned an invalid response.");
  }
  if (!response.ok) {
    console.error("Report-link database error:", response.status, data);
    throw new Error("Could not save the report.");
  }
  return data;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2048) {
      return json({ success: false, error: "body_too_large" }, 413);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ success: false, error: "Invalid JSON body." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ success: false, error: "Invalid JSON body." }, 400);
    }

    const portId = typeof body.port_id === "string" ? body.port_id.trim().slice(0, 120) : "";
    const reason = typeof body.reason === "string"
      ? body.reason.replace(/\s+/g, " ").trim().slice(0, 120)
      : "";
    const note = typeof body.note === "string"
      ? body.note.replace(/\s+/g, " ").trim().slice(0, 500)
      : "";
    const reportUrl = typeof body.url === "string" ? body.url.trim().slice(0, 500) : "";
    const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";

    const validReason = ALLOWED_REASONS.includes(reason);
    const validCustomNote = !reason && note.length >= 3;

    if (
      !/^[a-z0-9][a-z0-9|._-]{0,119}$/i.test(portId) ||
      (!validReason && !validCustomNote) ||
      !UUID_REGEX.test(clientId)
    ) {
      return json({ success: false, error: "Invalid report details." }, 400);
    }

    let normalizedUrl = "";
    if (reportUrl) {
      try {
        const parsedUrl = new URL(reportUrl);
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
          return json({ success: false, error: "Invalid report URL." }, 400);
        }
        normalizedUrl = parsedUrl.toString();
      } catch {
        return json({ success: false, error: "Invalid report URL." }, 400);
      }
    }

    const baseUrl = Deno.env.get("SUPABASE_URL");
    if (!baseUrl) throw new Error("SUPABASE_URL is not configured.");

    const key = getBackendKey();
    const ip = request.headers.get("cf-connecting-ip")
      || request.headers.get("x-real-ip")
      || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || "unknown";

    const reporterHash = await hmacHex(key, `${clientId}:${ip}`);

    const reservation = await postgrest(
      baseUrl,
      key,
      "rpc/napl_reserve_link_report",
      "POST",
      { p_reporter_hash: reporterHash },
    ) as { allowed?: boolean; retry_after_seconds?: number } | null;

    if (!reservation?.allowed) {
      const retryAfter = Math.max(1, Number(reservation?.retry_after_seconds) || 600);
      return json({
        success: false,
        error: `You can submit another report in ${Math.ceil(retryAfter / 60)} minute(s).`,
        retry_after_seconds: retryAfter,
      }, 429, { "Retry-After": String(retryAfter) });
    }

    const displayReason = reason || "Custom note";

    await postgrest(
      baseUrl,
      key,
      "link_reports?on_conflict=port_id,reporter_hash",
      "POST",
      {
        port_id: portId,
        reporter_hash: reporterHash,
        reason: displayReason,
        note,
        url: normalizedUrl,
        updated_at: new Date().toISOString(),
        discord_notified_at: null,
      },
      { Prefer: "resolution=merge-duplicates,return=minimal" },
    );

    return json({
      success: true,
      portId,
      reason: displayReason,
      note,
      queued_for_digest: true,
    }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    console.error("Report-link function error:", error);
    return json({ success: false, error: "Could not process the report." }, 500);
  }
});
