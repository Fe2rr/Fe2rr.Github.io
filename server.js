import express from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { createLocalD1Store } from './lib/local-d1.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readCliArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) {
    return String(process.argv[idx + 1]).trim();
  }
  const prefix = `${name}=`;
  const eq = process.argv.find((arg) => arg.startsWith(prefix));
  if (eq) return eq.slice(prefix.length).trim();
  return fallback;
}

const app = express();
const PORT = Number(readCliArg('--port', '3000')) || 3000;
const HOST = readCliArg('--host', '0.0.0.0') || '0.0.0.0';
const CATALOG_PATH = path.join(__dirname, '.local', 'catalog-seed.json');
const CATALOG_SEED_URL = 'https://napl-catalog.pages.dev/assets/data/catalog.json';
const SCHEMA_PATH = path.join(__dirname, 'cloudflare', 'schema.sql');
const localD1 = createLocalD1Store({
  rootDir: __dirname,
  catalogJsonPath: CATALOG_PATH,
  schemaSqlPath: SCHEMA_PATH,
});

const COMPRESSIBLE_CONTENT_TYPE = /^(?:text\/|application\/(?:json|javascript|ecmascript|xml)|image\/svg\+xml)/i;

function createCompressionMiddleware() {
  return (req, res, next) => {
    if (req.method === 'HEAD') return next();
    const acceptEncoding = String(req.headers['accept-encoding'] || '');
    const encoding = /\bbr\b/i.test(acceptEncoding)
      ? 'br'
      : /\bgzip\b/i.test(acceptEncoding)
      ? 'gzip'
      : '';

    if (!encoding) return next();

    let compressor = null;
    let decided = false;
    let passthrough = false;
    let waitingUpstreamDrain = false;

    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    const origSetHeader = res.setHeader.bind(res);
    const origWriteHead = res.writeHead.bind(res);

    function decideCompression(statusCode) {
      if (decided) return;
      decided = true;

      const code = statusCode || res.statusCode || 200;
      const contentType = String(res.getHeader('Content-Type') || '');
      const existingEncoding = String(res.getHeader('Content-Encoding') || '');
      const cacheControl = String(res.getHeader('Cache-Control') || '');
      const contentLength = Number(res.getHeader('Content-Length') || 0);

      if (
        code === 204 ||
        code === 304 ||
        existingEncoding ||
        /\bno-transform\b/i.test(cacheControl) ||
        !COMPRESSIBLE_CONTENT_TYPE.test(contentType) ||
        (contentLength > 0 && contentLength < 512)
      ) {
        passthrough = true;
        return;
      }

      res.removeHeader('Content-Length');
      origSetHeader('Content-Encoding', encoding);
      const existingVary = String(res.getHeader('Vary') || '');
      if (!/\baccept-encoding\b/i.test(existingVary)) {
        origSetHeader('Vary', existingVary ? `${existingVary}, Accept-Encoding` : 'Accept-Encoding');
      }

      compressor =
        encoding === 'br'
          ? zlib.createBrotliCompress({
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
            })
          : zlib.createGzip({ level: 6 });

      compressor.on('data', (chunk) => {
        if (!origWrite(chunk)) {
          compressor.pause();
        }
      });
      compressor.on('drain', () => {
        if (waitingUpstreamDrain) {
          waitingUpstreamDrain = false;
          res.emit('drain');
        }
      });
      compressor.on('end', () => {
        origEnd();
      });
      compressor.on('error', () => {
        passthrough = true;
        origEnd();
      });

      res.on('drain', () => {
        if (compressor && !passthrough) {
          compressor.resume();
        }
      });
      res.on('close', () => {
        if (compressor && !compressor.destroyed) {
          compressor.destroy();
        }
      });
    }

    res.setHeader = (name, value) => {
      if (decided && !passthrough && name.toLowerCase() === 'content-length') {
        return res;
      }
      return origSetHeader(name, value);
    };

    res.writeHead = (statusCode, statusMessage, headers) => {
      let headerObj = headers;
      if (typeof statusMessage === 'object' && statusMessage !== null) {
        headerObj = statusMessage;
      }
      if (headerObj && typeof headerObj === 'object') {
        for (const [k, v] of Object.entries(headerObj)) {
          origSetHeader(k, v);
        }
      }
      decideCompression(statusCode);
      if (typeof statusMessage === 'string') {
        return origWriteHead(statusCode, statusMessage);
      }
      return origWriteHead(statusCode);
    };

    res.write = (chunk, enc, cb) => {
      decideCompression(res.statusCode);
      if (passthrough || !compressor) {
        return origWrite(chunk, enc, cb);
      }
      const ok = compressor.write(chunk, enc, cb);
      if (!ok) {
        waitingUpstreamDrain = true;
      }
      return ok;
    };

    res.end = (chunk, enc, cb) => {
      if (typeof chunk === 'function') {
        cb = chunk;
        chunk = undefined;
      } else if (typeof enc === 'function') {
        cb = enc;
        enc = undefined;
      }

      decideCompression(res.statusCode);
      if (passthrough || !compressor) {
        return origEnd(chunk, enc, cb);
      }
      if (chunk !== undefined) {
        compressor.write(chunk, enc);
      }
      if (cb) {
        compressor.once('end', cb);
      }
      compressor.end();
      return res;
    };

    next();
  };
}

