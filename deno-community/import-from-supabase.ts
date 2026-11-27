import {
  rebuildAllSummaries,
  type CompatReportRecord,
  type CompatStatus,
  type LinkReportRecord,
  type PopularityRecord,
  utcMonthStart,
  utcWeekStart,
} from "./kv-store.ts";

const dumpArg = Deno.args[0] || "napl-supabase-export.json";
const targetArg = Deno.args[1] || Deno.env.get("DENO_KV_PATH") || undefined;

const COMPAT_STATUSES = new Set<CompatStatus>([
  "crash",
  "low_fps",
  "playable_30",
  "playable_60",
]);

const raw = await Deno.readTextFile(dumpArg);
const dump = JSON.parse(raw) as {
  tables?: Record<string, Array<Record<string, unknown>>>;
};
if (!dump?.tables) {
  throw new Error("Invalid napl-supabase-export.json structure.");
}

const kv = await Deno.openKv(targetArg);
const t = dump.tables;

for (const r of t.rating_tokens || []) {
  const tokenHash = String(r.token_hash || "");
  if (!tokenHash) continue;
  await kv.set(["rating_tokens", tokenHash], {
    ipHash: String(r.ip_hash || ""),
    createdAt: String(r.created_at || new Date().toISOString()),
  });
}

for (const r of t.rating_votes || []) {
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
}

for (const r of t.game_popularity || []) {
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
}

for (const r of t.compatibility_reports || []) {
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
  const rec: CompatReportRecord = {
    portId,
    tokenHash,
    deviceId,
    deviceName: String(r.device_name || deviceId),
    status,
    works,
    updatedAt: String(r.updated_at || new Date().toISOString()),
  };
  await kv.set(["compat_reports", portId, tokenHash, deviceId], rec);
  await kv.set(["compat_by_device", deviceId, portId, tokenHash], rec);
}

for (const r of t.link_reports || []) {
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
}

await rebuildAllSummaries(kv);
kv.close();
console.log("Successfully imported Supabase export into Deno KV.");
