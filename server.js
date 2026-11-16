import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';
const RATINGS_TARGET = 'https://ports-ratings-worker.federicoxastro.workers.dev';

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

app.use(express.json());

// Proxy ratings API in preview to avoid Worker CORS origin restrictions
app.all('/api/ratings/*', async (req, res) => {
  try {
    const subPath = req.originalUrl.replace(/^\/api\/ratings/, '');
    const targetUrl = `${RATINGS_TARGET}${subPath}`;

    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://fe2rr.github.io',
      },
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(req.body ?? {});
    }

    const upstream = await fetch(targetUrl, fetchOptions);
    const bodyText = await upstream.text();

    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.send(bodyText);
  } catch (error) {
    console.error('Ratings proxy error:', error);
    res.status(502).json({ error: 'Could not reach the ratings server.' });
  }
});

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
  const token = String(body.token || '').trim();
  const reason = String(body.reason || '').trim().slice(0, 120);
  const url = String(body.url || '').trim().slice(0, 500);

  if (!portId || !token || !reason) {
    return res.status(400).json({
      success: false,
      error: 'port_id, token, and reason are required.',
    });
  }

  linkReports.set(`${portId}:${token}`, {
    portId,
    reason,
    url,
    updatedAt: new Date().toISOString(),
  });

  return res.json({ success: true, portId, reason });
});

// Sheet proxy endpoint for preview mode (avoids browser iframe CORS / redirect blocks)
let sheetCache = null;
let sheetCacheTime = 0;
const SPREADSHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1CO7dH7mbj9sl67g4e94wczHESp0NAsOa7_chKKii9OA/export?format=csv';

app.get('/api/sheet', async (req, res) => {
  try {
    const now = Date.now();
    if (sheetCache && now - sheetCacheTime < 120000) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(sheetCache);
    }
    const upstream = await fetch(SPREADSHEET_CSV_URL);
    if (!upstream.ok) {
      throw new Error(`Google Sheets HTTP ${upstream.status}`);
    }
    const csv = await upstream.text();
    sheetCache = csv;
    sheetCacheTime = now;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(csv);
  } catch (error) {
    console.error('Sheet proxy error:', error);
    if (sheetCache) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(sheetCache);
    }
    return res.status(502).json({ error: 'Could not fetch Google Sheet catalog.' });
  }
});

// Visit tracking proxy for preview mode
const POPULAR_URL =
  'https://script.google.com/macros/s/AKfycbxio6DGpBJRkYdceeFVXk3gSOFcBe5KZJtHU8F2j66DDYx_G_az01p7rnsuCq0KPHY/exec';

const popularCache = new Map();

app.get('/api/popular', async (req, res) => {
  const period = String(req.query.popular || 'week').trim();
  const cached = popularCache.get(period);
  const now = Date.now();

  if (cached && now - cached.time < 60000) {
    return res.json(cached.data);
  }

  try {
    const url = new URL(POPULAR_URL);
    url.searchParams.set('popular', period);
    const upstream = await fetch(url.toString());
    const data = await upstream.json();
    popularCache.set(period, { time: now, data });
    return res.json(data);
  } catch (error) {
    console.error('Popular proxy error:', error);
    if (cached) {
      return res.json(cached.data);
    }
    return res.status(502).json({ success: false, error: 'Could not fetch popular games.' });
  }
});

app.post('/api/visit', async (req, res) => {
  const slug = String(req.body?.slug || '').trim();
  if (!slug) {
    return res.status(400).json({ success: false, error: 'slug is required.' });
  }

  try {
    const url = new URL(POPULAR_URL);
    url.searchParams.set('game', slug);
    url.searchParams.set('_', String(Date.now()));
    await fetch(url.toString(), { method: 'GET' });
  } catch {
    // Non-critical telemetry; do not fail the client request
  }

  return res.json({ success: true, slug });
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (/\.(html|css|js)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
      }
    },
  })
);

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
