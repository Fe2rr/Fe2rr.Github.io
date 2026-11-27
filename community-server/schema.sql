PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  soc TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT 'phone'
);

CREATE TABLE IF NOT EXISTS rating_tokens (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  ip_hash TEXT NOT NULL CHECK (length(ip_hash) = 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS rating_token_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL CHECK (length(ip_hash) = 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS rating_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  port_id TEXT NOT NULL CHECK (length(port_id) BETWEEN 1 AND 120),
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (port_id, token_hash)
);

CREATE TABLE IF NOT EXISTS game_popularity (
  game_key TEXT PRIMARY KEY,
  all_time_visits INTEGER NOT NULL DEFAULT 0 CHECK (all_time_visits >= 0),
  week_visits INTEGER NOT NULL DEFAULT 0 CHECK (week_visits >= 0),
  month_visits INTEGER NOT NULL DEFAULT 0 CHECK (month_visits >= 0),
  week_start TEXT NOT NULL,
  month_start TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS game_popularity_visit_limits (
  ip_hash TEXT NOT NULL,
  game_key TEXT NOT NULL,
  last_visit_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (ip_hash, game_key)
);

CREATE TABLE IF NOT EXISTS compatibility_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  port_id TEXT NOT NULL CHECK (length(port_id) BETWEEN 1 AND 120),
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  device_id TEXT NOT NULL REFERENCES devices(id),
  device_name TEXT NOT NULL CHECK (length(device_name) BETWEEN 1 AND 240),
  works INTEGER NOT NULL CHECK (works IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'crash' CHECK (status IN ('crash', 'low_fps', 'playable_30', 'playable_60')),
  UNIQUE (port_id, token_hash, device_id)
);

CREATE TABLE IF NOT EXISTS link_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  port_id TEXT NOT NULL CHECK (length(port_id) BETWEEN 1 AND 120),
  reporter_hash TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 120),
  url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (port_id, reporter_hash)
);

CREATE TABLE IF NOT EXISTS link_report_rate_limits (
  reporter_hash TEXT PRIMARY KEY,
  last_report_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS rating_votes_port_idx ON rating_votes(port_id);
CREATE INDEX IF NOT EXISTS rating_votes_token_time_idx ON rating_votes(token_hash, created_at);
CREATE INDEX IF NOT EXISTS compatibility_port_time_idx ON compatibility_reports(port_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS compatibility_device_idx ON compatibility_reports(device_id);
CREATE INDEX IF NOT EXISTS devices_soc_idx ON devices(lower(soc));
CREATE INDEX IF NOT EXISTS link_reports_port_idx ON link_reports(port_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS popularity_rank_week_idx ON game_popularity(week_visits DESC);
CREATE INDEX IF NOT EXISTS popularity_rank_month_idx ON game_popularity(month_visits DESC);
CREATE INDEX IF NOT EXISTS popularity_rank_all_idx ON game_popularity(all_time_visits DESC);