app.use(createCompressionMiddleware());
app.use(express.json({ limit: '10mb' }));

// Load strict Android device list for compatibility validation (supports sharded manifest or raw array)
const deviceMap = new Map();
const devicesCatalog = [];
try {
  const devicesPath = path.join(__dirname, 'public', 'assets', 'data', 'devices.json');
  const rawDevices = fs.readFileSync(devicesPath, 'utf8');
  const parsedDevices = JSON.parse(rawDevices);

  let rawDeviceList = [];
  if (Array.isArray(parsedDevices)) {
    rawDeviceList = parsedDevices;
  } else if (
    parsedDevices?.format === 'napl-device-catalog-shards-v1' &&
    Array.isArray(parsedDevices.chunks)
  ) {
    for (const chunk of parsedDevices.chunks) {
      const filename = String(chunk?.file || '');
      if (!/^devices-part-\d{3}\.json$/.test(filename)) continue;
      const chunkPath = path.join(__dirname, 'public', 'assets', 'data', 'device-catalog', filename);
      const chunkRecords = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
      if (Array.isArray(chunkRecords)) {
        rawDeviceList.push(...chunkRecords);
      }
    }
  }

  for (const d of rawDeviceList) {
    if (d && typeof d.id === 'string' && typeof d.name === 'string') {
      const entry = {
        id: d.id,
        name: d.name,
        manufacturer: String(d.manufacturer || ''),
        model: String(d.model || d.name),
        soc: String(d.soc || ''),
        deviceType: String(d.device_type || d.deviceType || 'phone'),
      };
      deviceMap.set(d.id, entry);
      devicesCatalog.push(entry);
    }
  }
} catch (error) {
  console.warn('Warning: could not load devices.json for compatibility validation:', error);
}

app.get('/api/catalog-meta', (req, res) => {
  try {
    const { catalog } = localD1.readCatalog({ includeInternal: false });
    const totalPorts = (catalog.games || []).reduce(
      (sum, g) => sum + (Array.isArray(g.ports) ? g.ports.length : 0),
      0
    );
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.json({
      version: Number(catalog.version) || 1,
      updatedAt: String(catalog.updatedAt || ''),
      gamesCount: Array.isArray(catalog.games) ? catalog.games.length : 0,
      portsCount: totalPorts,
      sizeBytes: Buffer.byteLength(JSON.stringify(catalog), 'utf8'),
    });
  } catch {
    return res.status(500).json({ error: 'Could not read catalog metadata.' });
  }
});

let publicCatalogCache = { data: null, fetchedAt: 0 };
const PUBLIC_CATALOG_UPSTREAM = 'https://napl-catalog.pages.dev/assets/data/catalog.json';

