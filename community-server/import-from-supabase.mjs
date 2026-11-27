import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dumpArg = process.argv[2] || "napl-supabase-export.json";
const dumpPath = path.resolve(process.cwd(), dumpArg);
if (!fs.existsSync(dumpPath)) {
  throw new Error(`Export file not found: ${dumpPath}`);
}

const sqliteArg = process.argv[3];
const SQLITE_PATH = sqliteArg
  ? path.resolve(process.cwd(), sqliteArg)
  : path.resolve(
      __dirname,
      process.env.SQLITE_PATH || "./data/napl-community.sqlite"
    );
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

function toIso(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function toDateOnly(value, fallback = new Date().toISOString().slice(0, 10)) {
  if (!value) return fallback;
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const ms = Date.parse(str);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : fallback;
}

const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
if (!dump || !dump.tables || typeof dump.tables !== "object") {
  throw new Error("Invalid napl-supabase-export.json structure.");
}

fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
const db = new DatabaseSync(SQLITE_PATH);
db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));

const t = dump.tables;

db.exec("BEGIN IMMEDIATE");
try {
  const insDevice = db.prepare(
    `INSERT INTO devices (id, name, manufacturer, model, soc, device_type)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       manufacturer = excluded.manufacturer,
       model = excluded.model,
       soc = excluded.soc,
       device_type = excluded.device_type`
  );
  for (const r of t.devices || []) {
    insDevice.run(
      r.id,
      r.name,
      r.manufacturer || "",
      r.model || "",
      r.soc || "",
      r.device_type || "phone"
    );
  }

  const insToken = db.prepare(
    `INSERT OR IGNORE INTO rating_tokens (token_hash, ip_hash, created_at)
     VALUES (?, ?, ?)`
  );
  for (const r of t.rating_tokens || []) {
    insToken.run(r.token_hash, r.ip_hash, toIso(r.created_at));
  }

  const insIssue = db.prepare(
    `INSERT INTO rating_token_issues (ip_hash, created_at) VALUES (?, ?)`
  );
  for (const r of t.rating_token_issues || []) {
    insIssue.run(r.ip_hash, toIso(r.created_at));
  }

  const insVote = db.prepare(
    `INSERT INTO rating_votes (port_id, token_hash, stars, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(port_id, token_hash) DO UPDATE SET
       stars = excluded.stars,
       updated_at = excluded.updated_at`
  );
  for (const r of t.rating_votes || []) {
    insVote.run(
      r.port_id,
      r.token_hash,
      Number(r.stars),
      toIso(r.created_at),
      toIso(r.updated_at || r.created_at)
    );
  }

  const insPop = db.prepare(
    `INSERT INTO game_popularity (
       game_key, all_time_visits, week_visits, month_visits, week_start, month_start, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_key) DO UPDATE SET
       all_time_visits = excluded.all_time_visits,
       week_visits = excluded.week_visits,
       month_visits = excluded.month_visits,
       week_start = excluded.week_start,
       month_start = excluded.month_start,
       updated_at = excluded.updated_at`
  );
  for (const r of t.game_popularity || []) {
    insPop.run(
      r.game_key,
      Number(r.all_time_visits || 0),
      Number(r.week_visits || 0),
      Number(r.month_visits || 0),
      toDateOnly(r.week_start),
      toDateOnly(r.month_start),
      toIso(r.updated_at)
    );
  }

  const insPopLimit = db.prepare(
    `INSERT INTO game_popularity_visit_limits (ip_hash, game_key, last_visit_at)
     VALUES (?, ?, ?)
     ON CONFLICT(ip_hash, game_key) DO UPDATE SET last_visit_at = excluded.last_visit_at`
  );
  for (const r of t.game_popularity_visit_limits || []) {
    insPopLimit.run(r.ip_hash, r.game_key, toIso(r.last_visit_at));
  }

  const insCompat = db.prepare(
    `INSERT INTO compatibility_reports (port_id, token_hash, device_id, device_name, works, updated_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(port_id, token_hash, device_id) DO UPDATE SET
       device_name = excluded.device_name,
       works = excluded.works,
       updated_at = excluded.updated_at,
       status = excluded.status`
  );
  for (const r of t.compatibility_reports || []) {
    insCompat.run(
      r.port_id,
      r.token_hash,
      r.device_id,
      r.device_name,
      r.works ? 1 : 0,
      toIso(r.updated_at),
      r.status || (r.works ? "playable_30" : "crash")
    );
  }

  const insLink = db.prepare(
    `INSERT INTO link_reports (port_id, reporter_hash, reason, url, created_at, updated_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(port_id, reporter_hash) DO UPDATE SET
       reason = excluded.reason,
       url = excluded.url,
       updated_at = excluded.updated_at,
       note = excluded.note`
  );
  for (const r of t.link_reports || []) {
    insLink.run(
      r.port_id,
      r.reporter_hash,
      r.reason,
      r.url || "",
      toIso(r.created_at),
      toIso(r.updated_at || r.created_at),
      r.note || ""
    );
  }

  const insLinkRate = db.prepare(
    `INSERT INTO link_report_rate_limits (reporter_hash, last_report_at)
     VALUES (?, ?)
     ON CONFLICT(reporter_hash) DO UPDATE SET last_report_at = excluded.last_report_at`
  );
  for (const r of t.link_report_rate_limits || []) {
    insLinkRate.run(r.reporter_hash, toIso(r.last_report_at));
  }

  db.exec("COMMIT");
  console.log("Successfully imported Supabase dump into SQLite:", SQLITE_PATH);
} catch (err) {
  try {
    db.exec("ROLLBACK");
  } catch {}
  throw err;
} finally {
  db.close();
}
