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

function stableComparableReports(doc) {
  return JSON.stringify(Array.isArray(doc?.reports) ? doc.reports : []);
}

function reportKey(report) {
  if (report?.id !== undefined && report?.id !== null && String(report.id).trim() !== "") {
    return `id:${String(report.id).trim()}`;
  }
  return `key:${String(report?.port_id || "")}|${String(report?.created_at || report?.updated_at || "")}|${String(report?.url || "")}`;
}

export function mergeLinkReportsDocument(existingDoc, incomingReports, { notifiedIds = [], notifiedAt = "" } = {}) {
  const existingList = Array.isArray(existingDoc?.reports) ? existingDoc.reports : [];
  const byKey = new Map();

  for (const item of existingList) {
    if (!item || typeof item !== "object") continue;
    const normalized = {
      id: item.id ?? null,
      port_id: String(item.port_id || ""),
      reason: String(item.reason || ""),
      note: String(item.note || ""),
      url: String(item.url || ""),
      created_at: String(item.created_at || ""),
      updated_at: String(item.updated_at || item.created_at || ""),
      discord_notified_at: item.discord_notified_at ? String(item.discord_notified_at) : null,
      status: item.status === "resolved" ? "resolved" : "pending",
      resolved_at: item.resolved_at ? String(item.resolved_at) : null,
    };
    byKey.set(reportKey(normalized), normalized);
  }

  for (const raw of Array.isArray(incomingReports) ? incomingReports : []) {
    if (!raw || typeof raw !== "object") continue;
    const key = reportKey(raw);
    const prev = byKey.get(key);
    const nextUpdatedAt = String(raw.updated_at || raw.created_at || prev?.updated_at || "");
    const reopened = Boolean(
      prev?.status === "resolved" &&
        prev?.resolved_at &&
        nextUpdatedAt &&
        Date.parse(nextUpdatedAt) > Date.parse(prev.resolved_at)
    );
    const status = reopened ? "pending" : (prev?.status === "resolved" ? "resolved" : "pending");
    byKey.set(key, {
      id: raw.id ?? prev?.id ?? null,
      port_id: String(raw.port_id ?? prev?.port_id ?? ""),
      reason: String(raw.reason ?? prev?.reason ?? ""),
      note: String(raw.note ?? prev?.note ?? ""),
      url: String(raw.url ?? prev?.url ?? ""),
      created_at: String(raw.created_at ?? prev?.created_at ?? nextUpdatedAt),
      updated_at: nextUpdatedAt,
      discord_notified_at: raw.discord_notified_at
        ? String(raw.discord_notified_at)
        : (prev?.discord_notified_at || null),
      status,
      resolved_at: status === "resolved" ? (prev?.resolved_at || null) : null,
    });
  }

  const notifiedSet = new Set(notifiedIds.map((id) => String(id)));
  if (notifiedSet.size > 0 && notifiedAt) {
    for (const entry of byKey.values()) {
      if (entry.id !== null && notifiedSet.has(String(entry.id))) {
        entry.discord_notified_at = notifiedAt;
      }
    }
  }

  const reports = [...byKey.values()]
    .sort((a, b) => {
      const aTime = Date.parse(a.updated_at || a.created_at || "") || 0;
      const bTime = Date.parse(b.updated_at || b.created_at || "") || 0;
      if (bTime !== aTime) return bTime - aTime;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    })
    .slice(0, 1000);

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    reports,
  };
}