app.get('/api/public-catalog', async (req, res) => {
  try {
    const { catalog } = localD1.readCatalog({ includeInternal: false });
    if (Array.isArray(catalog?.games) && catalog.games.length > 0) {
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
      return res.json(catalog);
    }

    const freshEnough =
      publicCatalogCache.data && Date.now() - publicCatalogCache.fetchedAt < 60_000;
    if (freshEnough) {
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
      return res.json(publicCatalogCache.data);
    }

    const upstreamRes = await fetch(PUBLIC_CATALOG_UPSTREAM, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!upstreamRes.ok) {
      throw new Error(`Upstream catalog HTTP ${upstreamRes.status}`);
    }
    const upstreamJson = await upstreamRes.json();
    if (!upstreamJson || !Array.isArray(upstreamJson.games)) {
      throw new Error('Upstream catalog JSON is invalid.');
    }
    publicCatalogCache = { data: upstreamJson, fetchedAt: Date.now() };
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res.json(upstreamJson);
  } catch (error) {
    if (publicCatalogCache.data) {
      res.setHeader('Cache-Control', 'public, max-age=10');
      return res.json(publicCatalogCache.data);
    }
    return res.status(502).json({
      error: error?.message || 'Could not load public catalog.',
    });
  }
});

// Admin + D1 parity endpoints (mirroring Cloudflare Worker API; D1 requires admin auth)
function requireAdminAuth(req, res, next) {
  if (!localD1.verifyToken(req.headers.authorization)) {
    return res.status(401).json({ error: 'Sesión inválida o vencida. Iniciá sesión nuevamente.' });
  }
  return next();
}

app.get('/api/health', (req, res) => {
  return res.json({
    ok: true,
    localMode: true,
    d1: true,
    hasCustomPassword: localD1.hasCustomPassword(),
    configured: {
      adminPassword: true,
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      sessionSecret: true,
      d1: true,
    },
  });
});

app.post('/api/login', (req, res) => {
  const password = String(req.body?.password || '');
  if (!localD1.verifyPassword(password)) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  return res.json({ token: localD1.createToken(), expiresIn: 8 * 60 * 60 * 1000 });
});

app.post('/api/logout', (req, res) => {
  return res.json({ success: true });
});

app.get('/api/catalog', requireAdminAuth, (req, res) => {
  try {
    const data = localD1.readCatalog({ includeInternal: true });
    return res.json({ ...data, exists: data.catalog.games.length > 0 });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'No se pudo leer el catálogo.' });
  }
});

app.post('/api/games', requireAdminAuth, async (req, res) => {
  try {
    const saved = localD1.saveSingleGame(null, req.body?.game || req.body, true);
    const publication = await localD1.publishSavedCatalog();
    const state = localD1.readCatalog({ includeInternal: true });
    return res.json({ success: true, saved, ...publication, ...state });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'No se pudo crear el juego.' });
  }
});

app.put('/api/games/:slug', requireAdminAuth, async (req, res) => {
  try {
    const saved = localD1.saveSingleGame(req.params.slug, req.body?.game || req.body, false);
    const publication = await localD1.publishSavedCatalog();
    const state = localD1.readCatalog({ includeInternal: true });
    return res.json({ success: true, saved, ...publication, ...state });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'No se pudo guardar el juego.' });
  }
});

app.delete('/api/games/:slug', requireAdminAuth, (req, res) => {
  try {
    const removed = localD1.deleteGame(req.params.slug);
    const state = localD1.readCatalog({ includeInternal: true });
    return res.json({ success: true, removed, ...state });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'No se pudo eliminar el juego.' });
  }
});

app.post('/api/lookup/github', requireAdminAuth, async (req, res) => {
  try {
    const github = await localD1.inspectGithubRepo(req.body?.url || req.body?.repo);
    return res.json({ success: true, github });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Error consultando GitHub.' });
  }
});

