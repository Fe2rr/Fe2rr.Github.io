export {};

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RATE_LIMIT_WINDOW_MS = 60_000;
const recentReports = new Map<string, number>();

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

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ success: false, error: "Invalid JSON body." }, 400);
    }

    const payload = body as Record<string, unknown>;
    const clientId = String(payload.client_id || "").trim();
    const portId = String(payload.port_id || "").trim().slice(0, 120);
    const reason = String(payload.reason || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const note = String(
      payload.note ?? payload.details ?? payload.comment ?? payload.message ?? "",
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const url = String(payload.url || "").trim().slice(0, 500);

    if (
      !UUID_REGEX.test(clientId) ||
      !portId ||
      (!reason && note.length < 3) ||
      !isValidHttpUrl(url)
    ) {
      return json({ success: false, error: "Invalid report details." }, 400);
    }

    const rateKey = `${clientId}:${portId}`;
    const now = Date.now();
    const lastSentAt = recentReports.get(rateKey) || 0;
    const elapsed = now - lastSentAt;
    if (elapsed < RATE_LIMIT_WINDOW_MS) {
      const retryAfterSeconds = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
      return json(
        {
          success: false,
          error: `Please wait ${retryAfterSeconds}s before reporting this link again.`,
          retry_after_seconds: retryAfterSeconds,
        },
        429,
      );
    }

    const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL") || "";
    if (!webhookUrl) {
      return json(
        { success: false, error: "Discord webhook is not configured." },
        500,
      );
    }

    const displayReason = reason || "Custom note";
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: "Port", value: `\`${portId}\``, inline: true },
      { name: "Reason", value: displayReason, inline: true },
    ];

    if (note && note !== displayReason) {
      fields.push({ name: "Note", value: note, inline: false });
    }

    fields.push({ name: "URL", value: url, inline: false });

    const discordResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: "Broken Link Report",
            color: 0xf5c451,
            fields,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    if (!discordResponse.ok) {
      const detail = await discordResponse.text().catch(() => "");
      console.error("Discord webhook error:", discordResponse.status, detail);
      return json(
        { success: false, error: "Could not deliver link report." },
        502,
      );
    }

    recentReports.set(rateKey, now);

    return json(
      {
        success: true,
        port_id: portId,
        reason: displayReason,
        note,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (error) {
    console.error("Report link function error:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error.",
      },
      500,
    );
  }
});
