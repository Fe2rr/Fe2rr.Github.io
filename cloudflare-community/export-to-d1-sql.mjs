import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dumpArg = process.argv[2] || "napl-supabase-export.json";
const outDirArg = process.argv[3] || path.join(__dirname, "d1-import");
const dumpPath = path.resolve(process.cwd(), dumpArg);
const outDir = path.resolve(process.cwd(), outDirArg);

if (!fs.existsSync(dumpPath)) {
  throw new Error(`Export file not found: ${dumpPath}`);
}

const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
if (!dump?.tables || typeof dump.tables !== "object") {
  throw new Error("Invalid napl-supabase-export.json structure.");
}

function sqlStr(v) {
  return `'${String(v ?? "").replace(/'/g, "''")}'`;
}

function loadDevicesFromRepo() {
  const devicesFile = path.resolve(__dirname, "../public/assets/data/devices.json");
  if (!fs.existsSync(devicesFile)) return [];
  const parsed = JSON.parse(fs.readFileSync(devicesFile, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (parsed?.format === "napl-device-catalog-shards-v1" && Array.isArray(parsed.chunks)) {
    const dir = path.join(path.dirname(devicesFile), "device-catalog");
    const list = [];
    for (const c of parsed.chunks) {
      const f = String(c?.file || "");
      if (!/^devices-part-\d{3}\.json$/.test(f)) continue;
      const p = path.join(dir, f);
      if (fs.existsSync(p)) {
        const part = JSON.parse(fs.readFileSync(p, "utf8"));
        if (Array.isArray(part)) list.push(...part);
      }
    }
    return list;
  }
  return [];
}

fs.mkdirSync(outDir, { recursive: true });

// 1. Devices SQL (batch inserts of 250 rows each for clean D1 import)
const t = dump.tables;
const deviceRows = Array.isArray(t.devices) && t.devices.length > 0 ? t.devices : loadDevicesFromRepo();
const deviceMap = new Map();
for (const d of deviceRows) {
  if (d?.id && d?.name) deviceMap.set(d.id, d);
}

const deviceSql = [];
for (let i = 0; i < deviceRows.length; i += 250) {
  const chunk = deviceRows.slice(i, i + 250).filter((d) => d?.id && d?.name);
  if (!chunk.length) continue;
  const values = chunk
    .map(
      (d) =>
        `(${sqlStr(d.id)}, ${sqlStr(d.name)}, ${sqlStr(d.manufacturer || "")}, ${sqlStr(
          d.model || d.name
        )}, ${sqlStr(d.soc || "")}, ${sqlStr(d.device_type || d.deviceType || "phone")})`
    )
    .join(",\n");
  deviceSql.push(
    `INSERT OR REPLACE INTO devices (id, name, manufacturer, model, soc, device_type) VALUES\n${values};`
  );
}
fs.writeFileSync(path.join(outDir, "01-devices.sql"), deviceSql.join("\n\n") + "\n", "utf8");

// 2. Community tables SQL + aggregated tables
const sql = [];
const COMPAT_STATUSES = new Set(["crash", "low_fps", "playable_30", "playable_60"]);

for (const r of t.rating_tokens || []) {
  if (!r.token_hash) continue;
  sql.push(
    `INSERT OR IGNORE INTO rating_tokens (token_hash, ip_hash, created_at) VALUES (${sqlStr(
      r.token_hash
    )}, ${sqlStr(r.ip_hash || "")}, ${sqlStr(r.created_at || new Date().toISOString())});`
  );
}

const ratingPortAgg = new Map();
let totalRatingVotes = 0;
let totalRatingStars = 0;
for (const r of t.rating_votes || []) {
  const stars = Number(r.stars || 0);
  if (!r.port_id || !r.token_hash || stars < 1 || stars > 5) continue;
  sql.push(
    `INSERT OR REPLACE INTO rating_votes (port_id, token_hash, stars, created_at, updated_at) VALUES (${sqlStr(
      r.port_id
    )}, ${sqlStr(r.token_hash)}, ${stars}, ${sqlStr(
      r.created_at || new Date().toISOString()
    )}, ${sqlStr(r.updated_at || r.created_at || new Date().toISOString())});`
  );
  totalRatingVotes += 1;
  totalRatingStars += stars;
  const cur = ratingPortAgg.get(r.port_id) || { votes: 0, sum: 0 };
  cur.votes += 1;
  cur.sum += stars;
  ratingPortAgg.set(r.port_id, cur);
}

const nowIso = new Date().toISOString();
for (const [portId, agg] of ratingPortAgg.entries()) {
  sql.push(
    `INSERT OR REPLACE INTO rating_port_stats (port_id, votes, sum_stars, updated_at) VALUES (${sqlStr(
      portId
    )}, ${agg.votes}, ${agg.sum}, ${sqlStr(nowIso)});`
  );
}
sql.push(
  `INSERT OR REPLACE INTO rating_global_meta (id, total_votes, total_sum, updated_at) VALUES (1, ${totalRatingVotes}, ${totalRatingStars}, ${sqlStr(
    nowIso
  )});`
);

for (const r of t.game_popularity || []) {
  const key = String(r.game_key || "").trim().toLowerCase();
  if (!key) continue;
  sql.push(
    `INSERT OR REPLACE INTO game_popularity (game_key, all_time_visits, week_visits, month_visits, week_start, month_start, updated_at) VALUES (${sqlStr(
      key
    )}, ${Number(r.all_time_visits || 0)}, ${Number(r.week_visits || 0)}, ${Number(
      r.month_visits || 0
    )}, ${sqlStr(r.week_start || nowIso.slice(0, 10))}, ${sqlStr(
      r.month_start || nowIso.slice(0, 7) + "-01"
    )}, ${sqlStr(r.updated_at || nowIso)});`
  );
}

const compatAgg = new Map();
for (const r of t.compatibility_reports || []) {
  if (!r.port_id || !r.token_hash || !r.device_id) continue;
  const status = COMPAT_STATUSES.has(r.status) ? r.status : r.works ? "playable_30" : "crash";
  const works = status === "playable_30" || status === "playable_60" ? 1 : 0;
  const dev = deviceMap.get(r.device_id);
  const name = dev?.model || r.device_name || r.device_id;
  const soc = dev?.soc || "";
  const dtype = dev?.device_type || dev?.deviceType || "phone";
  sql.push(
    `INSERT OR REPLACE INTO compatibility_reports (port_id, token_hash, device_id, device_name, device_soc, device_type, works, updated_at, status) VALUES (${sqlStr(
      r.port_id
    )}, ${sqlStr(r.token_hash)}, ${sqlStr(r.device_id)}, ${sqlStr(name)}, ${sqlStr(soc)}, ${sqlStr(
      dtype
    )}, ${works}, ${sqlStr(r.updated_at || nowIso)}, ${sqlStr(status)});`
  );
  const cur = compatAgg.get(r.port_id) || { yes: 0, no: 0, p60: 0, p30: 0, low: 0, crash: 0 };
  if (works) cur.yes += 1;
  else cur.no += 1;
  if (status === "playable_60") cur.p60 += 1;
  else if (status === "playable_30") cur.p30 += 1;
  else if (status === "low_fps") cur.low += 1;
  else cur.crash += 1;
  compatAgg.set(r.port_id, cur);
}

for (const [portId, c] of compatAgg.entries()) {
  sql.push(
    `INSERT OR REPLACE INTO compat_port_stats (port_id, yes_count, no_count, p60, p30, low_fps, crash, updated_at) VALUES (${sqlStr(
      portId
    )}, ${c.yes}, ${c.no}, ${c.p60}, ${c.p30}, ${c.low}, ${c.crash}, ${sqlStr(nowIso)});`
  );
}

for (const r of t.link_reports || []) {
  if (!r.port_id || !r.reporter_hash) continue;
  sql.push(
    `INSERT OR REPLACE INTO link_reports (port_id, reporter_hash, reason, note, url, created_at, updated_at, discord_notified_at) VALUES (${sqlStr(
      r.port_id
    )}, ${sqlStr(r.reporter_hash)}, ${sqlStr(r.reason || "Custom note")}, ${sqlStr(
      r.note || ""
    )}, ${sqlStr(r.url || "")}, ${sqlStr(r.created_at || nowIso)}, ${sqlStr(
      r.updated_at || r.created_at || nowIso
    )}, ${sqlStr(nowIso)});`
  );
}

for (const r of t.link_report_rate_limits || []) {
  if (!r.reporter_hash) continue;
  sql.push(
    `INSERT OR REPLACE INTO link_report_rate_limits (reporter_hash, last_report_at) VALUES (${sqlStr(
      r.reporter_hash
    )}, ${sqlStr(r.last_report_at || nowIso)});`
  );
}

fs.writeFileSync(path.join(outDir, "02-community.sql"), sql.join("\n") + "\n", "utf8");
console.log(
  `Generated D1 import SQL in ${outDir}: ${deviceRows.length} devices, ${totalRatingVotes} rating votes.`
);