app.post('/api/lookup/source', requireAdminAuth, async (req, res) => {
  try {
    const source = await localD1.inspectPortSource(req.body?.url || req.body?.repo || req.body?.target);
    return res.json({ success: true, source });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Error consultando la fuente del port.' });
  }
});

app.post('/api/lookup/launchbox', requireAdminAuth, async (req, res) => {
  try {
    const launchbox = await localD1.inspectLaunchboxUrl(req.body?.url);
    return res.json({ success: true, launchbox });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Error consultando LaunchBox.' });
  }
});

app.post('/api/ports/sync', requireAdminAuth, async (req, res) => {
  try {
    const portId = String(req.body?.portId || '').trim();
    if (!portId) return res.status(400).json({ error: 'portId requerido.' });
    const result = await localD1.syncSinglePort(portId);
    const state = localD1.readCatalog({ includeInternal: true });
    return res.json({ success: true, result, ...state });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Error sincronizando port.' });
  }
});

async function handleBatchSync(req, res) {
  try {
    const sync = await localD1.runSyncBatch({
      source: 'manual',
      limit: req.body?.limit || 20,
      offset: req.body?.offset || 0,
      useOffset: Boolean(req.body?.useOffset),
    });
    const state = localD1.readCatalog({ includeInternal: true });
    return res.json({ success: true, sync, ...state });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Error en sincronización automática.' });
  }
}

app.post('/api/sync-github', requireAdminAuth, handleBatchSync);
app.post('/api/sync-sources', requireAdminAuth, handleBatchSync);

app.post('/api/import-sheets', requireAdminAuth, async (req, res) => {
  try {
    const imported = await localD1.importSheets();
    const state = localD1.readCatalog({ includeInternal: true });
    return res.json({ ...state, summary: imported.summary });
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Error importando hoja CSV.' });
  }
});

app.post('/api/publish', requireAdminAuth, async (req, res) => {
  try {
    const result = await localD1.publishCatalog(req.body?.catalog);
    const state = localD1.readCatalog({ includeInternal: true });
    return res.json({ success: true, ...result, ...state });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'No se pudo publicar el catálogo.' });
  }
});

// In-memory compatibility reports for local preview
const compatibilityReports = new Map();
const VALID_COMPAT_STATUSES = new Set(['crash', 'low_fps', 'playable_30', 'playable_60']);

