import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dumpPath = path.resolve(process.cwd(), process.argv[2] || "napl-supabase-export.json");
const outDir = path.resolve(process.cwd(), process.argv[3] || path.join(__dirname, "d1-import"));

if (!fs.existsSync(dumpPath)) throw new Error("Export file not found: " + dumpPath);
const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
if (!dump?.tables || typeof dump.tables !== "object") throw new Error("Invalid export structure.");

const t = dump.tables;
const nowIso = new Date().toISOString();
const sqlStr = (value) => "'" + String(value ?? "").replace(/'/g, "''") + "'";
const sqlNum = (value) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? String(n) : "0";
};
const sqlDate = (value) => {
  const date = value ? new Date(value) : new Date(nowIso);
  return sqlStr(Number.isFinite(date.getTime()) ? date.toISOString() : String(value || nowIso));
};

function pushBatches(out, table, columns, rows, mapper, mode = "OR REPLACE", chunkSize = 200) {
  const valid = (Array.isArray(rows) ? rows : []).map(mapper).filter(Boolean);
  for (let i = 0; i < valid.length; i += chunkSize) {
    out.push(
      "INSERT " + mode + " INTO " + table + " (" + columns.join(", ") + ") VALUES\n" +
      valid.slice(i, i + chunkSize).map((values) => "(" + values + ")").join(",\n") + ";"
    );
  }
  return valid.length;
}

