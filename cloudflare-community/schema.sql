-- NAPL Community-Only Schema for Cloudflare D1 (SQLite)
-- Ultra-optimized with pre-aggregated summary tables and strict indexes (<= 250 row reads/visit).

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  soc TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT 'phone'
);

CREATE TABLE IF NOT EXISTS rating_tokens (
  token_hash TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rating_token_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_issues_ip ON rating_token_issues(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS rating_votes (
  port_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (port_id, token_hash)
);
CREATE INDEX IF NOT EXISTS idx_rating_votes_token ON rating_votes(token_hash);

CREATE TABLE IF NOT EXISTS rating_port_stats (
  port_id TEXT PRIMARY KEY,
  votes INTEGER NOT NULL DEFAULT 0,
  sum_stars INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rating_port_stats_votes ON rating_port_stats(votes DESC, port_id ASC);

CREATE TABLE IF NOT EXISTS rating_global_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_votes INTEGER NOT NULL DEFAULT 0,
  total_sum INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO rating_global_meta (id, total_votes, total_sum, updated_at)
VALUES (1, 0, 0, '1970-01-01T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS game_popularity (
  game_key TEXT PRIMARY KEY,
  all_time_visits INTEGER NOT NULL DEFAULT 0,
  week_visits INTEGER NOT NULL DEFAULT 0,
  month_visits INTEGER NOT NULL DEFAULT 0,
  week_start TEXT NOT NULL,
  month_start TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pop_alltime ON game_popularity(all_time_visits DESC, game_key ASC);
CREATE INDEX IF NOT EXISTS idx_pop_week ON game_popularity(week_start, week_visits DESC, game_key ASC);
CREATE INDEX IF NOT EXISTS idx_pop_month ON game_popularity(month_start, month_visits DESC, game_key ASC);

CREATE TABLE IF NOT EXISTS game_popularity_visit_limits (
  ip_hash TEXT NOT NULL,
  game_key TEXT NOT NULL,
  last_visit_at TEXT NOT NULL,
  PRIMARY KEY (ip_hash, game_key)
);

CREATE TABLE IF NOT EXISTS compatibility_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  port_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  device_soc TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT 'phone',
  works INTEGER NOT NULL CHECK (works IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('crash', 'low_fps', 'playable_30', 'playable_60')),
  updated_at TEXT NOT NULL,
  UNIQUE (port_id, token_hash, device_id)
);
CREATE INDEX IF NOT EXISTS idx_compat_port ON compatibility_reports(port_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_compat_device ON compatibility_reports(device_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_compat_device_name ON compatibility_reports(device_name COLLATE NOCASE, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_compat_soc ON compatibility_reports(device_soc COLLATE NOCASE, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS compat_port_stats (
  port_id TEXT PRIMARY KEY,
  yes_count INTEGER NOT NULL DEFAULT 0,
  no_count INTEGER NOT NULL DEFAULT 0,
  p60 INTEGER NOT NULL DEFAULT 0,
  p30 INTEGER NOT NULL DEFAULT 0,
  low_fps INTEGER NOT NULL DEFAULT 0,
  crash INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS link_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  port_id TEXT NOT NULL,
  reporter_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  discord_notified_at TEXT,
  UNIQUE (port_id, reporter_hash)
);
CREATE INDEX IF NOT EXISTS idx_link_reports_pending ON link_reports(discord_notified_at, id);
CREATE INDEX IF NOT EXISTS idx_link_reports_updated ON link_reports(updated_at DESC);

CREATE TABLE IF NOT EXISTS link_report_rate_limits (
  reporter_hash TEXT PRIMARY KEY,
  last_report_at TEXT NOT NULL
);
