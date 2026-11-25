import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  parseGithubRepo,
  normalizeGithubSlug,
  parseGitlabProject,
  normalizeGitlabPath,
  parsePlayStorePackage,
  normalizePlayStoreId,
  resolvePortSyncTarget,
} from '../public/js/lib/source-parsers.js';

export {
  parseGithubRepo,
  normalizeGithubSlug,
  parseGitlabProject,
  normalizeGitlabPath,
  parsePlayStorePackage,
  normalizePlayStoreId,
  resolvePortSyncTarget,
};

const DATA_REPO = 'Fe2rr/NAPL-Data';
const DATA_BRANCH = 'main';
const DATA_CATALOG_PATH = 'public/assets/data/catalog.json';
const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv';
const SESSION_TTL = 8 * 60 * 60 * 1000;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function normHead(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function norm(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function slugify(v) {
  return norm(v).replace(/\s+/g, '-');
}

function formatNaplDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function csvParse(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (q && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (c === ',' && !q) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !q) {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((v) => v.trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map(normHead);
  return rows.map((values) => {
    const o = {};
    headers.forEach((h, i) => {
      if (h) o[h] = String(values[i] || '').trim();
    });
    return o;
  });
}

function col(row, names) {
  for (const n of names) {
    const k = normHead(n);
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      return String(row[k] || '').trim();
    }
  }
  return '';
}

function fromRows(rows) {
  let currentGame = '';
  let currentYear = '';
  let currentPlatform = '';
  const platforms = new Map();
  const groups = new Map();
  for (const row of rows) {
    const gv = col(row, ['GAME', 'GAME NAME', 'NAME', 'JUEGO']);
    const yv = col(row, ['YEAR', 'ANO', 'AÑO']);
    const platformValue = col(row, ['PLATFORM', 'PLATAFORM', 'PLATAFORMA']);
    if (gv) currentGame = gv;
    if (yv) currentYear = yv;
    if (platformValue) currentPlatform = platformValue;
    if (!currentGame) continue;
    const platform = currentPlatform;
    if (platform && norm(platform) !== 'multi game apps' && !platforms.has(norm(platform))) {
      platforms.set(norm(platform), platform);
    }
    const key = `${norm(currentGame)}|${norm(platform)}`;
    const sourcePopularityKey = col(row, ['POPULARITY_KEY', 'POPULARITY KEY', 'POPULARITY ID', 'POPULARITY_ID']);
    if (!groups.has(key)) {
      groups.set(key, {
        name: currentGame,
        platform,
        year: currentYear || '',
        popularityKey: sourcePopularityKey,
        coverUrl: '',
        genre: '',
        description: '',
        launchboxUrl: '',
        ports: [],
      });
    }
    const g = groups.get(key);
    if (!g.year && currentYear) g.year = currentYear;
    if (!g.popularityKey && sourcePopularityKey) g.popularityKey = sourcePopularityKey;
    const lb = col(row, ['LAUNCHBOX_URL', 'LAUNCHBOX URL']);
    if (!g.launchboxUrl && lb) g.launchboxUrl = lb;
    for (const [field, names] of [
      ['coverUrl', ['COVER_URL', 'COVER URL', 'COVER', 'COVER IMAGE', 'IMAGE URL', 'PORTADA']],
      ['genre', ['GENRE', 'GÉNERO', 'GENERO']],
      ['description', ['DESCRIPTION', 'DESCRIPCIÓN', 'DESCRIPCION']],
    ]) {
      const v = col(row, names);
      if (!g[field] && v) g[field] = v;
    }
    const url = col(row, ['URL', 'PORT URL', 'PORT LINK']);
    const link = col(row, ['LINK', 'PROJECT LINK', 'ENLACE']);
    const syncInfo = resolvePortSyncTarget({ url, link });
    const p = {
      portId: col(row, ['PORTS_ID', 'PORT ID', 'PORT_ID']),
      project: col(row, ['PROJECT', 'PROYECTO']),
      developer: col(row, ['DEVELOPER', 'DEVELOPER/PUBLISHER', 'DESARROLLADOR']),
      year: currentYear,
      version: col(row, ['VERSION', 'VERSIÓN']),
      controller: col(row, ['CONTROLLER SUPPORT', 'CONTROLLER', 'GAMEPAD', 'MANDO']),
      files: col(row, ['NEEDS GAME FILES?', 'NEEDS GAME FILES', 'GAME FILES', 'NECESITA ARCHIVOS']),
      works: col(row, ['WORKS?', 'WORKS', 'FUNCIONA']),
      link,
      url,
      dataUrl: col(row, ['DATA URL', 'DATA LINK', 'GAME FILES URL']),
      githubRepo: syncInfo.githubRepo,
      syncProvider: syncInfo.provider,
      syncTarget: syncInfo.target,
      lastUpdate: col(row, ['LAST UPDATE', 'LAST UPDATED', 'ÚLTIMA ACTUALIZACIÓN']),
      dateAdded: col(row, ['DATE ADDED']),
      notes: col(row, ['NOTES', 'NOTE', 'NOTAS']),
    };
    if (/^unofficial-port(?:-\d+)?$/i.test(p.portId)) {
      p.portId = `${slugify(currentGame)}-${p.portId.toLowerCase()}`;
    }
    if (Object.entries(p).some(([k, v]) => k !== 'year' && String(v || '').trim())) {
      g.ports.push(p);
    }
  }
  const seen = new Set();
  const games = Array.from(groups.values()).map((g) => {
    const base = `${slugify(g.name)}-${slugify(g.platform) || 'sin-plataforma'}`;
    let n = 1;
    let slug = `${base}-${n}`;
    while (seen.has(slug)) slug = `${base}-${++n}`;
    seen.add(slug);
    return { ...g, slug, popularityKey: String(g.popularityKey || '').trim() };
  });
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    platformOrder: Array.from(platforms.values()),
    games,
  };
}

function validateCatalog(input) {
  if (!input || !Array.isArray(input.games) || !Array.isArray(input.platformOrder)) {
    throw new Error('Formato JSON inválido.');
  }
  const slugs = new Set();
  const ids = new Set();
  const games = input.games.map((g) => {
    if (!g || typeof g.name !== 'string' || !g.name.trim()) {
      throw new Error('Cada juego necesita nombre.');
    }
    const platform = String(g.platform || g.platforms?.[0] || '').trim();
    const base = `${slugify(g.name)}-${slugify(platform) || 'sin-plataforma'}`;
    let slug = String(g.slug || '').trim();
    if (!slug || !slug.startsWith(`${base}-`)) {
      let n = 1;
      slug = `${base}-${n}`;
      while (slugs.has(slug)) slug = `${base}-${++n}`;
    }
    if (slugs.has(slug)) {
      throw new Error(`Slug duplicado: ${slug}`);
    }
    slugs.add(slug);
    if (!Array.isArray(g.ports)) {
      throw new Error(`Ports inválidos en ${g.name}`);
    }
    const ports = g.ports.map((p, i) => {
      const o = {};
      for (const k of [
        'portId',
        'project',
        'developer',
        'year',
        'version',
        'controller',
        'files',
        'works',
        'link',
        'url',
        'dataUrl',
        'githubRepo',
        'githubStatus',
        'syncProvider',
        'syncTarget',
        'lastCheckedAt',
        'lastUpdate',
        'dateAdded',
        'notes',
      ]) {
        o[k] = String(p?.[k] ?? '');
      }
      if (!o.portId) o.portId = `${slug}-port-${i + 1}`;
      if (ids.has(o.portId)) {
        throw new Error(`ID de port duplicado: ${o.portId}`);
      }
      ids.add(o.portId);
      const syncInfo = resolvePortSyncTarget(o);
      o.githubRepo = syncInfo.githubRepo;
      o.syncProvider = syncInfo.provider;
      o.syncTarget = syncInfo.target;
      return o;
    });
    const popularityKey = String(g.popularityKey || slugify(g.name)).trim().toLowerCase();
    return {
      name: g.name.trim(),
      platform,
      slug,
      popularityKey,
      year: String(g.year || ''),
      coverUrl: String(g.coverUrl || ''),
      genre: String(g.genre || ''),
      description: String(g.description || ''),
      launchboxUrl: String(g.launchboxUrl || ''),
      ports,
    };
  });

  return {
    version: 1,
    updatedAt: String(input.updatedAt || new Date().toISOString()),
    platformOrder: [...new Set(input.platformOrder.map((x) => String(x).trim()).filter(Boolean))],
    games,
  };
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function resolveLaunchboxImageUrl(fileName) {
  const clean = String(fileName || '').trim().replace(/^\/+/, '');
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  if (clean.startsWith('r2_')) {
    return `https://gamesdb-images.launchbox.gg/${clean}`;
  }
  return `https://images.launchbox-app.com//${clean}`;
}

export function createLocalD1Store({ rootDir, catalogJsonPath, schemaSqlPath }) {
  const localDir = path.join(rootDir, '.local');
  fs.mkdirSync(localDir, { recursive: true });
  const dbPath = path.join(localDir, 'napl.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');

  const schemaSql = fs
    .readFileSync(schemaSqlPath, 'utf8')
    .replace(/CREATE INDEX IF NOT EXISTS idx_ports_sync[^;]*;\s*/i, '');
  db.exec('DROP INDEX IF EXISTS idx_ports_slug;');
  db.exec(schemaSql);

  // Safe migrations for existing local SQLite databases
  try {
    db.exec("ALTER TABLE games ADD COLUMN platform TEXT NOT NULL DEFAULT '';");
  } catch (error) {
    if (!/duplicate column/i.test(String(error?.message || error))) throw error;
  }
  for (const [column, type] of [
    ['slug', "TEXT NOT NULL DEFAULT ''"],
    ['launchbox_url', "TEXT NOT NULL DEFAULT ''"],
    ['launchbox_name', "TEXT NOT NULL DEFAULT ''"],
    ['cover_url', "TEXT NOT NULL DEFAULT ''"],
    ['genre', "TEXT NOT NULL DEFAULT ''"],
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['sync_provider', "TEXT NOT NULL DEFAULT ''"],
    ['sync_target', "TEXT NOT NULL DEFAULT ''"],
  ]) {
    try {
      db.exec(`ALTER TABLE ports ADD COLUMN ${column} ${type};`);
    } catch (error) {
      if (!/duplicate column/i.test(String(error?.message || error))) throw error;
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_ports_sync ON ports(sync_provider, sync_target, last_checked_at);');

  const sessionSecret =
    process.env.SESSION_SECRET || crypto.createHash('sha256').update(dbPath).digest('hex');

  function hasCustomPassword() {
    return Boolean(process.env.ADMIN_PASSWORD);
  }

  function verifyPassword(password) {
    const expected = process.env.ADMIN_PASSWORD || 'admin';
    return String(password || '') === expected;
  }

  function createToken() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL })).toString('base64url');
    const sig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  function verifyToken(authHeader) {
    const token = String(authHeader || '').startsWith('Bearer ') ? String(authHeader).slice(7) : '';
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const expectedSig = crypto.createHmac('sha256', sessionSecret).update(parts[0]).digest('base64url');
    if (parts[1] !== expectedSig) return false;
    try {
      const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      return data.exp > Date.now();
    } catch {
      return false;
    }
  }

  function replaceWholeCatalog(rawCatalog, options = {}) {
    const catalog = validateCatalog(rawCatalog);
    const now = options.updatedAt || new Date().toISOString();
    catalog.updatedAt = now;
    const pendingGithubSync = options.pendingGithubSync ? '1' : '0';

    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM ports; DELETE FROM games; DELETE FROM platform_order;');
      const insPlat = db.prepare('INSERT OR REPLACE INTO platform_order (position, platform) VALUES (?, ?)');
      catalog.platformOrder.forEach((platform, idx) => insPlat.run(idx, platform));

      const insGame = db.prepare(
        `INSERT INTO games (slug, name, platform, year, cover_url, genre, description, launchbox_url, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insPort = db.prepare(
        `INSERT INTO ports (
          port_id, game_slug, project, developer, year, version,
          controller, files, works, link, url, data_url,
          github_repo, github_status, github_etag, sync_provider, sync_target, last_checked_at,
          last_update, date_added, notes, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
      );

      catalog.games.forEach((g, gIdx) => {
        insGame.run(
          g.slug,
          g.name,
          g.platform || '',
          g.year || '',
          g.coverUrl || '',
          g.genre || '',
          g.description || '',
          g.launchboxUrl || '',
          gIdx,
          now
        );
        g.ports.forEach((p, pIdx) => {
          const syncInfo = resolvePortSyncTarget(p);
          insPort.run(
            p.portId,
            g.slug,
            p.project || '',
            p.developer || '',
            p.year || g.year || '',
            p.version || '',
            p.controller || '',
            p.files || '',
            p.works || '',
            p.link || '',
            p.url || '',
            p.dataUrl || '',
            syncInfo.githubRepo,
            p.githubStatus || (syncInfo.provider ? 'unknown' : ''),
            syncInfo.provider,
            syncInfo.target,
            p.lastCheckedAt || '',
            p.lastUpdate || '',
            p.dateAdded || '',
            p.notes || '',
            pIdx
          );
        });
      });

      const setMeta = db.prepare('INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)');
      setMeta.run('updated_at', now, now);
      setMeta.run('pending_github_sync', pendingGithubSync, now);
      if (options.publishedAt) {
        setMeta.run('last_github_publish_at', options.publishedAt, now);
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return catalog;
  }

  function ensureSeeded() {
    const row = db.prepare('SELECT COUNT(*) AS count FROM games').get();
    const withPlatform = db.prepare("SELECT COUNT(*) AS count FROM games WHERE platform != ''").get();
    if (row && Number(row.count) > 0 && withPlatform && Number(withPlatform.count) > 0) {
      return false;
    }
    if (!fs.existsSync(catalogJsonPath)) return false;
    const raw = JSON.parse(fs.readFileSync(catalogJsonPath, 'utf8'));
    if (!raw || !Array.isArray(raw.games) || !raw.games.length) return false;
    replaceWholeCatalog(raw, {
      updatedAt: String(raw.updatedAt || new Date().toISOString()),
      pendingGithubSync: false,
      publishedAt: String(raw.updatedAt || new Date().toISOString()),
    });
    return true;
  }

  function readMetaMap() {
    const rows = db.prepare('SELECT key, value FROM catalog_meta').all();
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  }

  function readCatalog(options = {}) {
    ensureSeeded();
    const { includeInternal = false } = options;
    const platformsRows = db.prepare('SELECT platform FROM platform_order ORDER BY position ASC').all();
    const gamesRows = db.prepare('SELECT * FROM games ORDER BY sort_order ASC, name ASC').all();
    const portsRows = db.prepare('SELECT * FROM ports ORDER BY sort_order ASC').all();
    const meta = readMetaMap();

    const portsByGame = new Map();
    let githubCount = 0;
    let gitlabCount = 0;
    let playstoreCount = 0;
    let downCount = 0;

    for (const r of portsRows) {
      const syncInfo = resolvePortSyncTarget(r);
      if (syncInfo.provider === 'github') githubCount += 1;
      else if (syncInfo.provider === 'gitlab') gitlabCount += 1;
      else if (syncInfo.provider === 'playstore') playstoreCount += 1;
      if (r.github_status === 'down') downCount += 1;

      const port = {
        portId: r.port_id,
        project: r.project,
        developer: r.developer,
        year: r.year,
        version: r.version,
        controller: r.controller,
        files: r.files,
        works: r.works,
        link: r.link,
        url: r.url,
        dataUrl: r.data_url,
        lastUpdate: r.last_update,
        dateAdded: r.date_added,
        notes: r.notes,
      };
      if (includeInternal) {
        port.githubRepo = syncInfo.githubRepo || '';
        port.syncProvider = syncInfo.provider || '';
        port.syncTarget = syncInfo.target || '';
        port.githubStatus = r.github_status || '';
        port.lastCheckedAt = r.last_checked_at || '';
      } else if (syncInfo.githubRepo) {
        port.githubRepo = syncInfo.githubRepo;
      }

      if (!portsByGame.has(r.game_slug)) portsByGame.set(r.game_slug, []);
      portsByGame.get(r.game_slug).push(port);
    }

    const games = gamesRows.map((g) => {
      const ports = portsByGame.get(g.slug) || [];
      const entry = {
        name: g.name,
        slug: g.slug,
        year: g.year || '',
        coverUrl: g.cover_url || '',
        genre: g.genre || '',
        description: g.description || '',
        platform: g.platform || '',
        ports,
      };
      if (includeInternal || g.launchbox_url) {
        entry.launchboxUrl = g.launchbox_url || '';
      }
      return entry;
    });

    const catalog = {
      version: 1,
      updatedAt: meta.updated_at || new Date().toISOString(),
      platformOrder: platformsRows.map((x) => x.platform).filter(Boolean),
      games,
    };

    if (!includeInternal) return { catalog, meta };

    const logs = db
      .prepare(
        'SELECT id, source, checked_count, updated_count, down_count, error_count, summary_json, created_at FROM sync_logs ORDER BY id DESC LIMIT 12'
      )
      .all();

    return {
      catalog,
      meta,
      stats: {
        gamesCount: games.length,
        portsCount: portsRows.length,
        githubCount,
        gitlabCount,
        playstoreCount,
        syncableCount: githubCount + gitlabCount + playstoreCount,
        downCount,
        lastSyncAt: meta.last_sync_at || '',
        lastGitHubPublishAt: meta.last_github_publish_at || '',
        pendingGitHubSync: meta.pending_github_sync === '1',
      },
      syncLogs: logs.map((l) => ({
        id: l.id,
        source: l.source,
        checkedCount: l.checked_count,
        updatedCount: l.updated_count,
        downCount: l.down_count,
        errorCount: l.error_count,
        summary: (() => {
          try {
            return JSON.parse(l.summary_json || '[]');
          } catch {
            return [];
          }
        })(),
        createdAt: l.created_at,
      })),
    };
  }

  function saveSingleGame(targetSlug, rawGame, isCreate = false) {
    ensureSeeded();
    if (!rawGame || typeof rawGame.name !== 'string' || !rawGame.name.trim()) {
      throw new Error('El juego necesita un nombre.');
    }

    const platform = String(rawGame.platform || '').trim();
    const baseSlug = `${slugify(rawGame.name)}-${slugify(platform) || 'sin-plataforma'}`;
    if (!baseSlug || baseSlug === '-') throw new Error('No se pudo generar el slug.');

    let sequence = 1;
    if (!isCreate && targetSlug && targetSlug.startsWith(`${baseSlug}-`)) {
      const existingNumber = Number(targetSlug.slice(baseSlug.length + 1));
      if (Number.isInteger(existingNumber) && existingNumber > 0) sequence = existingNumber;
    }
    let nextSlug = `${baseSlug}-${sequence}`;
    while (
      db
        .prepare('SELECT slug FROM games WHERE slug = ? AND slug != ?')
        .get(nextSlug, targetSlug || '')
    ) {
      sequence += 1;
      nextSlug = `${baseSlug}-${sequence}`;
    }

    const now = new Date().toISOString();

    let sortOrder = 0;
    if (!isCreate && targetSlug) {
      const existing = db.prepare('SELECT sort_order FROM games WHERE slug = ?').get(targetSlug);
      if (!existing) throw new Error(`No existe el juego '${targetSlug}'.`);
      sortOrder = Number(existing.sort_order) || 0;
    } else {
      const minRow = db.prepare('SELECT MIN(sort_order) AS min_order FROM games').get();
      sortOrder = minRow && minRow.min_order != null ? Number(minRow.min_order) - 1 : 0;
    }

    const rawPorts = Array.isArray(rawGame.ports) ? rawGame.ports : [];
    const seenIds = new Set();
    const ports = rawPorts.map((p, idx) => {
      let portId = String(p?.portId || '').trim() || `${nextSlug}-port-${idx + 1}`;
      while (seenIds.has(portId)) portId = `${portId}-${idx + 1}`;
      seenIds.add(portId);
      const url = String(p?.url || '').trim();
      const link = String(p?.link || '').trim();
      const syncInfo = resolvePortSyncTarget(p);

      return {
        portId,
        project: String(p?.project || ''),
        developer: String(p?.developer || ''),
        year: String(p?.year || rawGame.year || ''),
        version: String(p?.version || ''),
        controller: String(p?.controller || ''),
        files: String(p?.files || ''),
        works: String(p?.works || ''),
        link,
        url,
        dataUrl: String(p?.dataUrl || ''),
        githubRepo: syncInfo.githubRepo,
        syncProvider: syncInfo.provider,
        syncTarget: syncInfo.target,
        githubStatus: String(p?.githubStatus || (syncInfo.provider ? 'unknown' : '')),
        lastCheckedAt: String(p?.lastCheckedAt || ''),
        lastUpdate: String(p?.lastUpdate || ''),
        dateAdded: String(p?.dateAdded || now.slice(0, 10)),
        notes: String(p?.notes || ''),
      };
    });

    db.exec('BEGIN');
    try {
      if (!isCreate && targetSlug) {
        db.prepare('DELETE FROM ports WHERE game_slug = ?').run(targetSlug);
        if (nextSlug !== targetSlug) {
          db.prepare('DELETE FROM games WHERE slug = ?').run(targetSlug);
        }
      }

      db.prepare(
        `INSERT OR REPLACE INTO games (slug, name, platform, year, cover_url, genre, description, launchbox_url, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        nextSlug,
        rawGame.name.trim(),
        platform,
        String(rawGame.year || ''),
        String(rawGame.coverUrl || ''),
        String(rawGame.genre || ''),
        String(rawGame.description || ''),
        String(rawGame.launchboxUrl || ''),
        sortOrder,
        now
      );

      const insPort = db.prepare(
        `INSERT OR REPLACE INTO ports (
          port_id, game_slug, project, developer, year, version,
          controller, files, works, link, url, data_url,
          github_repo, github_status, github_etag, sync_provider, sync_target, last_checked_at,
          last_update, date_added, notes, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
      );
      ports.forEach((p, idx) => {
        insPort.run(
          p.portId,
          nextSlug,
          p.project,
          p.developer,
          p.year,
          p.version,
          p.controller,
          p.files,
          p.works,
          p.link,
          p.url,
          p.dataUrl,
          p.githubRepo,
          p.githubStatus,
          p.syncProvider,
          p.syncTarget,
          p.lastCheckedAt,
          p.lastUpdate,
          p.dateAdded,
          p.notes,
          idx
        );
      });

      const platRows = db.prepare('SELECT platform, position FROM platform_order ORDER BY position ASC').all();
      const known = new Set(platRows.map((r) => norm(r.platform)));
      let nextPos = platRows.reduce((m, r) => Math.max(m, Number(r.position) || 0), -1) + 1;
      if (platform && norm(platform) !== 'multi game apps' && !known.has(norm(platform))) {
        known.add(norm(platform));
        db.prepare('INSERT OR IGNORE INTO platform_order (position, platform) VALUES (?, ?)').run(
          nextPos++,
          platform
        );
      }

      const setMeta = db.prepare('INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)');
      setMeta.run('updated_at', now, now);
      setMeta.run('pending_github_sync', '1', now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return { slug: nextSlug, updatedAt: now, portsCount: ports.length };
  }

  function deleteGame(slug) {
    ensureSeeded();
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM ports WHERE game_slug = ?').run(slug);
      db.prepare('DELETE FROM games WHERE slug = ?').run(slug);
      const setMeta = db.prepare('INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)');
      setMeta.run('updated_at', now, now);
      setMeta.run('pending_github_sync', '1', now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { deleted: true, slug, updatedAt: now };
  }

  async function ghFetch(apiPath, options = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NAPL-Catalog-Sync/2.0',
      ...(options.headers || {}),
    };
    const token = options.token || process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com${apiPath}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    return { res, data };
  }

  async function inspectGithubRepo(repoSlug) {
    const parsed = parseGithubRepo(repoSlug);
    if (!parsed) throw new Error('URL de GitHub inválida.');

    const { res: repoRes, data: repoData } = await ghFetch(`/repos/${parsed.owner}/${parsed.repo}`);
    if (repoRes.status === 404 || repoRes.status === 410) {
      return {
        provider: 'github',
        status: 'down',
        syncTarget: `${parsed.owner}/${parsed.repo}`,
        githubRepo: `${parsed.owner}/${parsed.repo}`,
        repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
        error: `Repositorio no disponible (HTTP ${repoRes.status}).`,
      };
    }
    if (!repoRes.ok) {
      throw new Error(repoData.message || `GitHub HTTP ${repoRes.status}`);
    }

    const canonicalRepo = String(repoData.full_name || `${parsed.owner}/${parsed.repo}`);
    const repoUrl = String(repoData.html_url || `https://github.com/${canonicalRepo}`);
    const moved = canonicalRepo.toLowerCase() !== `${parsed.owner}/${parsed.repo}`.toLowerCase();

    let release = null;
    const latest = await ghFetch(`/repos/${canonicalRepo}/releases/latest`);
    if (latest.res.ok && latest.data?.tag_name) {
      release = latest.data;
    } else {
      const list = await ghFetch(`/repos/${canonicalRepo}/releases?per_page=1`);
      if (list.res.ok && Array.isArray(list.data) && list.data.length > 0) {
        release = list.data[0];
      }
    }

    let tagFallback = null;
    if (!release) {
      const tags = await ghFetch(`/repos/${canonicalRepo}/tags?per_page=1`);
      if (tags.res.ok && Array.isArray(tags.data) && tags.data.length > 0) {
        tagFallback = tags.data[0];
      }
    }

    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const apkAsset =
      assets.find((a) => /\.apk$/i.test(String(a.name || '')) && !/debug/i.test(String(a.name || ''))) ||
      assets.find((a) => /\.apk$/i.test(String(a.name || '')));

    const version = String(release?.tag_name || tagFallback?.name || '').trim();
    const updatedIso = release?.published_at || repoData.pushed_at || repoData.updated_at || '';
    const lastUpdate = formatNaplDate(updatedIso);
    const releaseUrl = release?.html_url || repoUrl;
    const apkUrl = apkAsset?.browser_download_url || '';

    return {
      provider: 'github',
      syncTarget: canonicalRepo,
      status: moved ? 'moved' : 'ok',
      moved,
      archived: Boolean(repoData.archived),
      githubRepo: canonicalRepo,
      repoUrl,
      releaseUrl,
      apkUrl,
      recommendedUrl: apkUrl || releaseUrl || repoUrl,
      project: String(repoData.name || parsed.repo),
      developer: String(repoData.owner?.login || parsed.owner),
      version,
      lastUpdate,
      link: repoData.archived ? 'Free (Github - Archived)' : 'Free (Github)',
      description: String(repoData.description || ''),
      checkedAt: new Date().toISOString(),
    };
  }

  async function glFetch(apiPath) {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'NAPL-Catalog-Sync/2.0',
    };
    if (process.env.GITLAB_TOKEN) {
      headers['PRIVATE-TOKEN'] = process.env.GITLAB_TOKEN;
    }
    const res = await fetch(`https://gitlab.com/api/v4${apiPath}`, { headers });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    return { res, data };
  }

  async function inspectGitlabProject(projectInput) {
    const parsed = parseGitlabProject(projectInput);
    if (!parsed) throw new Error('URL de GitLab inválida.');

    const encoded = encodeURIComponent(parsed.projectPath);
    const { res: projRes, data: projData } = await glFetch(`/projects/${encoded}`);
    if (projRes.status === 404 || projRes.status === 410) {
      return {
        provider: 'gitlab',
        status: 'down',
        syncTarget: parsed.projectPath,
        githubRepo: '',
        repoUrl: `https://gitlab.com/${parsed.projectPath}`,
        error: `Repositorio de GitLab no disponible (HTTP ${projRes.status}).`,
        checkedAt: new Date().toISOString(),
      };
    }
    if (!projRes.ok) {
      throw new Error(projData?.message || `GitLab HTTP ${projRes.status}`);
    }

    const canonicalPath = String(projData.path_with_namespace || parsed.projectPath);
    const canonicalEncoded = encodeURIComponent(canonicalPath);
    const repoUrl = String(projData.web_url || `https://gitlab.com/${canonicalPath}`);
    const moved = canonicalPath.toLowerCase() !== parsed.projectPath.toLowerCase();

    let release = null;
    const rels = await glFetch(`/projects/${canonicalEncoded}/releases?per_page=1`);
    if (rels.res.ok && Array.isArray(rels.data) && rels.data.length > 0) {
      release = rels.data[0];
    }

    let tagFallback = null;
    if (!release) {
      const tags = await glFetch(`/projects/${canonicalEncoded}/repository/tags?per_page=1`);
      if (tags.res.ok && Array.isArray(tags.data) && tags.data.length > 0) {
        tagFallback = tags.data[0];
      }
    }

    let commitFallback = null;
    if (!release && !tagFallback) {
      const commits = await glFetch(`/projects/${canonicalEncoded}/repository/commits?per_page=1`);
      if (commits.res.ok && Array.isArray(commits.data) && commits.data.length > 0) {
        commitFallback = commits.data[0];
      }
    }

    const assetLinks = Array.isArray(release?.assets?.links) ? release.assets.links : [];
    const apkAsset =
      assetLinks.find((l) => /\.apk(?:$|[?#])/i.test(String(l?.name || l?.direct_asset_url || l?.url || '')) && !/debug/i.test(String(l?.name || ''))) ||
      assetLinks.find((l) => /\.apk(?:$|[?#])/i.test(String(l?.name || l?.direct_asset_url || l?.url || '')));
    let apkUrl = String(apkAsset?.direct_asset_url || apkAsset?.url || '').trim();
    if (!apkUrl && release?.description) {
      const mdApk = String(release.description).match(/https?:\/\/[^\s)"']+\.apk/i);
      if (mdApk) apkUrl = mdApk[0];
    }

    const version = String(release?.tag_name || tagFallback?.name || '').trim();
    const updatedIso =
      release?.released_at ||
      release?.created_at ||
      tagFallback?.commit?.committed_date ||
      commitFallback?.committed_date ||
      projData.last_activity_at ||
      '';
    const lastUpdate = formatNaplDate(updatedIso);
    const releaseUrl = release?.tag_name
      ? `${repoUrl}/-/releases/${encodeURIComponent(release.tag_name)}`
      : repoUrl;

    return {
      provider: 'gitlab',
      syncTarget: canonicalPath,
      status: moved ? 'moved' : 'ok',
      moved,
      archived: Boolean(projData.archived),
      githubRepo: '',
      repoUrl,
      releaseUrl,
      apkUrl,
      recommendedUrl: apkUrl || releaseUrl || repoUrl,
      project: String(projData.name || parsed.project),
      developer: String(projData.namespace?.name || projData.namespace?.full_path || parsed.namespace),
      version,
      lastUpdate,
      link: projData.archived ? 'Free (Gitlab - Archived)' : 'Free (Gitlab)',
      description: String(projData.description || ''),
      checkedAt: new Date().toISOString(),
    };
  }

  async function inspectPlayStoreApp(appInput) {
    const parsed = parsePlayStorePackage(appInput);
    if (!parsed) throw new Error('URL o ID de Google Play Store inválido.');

    const packageId = parsed.packageId;
    const storeUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}`;
    const fetchUrl = `${storeUrl}&hl=en&gl=US`;
    const res = await fetch(fetchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (res.status === 404 || res.status === 410) {
      return {
        provider: 'playstore',
        status: 'down',
        syncTarget: packageId,
        githubRepo: '',
        repoUrl: storeUrl,
        storeUrl,
        error: `App no disponible en Play Store (HTTP ${res.status}).`,
        checkedAt: new Date().toISOString(),
      };
    }
    if (!res.ok) {
      throw new Error(`Play Store HTTP ${res.status}`);
    }

    const html = await res.text();
    let appInfo = null;
    const cbRegex = /AF_initDataCallback\(\{key:\s*['"](ds:\d+)['"][\s\S]*?data:([\s\S]*?),\s*sideChannel:/g;
    for (const m of html.matchAll(cbRegex)) {
      try {
        const parsedJson = JSON.parse(m[2]);
        const candidate = parsedJson?.[1]?.[2];
        if (Array.isArray(candidate) && (candidate?.[77]?.[0] === packageId || (m[1] === 'ds:5' && candidate?.[0]?.[0]))) {
          appInfo = candidate;
          if (candidate?.[77]?.[0] === packageId) break;
        }
      } catch {
        // Continue scanning callbacks
      }
    }

    if (!appInfo) {
      throw new Error('No se pudieron leer los datos de la ficha en Google Play Store.');
    }

    const title = decodeHtmlEntities(String(appInfo?.[0]?.[0] || '').trim());
    const developer = decodeHtmlEntities(String(appInfo?.[37]?.[0] || appInfo?.[68]?.[0] || '').trim());

    const priceMicros = Number(appInfo?.[57]?.[0]?.[0]?.[0]?.[0]?.[1]?.[0]?.[0] || 0);
    const priceFormatted = String(appInfo?.[57]?.[0]?.[0]?.[0]?.[0]?.[1]?.[0]?.[2] || '').trim();
    const isPaid = priceMicros > 0 || Boolean(priceFormatted && !/^(\$?0(\.0+)?|free)$/i.test(priceFormatted));

    const rawVersion = String(appInfo?.[140]?.[0]?.[0]?.[0] || '').trim();
    const version = /^varies with device$/i.test(rawVersion) ? '' : rawVersion;

    const updatedTs = Number(appInfo?.[145]?.[0]?.[1]?.[0] || 0);
    const updatedText = String(appInfo?.[145]?.[0]?.[0] || '').trim();
    let lastUpdate = '';
    if (Number.isFinite(updatedTs) && updatedTs > 0) {
      lastUpdate = formatNaplDate(new Date(updatedTs * 1000).toISOString());
    } else if (updatedText) {
      const parsedDate = Date.parse(updatedText);
      if (!Number.isNaN(parsedDate)) {
        lastUpdate = formatNaplDate(new Date(parsedDate).toISOString());
      }
    }

    return {
      provider: 'playstore',
      syncTarget: packageId,
      status: 'ok',
      moved: false,
      archived: false,
      githubRepo: '',
      repoUrl: storeUrl,
      storeUrl,
      recommendedUrl: storeUrl,
      project: title || packageId,
      developer,
      version,
      lastUpdate,
      link: isPaid ? 'Paid (Playstore)' : 'Free (Playstore)',
      checkedAt: new Date().toISOString(),
    };
  }

  async function inspectPortSource(rawInput) {
    const value = String(rawInput || '').trim();
    if (!value) throw new Error('Ingresá una URL de GitHub, GitLab o Play Store.');
    if (parsePlayStorePackage(value)) {
      return inspectPlayStoreApp(value);
    }
    if (parseGitlabProject(value)) {
      return inspectGitlabProject(value);
    }
    if (parseGithubRepo(value)) {
      return inspectGithubRepo(value);
    }
    throw new Error('URL no reconocida. Usá enlaces de GitHub, GitLab o Google Play Store.');
  }

  async function inspectLaunchboxUrl(rawUrl) {
    let targetUrl;
    try {
      targetUrl = new URL(String(rawUrl || '').trim());
    } catch {
      throw new Error('URL de LaunchBox inválida.');
    }
    if (
      (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') ||
      targetUrl.hostname.toLowerCase() !== 'gamesdb.launchbox-app.com'
    ) {
      throw new Error('Solo se permiten URLs de gamesdb.launchbox-app.com.');
    }

    const res = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`LaunchBox respondió HTTP ${res.status}.`);

    const html = await res.text();
    let name = '';
    let year = '';
    let genre = '';
    let description = '';
    let coverUrl = '';
    let developer = '';

    const nuxtMatch = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nuxtMatch) {
      try {
        const pool = JSON.parse(nuxtMatch[1]);
        const gameIdx = pool.findIndex(
          (item) => item && typeof item === 'object' && !Array.isArray(item) && 'gameGenres' in item && 'gameImages' in item
        );
        if (gameIdx >= 0) {
          const resolveVal = (v, depth = 0) => {
            if (depth > 5) return v;
            if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < pool.length) {
              return resolveNode(pool[v], depth + 1);
            }
            return v;
          };
          const resolveNode = (node, depth = 0) => {
            if (Array.isArray(node)) return node.map((i) => resolveVal(i, depth));
            if (node && typeof node === 'object') {
              const out = {};
              for (const [k, v] of Object.entries(node)) out[k] = resolveVal(v, depth);
              return out;
            }
            return node;
          };

          const game = resolveNode(pool[gameIdx], 0);
          name = String(game.name || '').trim();
          description = String(game.overview || '').trim();
          const rawYear = game.releaseYear || game.releaseDate || '';
          const ym = String(rawYear).match(/\b(19\d\d|20\d\d)\b/);
          if (ym) year = ym[1];
          if (Array.isArray(game.gameGenres) && game.gameGenres.length) {
            genre = game.gameGenres
              .map((g) => String(g?.name || '').trim())
              .filter(Boolean)
              .slice(0, 2)
              .join(', ');
          }
          if (Array.isArray(game.gameDevelopers) && game.gameDevelopers.length) {
            developer = String(game.gameDevelopers[0]?.name || '').trim();
          }
          if (Array.isArray(game.gameImages) && game.gameImages.length) {
            const preferred =
              game.gameImages.find((img) => /box\s*-\s*front/i.test(String(img?.imageTypeName || ''))) ||
              game.gameImages.find((img) => /fanart|poster|clear logo/i.test(String(img?.imageTypeName || ''))) ||
              game.gameImages[0];
            if (preferred) {
              coverUrl = resolveLaunchboxImageUrl(
                preferred.fullGameImageFileName || preferred.imageFileName || ''
              );
            }
          }
        }
      } catch {
        // Fallback below
      }
    }

    if (!name) {
      const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (h1) name = decodeHtmlEntities(h1[1].replace(/<[^>]+>/g, '')).trim();
    }
    if (!description) {
      const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      if (metaDesc) description = decodeHtmlEntities(metaDesc[1]).trim();
    }
    if (!year) {
      const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
      const ym = timeMatch && timeMatch[1].match(/\b(19\d\d|20\d\d)\b/);
      if (ym) year = ym[1];
    }
    if (!coverUrl) {
      const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      if (ogImg) coverUrl = ogImg[1].trim();
    }

    if (!name) throw new Error('No se pudieron leer los datos de esa ficha de LaunchBox.');

    return {
      name,
      year,
      genre,
      description: description.replace(/\r\n/g, '\n').trim(),
      coverUrl,
      developer,
      launchboxUrl: targetUrl.toString(),
    };
  }

  async function syncSinglePort(portId) {
    ensureSeeded();
    const row = db.prepare('SELECT * FROM ports WHERE port_id = ?').get(portId);
    if (!row) throw new Error('Port no encontrado en la base local.');
    const outcome = await syncSinglePortRow(row);
    if (outcome.changed) {
      const now = new Date().toISOString();
      const setMeta = db.prepare('INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)');
      setMeta.run('updated_at', now, now);
      setMeta.run('pending_github_sync', '1', now);
    }
    return outcome;
  }

  async function syncSinglePortRow(row) {
    const syncInfo = resolvePortSyncTarget(row);
    if (!syncInfo.provider || !syncInfo.target) {
      return { portId: row.port_id, status: 'skipped', reason: 'Sin fuente sincronizable' };
    }

    const now = new Date().toISOString();
    let info;
    if (syncInfo.provider === 'playstore') {
      info = await inspectPlayStoreApp(syncInfo.target);
    } else if (syncInfo.provider === 'gitlab') {
      const glTarget = /^https?:\/\//i.test(syncInfo.target)
        ? syncInfo.target
        : `https://gitlab.com/${syncInfo.target.replace(/^\/+/, '')}`;
      info = await inspectGitlabProject(glTarget);
    } else {
      info = await inspectGithubRepo(syncInfo.target);
    }

    if (info.status === 'down') {
      const downLabel = syncInfo.provider === 'playstore' ? 'App Down' : 'Repo Down';
      const changed =
        row.github_status !== 'down' ||
        row.link !== downLabel ||
        row.sync_provider !== syncInfo.provider ||
        row.sync_target !== syncInfo.target;
      db.prepare(
        `UPDATE ports
         SET github_repo = ?, sync_provider = ?, sync_target = ?, github_status = 'down', link = ?, last_checked_at = ?
         WHERE port_id = ?`
      ).run(syncInfo.githubRepo, syncInfo.provider, syncInfo.target, downLabel, now, row.port_id);
      return {
        portId: row.port_id,
        gameSlug: row.game_slug,
        project: row.project,
        provider: syncInfo.provider,
        syncTarget: syncInfo.target,
        githubRepo: syncInfo.githubRepo,
        status: 'down',
        changed,
        message: info.error,
      };
    }

    const nextVersion = info.version || row.version;
    const nextLastUpdate = info.lastUpdate || row.last_update;
    const nextLink =
      row.link === 'Repo Down' ||
      row.link === 'App Down' ||
      !row.link ||
      /github|gitlab|play\s*store|playstore/i.test(row.link)
        ? info.link
        : row.link;

    let nextUrl = row.url;
    if (syncInfo.provider === 'github') {
      const curParsed = parseGithubRepo(row.url);
      if (!nextUrl || info.moved || (curParsed && info.apkUrl && /\/releases\/|github\.com/i.test(nextUrl))) {
        nextUrl = info.apkUrl || info.repoUrl;
      }
    } else if (syncInfo.provider === 'gitlab') {
      const curParsed = parseGitlabProject(row.url);
      if (!nextUrl || info.moved || (curParsed && info.apkUrl && /\/releases\/|gitlab\.com/i.test(nextUrl))) {
        nextUrl = info.apkUrl || info.repoUrl;
      }
    } else if (syncInfo.provider === 'playstore') {
      if (!nextUrl) {
        nextUrl = info.storeUrl;
      }
    }

    const nextGithubRepo = syncInfo.provider === 'github' ? info.githubRepo : '';
    const nextSyncTarget = info.syncTarget || syncInfo.target;

    const changed =
      nextVersion !== row.version ||
      nextLastUpdate !== row.last_update ||
      nextGithubRepo !== row.github_repo ||
      syncInfo.provider !== (row.sync_provider || '') ||
      nextSyncTarget !== (row.sync_target || '') ||
      nextUrl !== row.url ||
      nextLink !== row.link ||
      row.github_status !== info.status;

    db.prepare(
      `UPDATE ports
       SET github_repo = ?, sync_provider = ?, sync_target = ?, github_status = ?, version = ?, last_update = ?, url = ?, link = ?, last_checked_at = ?
       WHERE port_id = ?`
    ).run(
      nextGithubRepo,
      syncInfo.provider,
      nextSyncTarget,
      info.status,
      nextVersion,
      nextLastUpdate,
      nextUrl,
      nextLink,
      now,
      row.port_id
    );

    return {
      portId: row.port_id,
      gameSlug: row.game_slug,
      project: row.project || info.project,
      provider: syncInfo.provider,
      syncTarget: nextSyncTarget,
      githubRepo: nextGithubRepo,
      status: info.status,
      changed,
      oldVersion: row.version,
      newVersion: nextVersion,
      url: nextUrl,
      lastUpdate: nextLastUpdate,
    };
  }

  const SYNC_PORT_FILTER = `
    sync_provider != '' OR github_repo != ''
    OR url LIKE '%github.com/%' OR link LIKE '%github.com/%'
    OR url LIKE '%gitlab.com/%' OR link LIKE '%gitlab.com/%'
    OR url LIKE '%play.google.com/store/apps/details%' OR link LIKE '%play.google.com/store/apps/details%'
  `;

  async function runSyncBatch(options = {}) {
    ensureSeeded();
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 22);
    const offset = Math.max(Number(options.offset) || 0, 0);
    const source = options.source || 'manual';

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS count FROM ports WHERE ${SYNC_PORT_FILTER}`)
      .get();
    const totalSyncPorts = Number(totalRow?.count || 0);

    const ports = options.useOffset
      ? db
          .prepare(
            `SELECT * FROM ports
             WHERE ${SYNC_PORT_FILTER}
             ORDER BY port_id ASC
             LIMIT ? OFFSET ?`
          )
          .all(limit, offset)
      : db
          .prepare(
            `SELECT * FROM ports
             WHERE ${SYNC_PORT_FILTER}
             ORDER BY last_checked_at ASC, port_id ASC
             LIMIT ?`
          )
          .all(limit);

    let checkedCount = 0;
    let updatedCount = 0;
    let downCount = 0;
    let errorCount = 0;
    const details = [];

    for (const row of ports) {
      checkedCount += 1;
      const syncInfo = resolvePortSyncTarget(row);
      try {
        const outcome = await syncSinglePortRow(row);
        if (outcome.status === 'down') downCount += 1;
        if (outcome.changed) {
          updatedCount += 1;
          details.push(outcome);
        }
      } catch (err) {
        errorCount += 1;
        details.push({
          portId: row.port_id,
          gameSlug: row.game_slug,
          project: row.project,
          provider: syncInfo.provider,
          syncTarget: syncInfo.target,
          githubRepo: row.github_repo,
          status: 'error',
          error: err?.message || 'Error consultando fuente externa',
        });
      }
    }

    const now = new Date().toISOString();
    const setMeta = db.prepare('INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)');
    setMeta.run('last_sync_at', now, now);
    if (updatedCount > 0) {
      setMeta.run('updated_at', now, now);
      setMeta.run('pending_github_sync', '1', now);
    }

    db.prepare(
      `INSERT INTO sync_logs (source, checked_count, updated_count, down_count, error_count, summary_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(source, checkedCount, updatedCount, downCount, errorCount, JSON.stringify(details.slice(0, 40)), now);

    return {
      source,
      totalSyncPorts,
      totalGithubPorts: totalSyncPorts,
      checkedCount,
      updatedCount,
      downCount,
      errorCount,
      nextOffset: offset + checkedCount,
      hasMore: options.useOffset ? offset + checkedCount < totalSyncPorts : false,
      details,
      syncedAt: now,
    };
  }

  async function importSheets() {
    ensureSeeded();
    const res = await fetch(SHEET_URL, { headers: { Accept: 'text/csv' } });
    if (!res.ok) throw new Error(`Google Sheets HTTP ${res.status}`);
    const csv = await res.text();
    const rows = csvParse(csv);
    if (!rows.length) throw new Error('CSV vacío.');
    const imported = fromRows(rows);
    if (!imported.games.length) throw new Error('No se encontraron juegos válidos.');

    const oldState = readCatalog({ includeInternal: false });
    const oldSet = new Set(oldState.catalog.games.map((g) => g.slug));
    const newSet = new Set(imported.games.map((g) => g.slug));

    replaceWholeCatalog(imported, { pendingGithubSync: true });
    return {
      summary: {
        csvRows: rows.length,
        games: imported.games.length,
        ports: imported.games.reduce((n, g) => n + g.ports.length, 0),
        addedGames: imported.games.filter((g) => !oldSet.has(g.slug)).length,
        removedGames: Array.from(oldSet).filter((s) => !newSet.has(s)).length,
        characters: csv.length,
      },
    };
  }

  async function publishCatalog(optionalCatalog) {
    ensureSeeded();
    if (optionalCatalog) {
      replaceWholeCatalog(optionalCatalog, { pendingGithubSync: true });
    }
    const { catalog } = readCatalog({ includeInternal: false });
    fs.writeFileSync(catalogJsonPath, JSON.stringify(catalog), 'utf8');

    const token = process.env.CATALOG_DATA_GITHUB_TOKEN;
    if (!token) {
      throw new Error('Falta CATALOG_DATA_GITHUB_TOKEN para publicar en Fe2rr/NAPL-Data.');
    }
    const apiPath = `/repos/${DATA_REPO}/contents/${DATA_CATALOG_PATH}`;
    const { res: metaRes, data: meta } = await ghFetch(`${apiPath}?ref=${DATA_BRANCH}`, { token });
    if (!metaRes.ok && metaRes.status !== 404) {
      throw new Error(meta.message || `No se pudo leer NAPL-Data (HTTP ${metaRes.status}).`);
    }
    const payload = {
      message: 'NAPL: publicar catálogo JSON desde servidor local',
      content: Buffer.from(JSON.stringify(catalog), 'utf8').toString('base64'),
      branch: DATA_BRANCH,
    };
    if (metaRes.ok && meta.sha) payload.sha = meta.sha;
    const { res, data } = await ghFetch(apiPath, {
      method: 'PUT',
      body: payload,
      token,
    });
    if (!res.ok) throw new Error(data.message || `NAPL-Data HTTP ${res.status}`);

    const now = new Date().toISOString();
    const setMeta = db.prepare('INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)');
    setMeta.run('pending_github_sync', '0', now);
    setMeta.run('last_github_publish_at', now, now);
    return { commit: data.commit?.html_url || '', sha: data.commit?.sha || '', pushedToGithub: true, localUpdated: true };
  }

  async function publishSavedCatalog() {
    ensureSeeded();
    const now = new Date().toISOString();
    try {
      const result = await publishCatalog();
      return { commit: result.commit || '', publishError: '' };
    } catch (error) {
      db.prepare('INSERT OR REPLACE INTO catalog_meta (key, value, updated_at) VALUES (?, ?, ?)').run(
        'pending_github_sync',
        '1',
        now
      );
      return { commit: '', publishError: error?.message || 'Error publicando en GitHub' };
    }
  }

  return {
    hasCustomPassword,
    verifyPassword,
    createToken,
    verifyToken,
    readCatalog,
    saveSingleGame,
    deleteGame,
    inspectGithubRepo,
    inspectGitlabProject,
    inspectPlayStoreApp,
    inspectPortSource,
    inspectLaunchboxUrl,
    syncSinglePort,
    runSyncBatch,
    runGithubSyncBatch: runSyncBatch,
    importSheets,
    publishCatalog,
    publishSavedCatalog,
  };
}