function loadDevicesFromRepo() {
  const file = path.resolve(__dirname, "../public/assets/data/devices.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (parsed?.format !== "napl-device-catalog-shards-v1" || !Array.isArray(parsed.chunks)) return [];
  const dir = path.join(path.dirname(file), "device-catalog");
  const records = [];
  for (const chunk of parsed.chunks) {
    const name = String(chunk?.file || "");
    if (!/^devices-part-\d{3}\.json$/.test(name)) continue;
    const shard = path.join(dir, name);
    if (!fs.existsSync(shard)) continue;
    const rows = JSON.parse(fs.readFileSync(shard, "utf8"));
    if (Array.isArray(rows)) records.push(...rows);
  }
  return records;
}

fs.mkdirSync(outDir, { recursive: true });

// Devices are imported first because compatibility reports enrich their device fields.
const deviceRows = Array.isArray(t.devices) && t.devices.length ? t.devices : loadDevicesFromRepo();
const deviceMap = new Map();
for (const device of deviceRows) {
  if (device?.id && device?.name) deviceMap.set(device.id, device);
}
const deviceSql = [];
const deviceCount = pushBatches(
  deviceSql,
  "devices",
  ["id", "name", "manufacturer", "model", "soc", "device_type"],
  deviceRows,
  (d) => d?.id && d?.name
    ? [sqlStr(d.id), sqlStr(d.name), sqlStr(d.manufacturer || ""), sqlStr(d.model || d.name), sqlStr(d.soc || ""), sqlStr(d.device_type || d.deviceType || "phone")].join(", ")
    : null,
  "OR REPLACE",
  200
);
fs.writeFileSync(path.join(outDir, "01-devices.sql"), deviceSql.join("\n\n") + "\n", "utf8");

const sql = [];
const counts = {};
counts.rating_tokens = pushBatches(sql, "rating_tokens",
  ["token_hash", "ip_hash", "created_at"], t.rating_tokens,
  (r) => r?.token_hash ? [sqlStr(r.token_hash), sqlStr(r.ip_hash || ""), sqlDate(r.created_at)].join(", ") : null,
  "OR IGNORE");

counts.rating_token_issues = pushBatches(sql, "rating_token_issues",
  ["id", "ip_hash", "created_at"], t.rating_token_issues,
  (r) => r?.ip_hash ? [sqlNum(r.id), sqlStr(r.ip_hash), sqlDate(r.created_at)].join(", ") : null);

const ratingAgg = new Map();
let totalVotes = 0;
let totalStars = 0;
counts.rating_votes = pushBatches(sql, "rating_votes",
  ["port_id", "token_hash", "stars", "created_at", "updated_at"], t.rating_votes,
  (r) => {
    const stars = Number(r?.stars || 0);
    if (!r?.port_id || !r?.token_hash || !Number.isInteger(stars) || stars < 1 || stars > 5) return null;
    totalVotes++;
    totalStars += stars;
    const agg = ratingAgg.get(r.port_id) || { votes: 0, sum: 0 };
    agg.votes++;
    agg.sum += stars;
    ratingAgg.set(r.port_id, agg);
    return [sqlStr(r.port_id), sqlStr(r.token_hash), String(stars), sqlDate(r.created_at), sqlDate(r.updated_at || r.created_at)].join(", ");
  });

const ratingStats = Array.from(ratingAgg, ([portId, agg]) => ({ portId, ...agg }));
pushBatches(sql, "rating_port_stats",
  ["port_id", "votes", "sum_stars", "updated_at"], ratingStats,
  (r) => [sqlStr(r.portId), String(r.votes), String(r.sum), sqlStr(nowIso)].join(", "));
sql.push("INSERT OR REPLACE INTO rating_global_meta (id, total_votes, total_sum, updated_at) VALUES (1, " + totalVotes + ", " + totalStars + ", " + sqlStr(nowIso) + ");");

counts.game_popularity = pushBatches(sql, "game_popularity",
  ["game_key", "all_time_visits", "week_visits", "month_visits", "week_start", "month_start", "updated_at"], t.game_popularity,
  (r) => {
    const key = String(r?.game_key || "").trim().toLowerCase();
    if (!key) return null;
    return [sqlStr(key), sqlNum(r.all_time_visits), sqlNum(r.week_visits), sqlNum(r.month_visits), sqlStr(r.week_start || nowIso.slice(0, 10)), sqlStr(r.month_start || nowIso.slice(0, 7) + "-01"), sqlDate(r.updated_at)].join(", ");
  });

counts.game_popularity_visit_limits = pushBatches(sql, "game_popularity_visit_limits",
  ["ip_hash", "game_key", "last_visit_at"], t.game_popularity_visit_limits,
  (r) => r?.ip_hash && r?.game_key
    ? [sqlStr(r.ip_hash), sqlStr(String(r.game_key).toLowerCase()), sqlDate(r.last_visit_at)].join(", ")
    : null,
  "OR REPLACE",
  200
);

const COMPAT_STATUSES = new Set(["crash", "low_fps", "playable_30", "playable_60"]);
const compatAgg = new Map();
counts.compatibility_reports = pushBatches(sql, "compatibility_reports",
  ["id", "port_id", "token_hash", "device_id", "device_name", "device_soc", "device_type", "works", "updated_at", "status"], t.compatibility_reports,
  (r) => {
    if (!r?.port_id || !r?.token_hash || !r?.device_id) return null;
    const status = COMPAT_STATUSES.has(r.status) ? r.status : (r.works ? "playable_30" : "crash");
    const works = status === "playable_30" || status === "playable_60" ? 1 : 0;
    const device = deviceMap.get(r.device_id);
    const name = device?.model || r.device_name || r.device_id;
    const soc = device?.soc || "";
    const type = device?.device_type || device?.deviceType || "phone";
    const agg = compatAgg.get(r.port_id) || { yes: 0, no: 0, p60: 0, p30: 0, low: 0, crash: 0 };
    if (works) agg.yes++; else agg.no++;
    if (status === "playable_60") agg.p60++;
    else if (status === "playable_30") agg.p30++;
    else if (status === "low_fps") agg.low++;
    else agg.crash++;
    compatAgg.set(r.port_id, agg);
    return [sqlNum(r.id), sqlStr(r.port_id), sqlStr(r.token_hash), sqlStr(r.device_id), sqlStr(name), sqlStr(soc), sqlStr(type), String(works), sqlDate(r.updated_at), sqlStr(status)].join(", ");
  });

const compatStats = Array.from(compatAgg, ([portId, agg]) => ({ portId, ...agg }));
pushBatches(sql, "compat_port_stats",
  ["port_id", "yes_count", "no_count", "p60", "p30", "low_fps", "crash", "updated_at"], compatStats,
  (r) => [sqlStr(r.portId), String(r.yes), String(r.no), String(r.p60), String(r.p30), String(r.low), String(r.crash), sqlStr(nowIso)].join(", "));

counts.link_reports = pushBatches(sql, "link_reports",
  ["id", "port_id", "reporter_hash", "reason", "note", "url", "created_at", "updated_at", "discord_notified_at"], t.link_reports,
  (r) => r?.port_id && r?.reporter_hash
    ? [sqlNum(r.id), sqlStr(r.port_id), sqlStr(r.reporter_hash), sqlStr(r.reason || "Custom note"), sqlStr(r.note || ""), sqlStr(r.url || ""), sqlDate(r.created_at), sqlDate(r.updated_at || r.created_at), sqlDate(nowIso)].join(", ")
    : null);

counts.link_report_rate_limits = pushBatches(sql, "link_report_rate_limits",
  ["reporter_hash", "last_report_at"], t.link_report_rate_limits,
  (r) => r?.reporter_hash ? [sqlStr(r.reporter_hash), sqlDate(r.last_report_at)].join(", ") : null);

fs.writeFileSync(path.join(outDir, "02-community.sql"), sql.join("\n\n") + "\n", "utf8");
console.log("Generated D1 import SQL: " + deviceCount + " devices; " + JSON.stringify(counts));
