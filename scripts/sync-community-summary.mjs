import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function stableComparableSummary(summary) {
  return JSON.stringify({
    ratings: summary?.ratings || { ports: [], global_avg: 0 },
    popularity: summary?.popularity || { week: [], month: [], alltime: [] },
    compatibility: summary?.compatibility || {},
  });
}

export function buildDiscordDigestPayload(reports) {
  const list = Array.isArray(reports) ? reports : [];
  const shown = list.slice(0, 15);
  const fields = shown.map((r) => {
    const portId = String(r?.port_id || "unknown").slice(0, 120);
    const reason = String(r?.reason || "Report").slice(0, 120);
    const note = String(r?.note || "").trim().slice(0, 300);
    const url = String(r?.url || "").trim().slice(0, 350);
    const parts = [`**Reason:** ${reason}`];
    if (note) parts.push(`**Note:** ${note}`);
    if (url) parts.push(`**URL:** ${url}`);
    return {
      name: `Port: ${portId}`.slice(0, 256),
      value: parts.join("\n").slice(0, 1024),
      inline: false,
    };
  });

  const extra = list.length > shown.length ? `\n…and ${list.length - shown.length} more pending.` : "";
  return {
    username: "NAPL Link Digest",
    embeds: [
      {
        title: "NAPL — Broken Link Report Digest",
        description: `${list.length} pending community link report(s).${extra}`.slice(0, 4096),
        color: 0xe67e22,
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export async function syncCommunitySummary({
  apiBase = process.env.NAPL_COMMUNITY_API_BASE || "",
  token = process.env.NAPL_DATA_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "",
  dataDir = process.env.NAPL_DATA_DIR || "data",
  discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const cleanBase = String(apiBase || "").trim().replace(/\/+$/, "");
  if (!cleanBase) {
    console.log("NAPL_COMMUNITY_API_BASE is not configured; skipping community summary sync.");
    return { skipped: true, snapshotChanged: false, reportsDispatched: 0 };
  }

  if (!token) {
    throw new Error("Missing NAPL_DATA_GITHUB_TOKEN for authenticated community snapshot sync.");
  }

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  // 1. Fetch pre-aggregated public community snapshot from Cloudflare Worker + D1
  const snapshotRes = await fetchImpl(`${cleanBase}/community-snapshot`, {
    method: "GET",
    headers,
  });
  if (!snapshotRes.ok) {
    throw new Error(`Community snapshot fetch failed (HTTP ${snapshotRes.status}).`);
  }
  const snapshot = await snapshotRes.json();
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !snapshot.ratings ||
    !snapshot.popularity ||
    !snapshot.compatibility
  ) {
    throw new Error("Community snapshot payload is invalid.");
  }

  const outputPath = path.join(dataDir, "public", "assets", "data", "community-summary.json");
  let prevRaw = "";
  let prevComparable = "";
  if (fs.existsSync(outputPath)) {
    try {
      prevRaw = fs.readFileSync(outputPath, "utf8");
      prevComparable = stableComparableSummary(JSON.parse(prevRaw));
    } catch {
      prevComparable = "";
    }
  }

  const nextComparable = stableComparableSummary(snapshot);
  let snapshotChanged = false;
  if (nextComparable !== prevComparable || !prevRaw) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    snapshotChanged = true;
    console.log(`Updated ${outputPath}`);
  } else {
    console.log("Community snapshot unchanged; skipping file write.");
  }

  // 2. Periodic Discord digest for queued link reports
  let reportsDispatched = 0;
  const cleanWebhook = String(discordWebhookUrl || "").trim();
  if (cleanWebhook) {
    const pendingRes = await fetchImpl(`${cleanBase}/link-reports-pending`, {
      method: "GET",
      headers,
    });
    if (!pendingRes.ok) {
      throw new Error(`Pending link reports fetch failed (HTTP ${pendingRes.status}).`);
    }
    const pendingData = await pendingRes.json();
    const reports = Array.isArray(pendingData?.reports) ? pendingData.reports : [];

    if (reports.length > 0) {
      const payload = buildDiscordDigestPayload(reports);
      const discordRes = await fetchImpl(cleanWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!discordRes.ok) {
        throw new Error(`Discord webhook failed (HTTP ${discordRes.status}).`);
      }

      const ids = reports
        .map((r) => Number(r?.id))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length > 0) {
        const ackRes = await fetchImpl(`${cleanBase}/link-reports-pending/ack`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids }),
        });
        if (!ackRes.ok) {
          throw new Error(`Link report ACK failed (HTTP ${ackRes.status}).`);
        }
      }
      reportsDispatched = reports.length;
      console.log(`Dispatched ${reportsDispatched} link report(s) to Discord.`);
    } else {
      console.log("No pending link reports for Discord digest.");
    }
  }

  return { skipped: false, snapshotChanged, reportsDispatched, outputPath };
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  syncCommunitySummary().catch((err) => {
    console.error("sync-community-summary failed:", err);
    process.exit(1);
  });
}