function buildPortSummary(portId) {
  const summary = {
    yes: 0,
    no: 0,
    counts: { playable_60: 0, playable_30: 0, low_fps: 0, crash: 0 },
    reports: [],
  };
  const sorted = Array.from(compatibilityReports.values())
    .filter((r) => r.portId === portId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  for (const r of sorted) {
    if (r.works) summary.yes += 1;
    else summary.no += 1;
    if (summary.counts[r.status] !== undefined) {
      summary.counts[r.status] += 1;
    }
    if (summary.reports.length < 30) {
      summary.reports.push({
        deviceId: r.deviceId,
        deviceName: r.deviceName,
        deviceSoc: r.deviceSoc || '',
        deviceType: r.deviceType || 'phone',
        status: r.status,
        works: r.works,
        updatedAt: r.updatedAt,
      });
    }
  }
  return summary;
}

// Compatibility reports API (preview backend matching Supabase Edge Function contract)
app.get('/api/compatibility', (req, res) => {
  const action = String(req.query.action || '');
  if (action === 'devices') {
    return res.json({ success: true, devices: devicesCatalog });
  }

  if (action === 'search') {
    const deviceId = String(req.query.device_id || '').trim();
    const soc = String(req.query.soc || '').trim().toLowerCase();
    const query = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);

    if (!deviceId && !soc && !query) {
      return res.json({ success: true, reports: [] });
    }

    const sorted = Array.from(compatibilityReports.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    const matches = [];
    for (const r of sorted) {
      const matchDevice = deviceId && r.deviceId === deviceId;
      const matchSoc = soc && String(r.deviceSoc || '').toLowerCase() === soc;
      const matchQuery =
        !deviceId &&
        !soc &&
        query &&
        (String(r.deviceName || '').toLowerCase().includes(query) ||
          String(r.deviceSoc || '').toLowerCase().includes(query));

      if (matchDevice || matchSoc || matchQuery) {
        matches.push({
          portId: r.portId,
          deviceId: r.deviceId,
          deviceName: r.deviceName,
          deviceSoc: r.deviceSoc || '',
          deviceType: r.deviceType || 'phone',
          status: r.status,
          works: r.works,
          updatedAt: r.updatedAt,
        });
        if (matches.length >= limit) break;
      }
    }

    return res.json({ success: true, reports: matches });
  }

  const portIdsParam = String(req.query.port_ids || '');
  const portIds = portIdsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  const compatibility = {};
  for (const id of portIds) {
    compatibility[id] = buildPortSummary(id);
  }

  return res.json({ success: true, compatibility });
});

app.post('/api/compatibility', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid JSON body.' });
  }

  const portId = String(body.port_id || '').trim();
  const deviceId = String(body.device_id || '').trim();
  const token = String(body.token || '').trim();
  const rawStatus = String(body.status || '').trim();
  const worksInput =
    body.works === true || body.works === 1
      ? true
      : body.works === false || body.works === 0
      ? false
      : null;

  const status = VALID_COMPAT_STATUSES.has(rawStatus)
    ? rawStatus
    : worksInput === true
    ? 'playable_30'
    : worksInput === false
    ? 'crash'
    : '';

  if (!portId || !deviceId || !token || !status) {
    return res.status(400).json({
      success: false,
      error: 'port_id, device_id, token, and a valid status are required.',
    });
  }

  const device = deviceMap.get(deviceId);
  if (!device) {
    return res.status(400).json({
      success: false,
      error: 'Invalid device_id. Please select a device from the list.',
    });
  }

  const works = status === 'playable_30' || status === 'playable_60';
  const key = `${portId}:${token}:${deviceId}`;
  const updatedAt = new Date().toISOString();

  compatibilityReports.set(key, {
    portId,
    token,
    deviceId,
    deviceName: device.model || device.name,
    deviceSoc: device.soc || '',
    deviceType: device.deviceType || 'phone',
    status,
    works,
    updatedAt,
  });

  return res.json({
    success: true,
    report: {
      portId,
      deviceId,
      deviceName: device.model || device.name,
      deviceSoc: device.soc || '',
      deviceType: device.deviceType || 'phone',
      status,
      works,
    },
    summary: buildPortSummary(portId),
  });
});

// Broken / dead link reports (preview backend matching Cloudflare Worker)
const linkReports = new Map();

app.post('/api/report-link', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid JSON body.' });
  }

  const portId = String(body.port_id || '').trim();
  const token = String(body.token || body.client_id || '').trim();
  const reason = String(body.reason || '').trim().slice(0, 120);
  const note = String(body.note || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const url = String(body.url || '').trim().slice(0, 500);

  if (!portId || !token || (!reason && !note)) {
    return res.status(400).json({
      success: false,
      error: 'port_id, token, and reason are required.',
    });
  }

  linkReports.set(`${portId}:${token}`, {
    portId,
    reason: reason || note,
    note,
    url,
    updatedAt: new Date().toISOString(),
  });

  return res.json({ success: true, portId, reason: reason || note, note });
});

