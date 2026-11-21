-- NAPL (Native Android Port List) — Cloudflare D1 Relational Schema

CREATE TABLE IF NOT EXISTS games (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  launchbox_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ports (
  port_id TEXT PRIMARY KEY,
  game_slug TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  developer TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  controller TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '',
  works TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  data_url TEXT NOT NULL DEFAULT '',
  github_repo TEXT NOT NULL DEFAULT '',
  github_status TEXT NOT NULL DEFAULT '',
  github_etag TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT NOT NULL DEFAULT '',
  last_update TEXT NOT NULL DEFAULT '',
  date_added TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  slug TEXT NOT NULL DEFAULT '',
  launchbox_url TEXT NOT NULL DEFAULT '',
  launchbox_name TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (game_slug) REFERENCES games(slug) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS platform_order (
  position INTEGER NOT NULL,
  platform TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  checked_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  down_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_sort ON games(sort_order, name);
CREATE INDEX IF NOT EXISTS idx_ports_game ON ports(game_slug, sort_order);
CREATE INDEX IF NOT EXISTS idx_ports_github ON ports(github_repo, last_checked_at);