export async function syncCommunitySummary({
  apiBase = process.env.NAPL_COMMUNITY_API_BASE || "https://gsksanvcdbdoevairzpj.supabase.co/functions/v1/community-sync",
  token = process.env.NAPL_DATA_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "",
  dataDir = process.env.NAPL_DATA_DIR || "data",
  discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const cleanBase = String(apiBase || "").trim().replace(/\/+$/, "");
  if (!cleanBase) {
    console.log("NAPL_COMMUNITY_API_BASE is not configured; skipping community summary sync.");
    return { skipped: true, snapshotChanged: false, linkReportsChanged: false, reportsDispatched: 0 };
  }

  if (!token) {
    throw new Error("Missing NAPL_DATA_GITHUB_TOKEN for authenticated community snapshot sync.");
  }

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  // 1. Fetch pre-aggregated public community snapshot from Supabase Edge Function + Postgres
  const snapshotRes = await fetchImpl(`${cleanBase}/community-snapshot`, {
    method: "GET",
    headers,
  });
  if (snapshotRes.status === 429) {
    let retryAfterSeconds = Number(snapshotRes.headers?.get?.("Retry-After") || 0) || null;
    try {
      const cooldownBody = await snapshotRes.clone().json();
      retryAfterSeconds =
        Number(cooldownBody?.retry_after_seconds || retryAfterSeconds || 0) || null;
    } catch {
      // A cooldown response may have no JSON body.
    }
    console.log(
      retryAfterSeconds
        ? `Community snapshot is cooling down; skipping this run. Retry after approximately ${retryAfterSeconds}s.`
        : "Community snapshot is cooling down (HTTP 429); skipping this run without treating it as a failure."
    );
    return {
      skipped: true,
      cooldown: true,
      retryAfterSeconds,
      snapshotChanged: false,
      linkReportsChanged: false,
      reportsDispatched: 0,
    };
  }
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

  // 2. Archive queued link reports in private/link-reports.json and optionally dispatch Discord digest
  let reportsDispatched = 0;
  let linkReportsChanged = false;
  const linkReportsPath = path.join(dataDir, "private", "link-reports.json");
  let existingReportsDoc = null;
  let prevReportsRaw = "";
  let prevReportsComparable = "";
  if (fs.existsSync(linkReportsPath)) {
    try {
      prevReportsRaw = fs.readFileSync(linkReportsPath, "utf8");
      existingReportsDoc = JSON.parse(prevReportsRaw);
      prevReportsComparable = stableComparableReports(existingReportsDoc);
    } catch {
      existingReportsDoc = null;
      prevReportsComparable = "";
    }
  }

  const pendingRes = await fetchImpl(`${cleanBase}/link-reports-pending`, {
    method: "GET",
    headers,
  });
  if (pendingRes.status === 429) {
    console.log("Pending link reports endpoint is cooling down (HTTP 429); keeping existing private/link-reports.json.");
    return {
      skipped: false,
      snapshotChanged,
      linkReportsChanged: false,
      reportsDispatched: 0,
      outputPath,
      linkReportsPath,
    };
  }
  if (!pendingRes.ok) {
    throw new Error(`Pending link reports fetch failed (HTTP ${pendingRes.status}).`);
  }

  const pendingData = await pendingRes.json();
  const reports = Array.isArray(pendingData?.reports) ? pendingData.reports : [];

  let notifiedIds = [];
  let notifiedAt = "";
  const cleanWebhook = String(discordWebhookUrl || "").trim();
  if (cleanWebhook && reports.length > 0) {
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
      notifiedIds = ids;
      notifiedAt = new Date().toISOString();
    }
    reportsDispatched = reports.length;
    console.log(`Dispatched ${reportsDispatched} link report(s) to Discord.`);
  } else if (cleanWebhook) {
    console.log("No pending link reports for Discord digest.");
  }

  const nextReportsDoc = mergeLinkReportsDocument(existingReportsDoc, reports, {
    notifiedIds,
    notifiedAt,
  });
  const nextReportsComparable = stableComparableReports(nextReportsDoc);
  if (nextReportsComparable !== prevReportsComparable || !prevReportsRaw) {
    fs.mkdirSync(path.dirname(linkReportsPath), { recursive: true });
    fs.writeFileSync(linkReportsPath, `${JSON.stringify(nextReportsDoc, null, 2)}\n`, "utf8");
    linkReportsChanged = true;
    console.log(`Updated ${linkReportsPath}`);
  } else {
    console.log("Private link reports archive unchanged; skipping file write.");
  }

  return {
    skipped: false,
    snapshotChanged,
    linkReportsChanged,
    reportsDispatched,
    outputPath,
    linkReportsPath,
  };
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  syncCommunitySummary().catch((err) => {
    console.error("sync-community-summary failed:", err);
    process.exit(1);
  });
}