// Steam cover resolver/proxy for hashed Store asset paths (IStoreBrowseService)
const steamCoverUrlCache = new Map();
const STEAM_COVER_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchSteamAssetCandidateUrls(appid) {
  const candidates = [];
  const input = JSON.stringify({
    ids: [{ appid: Number(appid) }],
    context: { country_code: 'US' },
    data_request: { include_assets: true },
  });
  const apiUrl = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(input)}`;

  try {
    const apiRes = await fetch(apiUrl);
    if (apiRes.ok) {
      const payload = await apiRes.json();
      const assets = payload?.response?.store_items?.[0]?.assets;
      if (assets) {
        const format = String(assets.asset_url_format || `steam/apps/${appid}/\${FILENAME}`);
        const assetKeys = [
          assets.library_capsule,
          assets.library_capsule_2x,
          assets.library_600x900,
          assets.library_600x900_2x,
          assets.header,
        ].filter(Boolean);

        for (const file of assetKeys) {
          const pathPart = format.replace('${FILENAME}', file);
          candidates.push(`https://shared.akamai.steamstatic.com/store_item_assets/${pathPart}`);
        }
      }
    }
  } catch (error) {
    console.warn(`Steam asset lookup failed for app ${appid}:`, error);
  }

  candidates.push(
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_capsule.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
  );

  return [...new Set(candidates)];
}

app.get('/api/steam-cover/:appid', async (req, res) => {
  const appid = String(req.params.appid || '').trim();
  if (!/^\d{1,10}$/.test(appid)) {
    return res.status(400).json({ error: 'Invalid Steam App ID.' });
  }

  const now = Date.now();
  const cached = steamCoverUrlCache.get(appid);
  const candidateUrls =
    cached && now - cached.time < STEAM_COVER_TTL_MS
      ? [cached.url]
      : await fetchSteamAssetCandidateUrls(appid);

  for (const url of candidateUrls) {
    try {
      const upstream = await fetch(url);
      const contentType = upstream.headers.get('content-type') || '';
      if (!upstream.ok || !contentType.toLowerCase().startsWith('image/')) {
        continue;
      }

      steamCoverUrlCache.set(appid, { url, time: now });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    } catch {
      // Try next candidate
    }
  }

  return res.status(404).end();
});

function resolveLegacyRedirect(rawPath, search) {
  const isPublicPrefixed = rawPath === '/public' || rawPath.startsWith('/public/');
  const cleanPath = isPublicPrefixed ? rawPath.replace(/^\/public/, '') || '/' : rawPath;

  if (cleanPath === '/compatibility' || cleanPath === '/compatibility.html') {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    if (!params.has('page')) params.set('page', 'compatibility');
    const qs = params.toString();
    return qs ? `/?${qs}` : '/?page=compatibility';
  }

  if (
    cleanPath === '/index.html' ||
    cleanPath === '/game' ||
    cleanPath === '/game.html' ||
    cleanPath === '/all-games' ||
    cleanPath === '/all-games.html'
  ) {
    return '/' + search;
  }

  return isPublicPrefixed ? cleanPath + search : null;
}

app.use((req, res, next) => {
  const queryIndex = req.originalUrl.indexOf('?');
  const search = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
  const redirectTarget = resolveLegacyRedirect(req.path, search);

  if (redirectTarget) {
    return res.redirect(301, redirectTarget);
  }

  next();
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      if (/\.json$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
      } else if (/\.(html|css|js)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
      }
    },
  })
);

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const scheduledSyncTimer = setInterval(() => {
  localD1.runGithubSyncBatch({ source: 'cron', limit: 20, useOffset: false }).catch(() => {});
}, SIX_HOURS_MS);
scheduledSyncTimer.unref();

async function prepareLocalCatalogSeed() {
  if (fs.existsSync(CATALOG_PATH)) return;
  try {
    const response = await fetch(CATALOG_SEED_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Catálogo remoto HTTP ${response.status}`);
    const catalog = await response.json();
    if (!catalog || !Array.isArray(catalog.games) || !catalog.games.length) {
      throw new Error('El catálogo remoto no tiene juegos válidos.');
    }
    fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog), 'utf8');
    console.log(`Catálogo inicial descargado: ${catalog.games.length} juegos.`);
  } catch (error) {
    console.warn('No se pudo descargar el catálogo inicial para el modo local:', error?.message || error);
  }
}

await prepareLocalCatalogSeed();

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`  ➜  Local:   http://localhost:${PORT}/`);
});

function shutdown() {
  clearInterval(scheduledSyncTimer);
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
