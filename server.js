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

// Load strict Android device list for compatibility validation
const deviceMap = new Map();
const devicesCatalog = [];
try {
  const devicesPath = path.join(__dirname, 'public', 'assets', 'data', 'devices.json');
  const rawDevices = fs.readFileSync(devicesPath, 'utf8');
  const parsedDevices = JSON.parse(rawDevices);
  if (Array.isArray(parsedDevices)) {
    for (const d of parsedDevices) {
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
  }
} catch (error) {
  console.warn('Warning: could not load devices.json for compatibility validation:', error);
}

// In-memory compatibility reports for preview (Supabase handles this in production)
const compatibilityReports = new Map();

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
  if (req.query.action === 'devices') {
    return res.json({ success: true, devices: devicesCatalog });
  }

  const portIdsParam = String(req.query.port_ids || '');
  const portIds = portIdsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  const compatibility = {};
  for (const id of portIds) {
    compatibility[id] = { yes: 0, no: 0, reports: [] };
  }

  const allReports = Array.from(compatibilityReports.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  for (const report of allReports) {
    const entry = compatibility[report.portId];
    if (!entry) continue;

    if (report.works) entry.yes += 1;
    else entry.no += 1;

    if (entry.reports.length < 30) {
      entry.reports.push({
        deviceId: report.deviceId,
        deviceName: report.deviceName,
        deviceSoc: report.deviceSoc || '',
        deviceType: report.deviceType || 'phone',
        works: report.works,
        updatedAt: report.updatedAt,
      });
    }
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
  const works =
    body.works === true || body.works === 1
      ? true
      : body.works === false || body.works === 0
      ? false
      : null;

  if (!portId || !deviceId || !token || works === null) {
    return res.status(400).json({
      success: false,
      error: 'port_id, device_id, token, and works (boolean) are required.',
    });
  }

  const device = deviceMap.get(deviceId);
  if (!device) {
    return res.status(400).json({
      success: false,
      error: 'Invalid device_id. Please select a device from the list.',
    });
  }

  const key = `${portId}:${token}:${deviceId}`;
  const updatedAt = new Date().toISOString();

  compatibilityReports.set(key, {
    portId,
    token,
    deviceId,
    deviceName: device.model || device.name,
    deviceSoc: device.soc || '',
    deviceType: device.deviceType || 'phone',
    works,
    updatedAt,
  });

  const summary = { yes: 0, no: 0, reports: [] };
  const sorted = Array.from(compatibilityReports.values())
    .filter((r) => r.portId === portId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const r of sorted) {
    if (r.works) summary.yes += 1;
    else summary.no += 1;
    if (summary.reports.length < 30) {
      summary.reports.push({
        deviceId: r.deviceId,
        deviceName: r.deviceName,
        deviceSoc: r.deviceSoc,
        deviceType: r.deviceType,
        works: r.works,
        updatedAt: r.updatedAt,
      });
    }
  }

  return res.json({
    success: true,
    report: {
      portId,
      deviceId,
      deviceName: device.model || device.name,
      deviceSoc: device.soc || '',
      deviceType: device.deviceType || 'phone',
      works,
    },
    summary,
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

// Metadata auto-resolution API (GitHub releases/tags & LaunchBox scraping)
function normalizeGitHubRepo(url) {
  const raw = String(url || '').trim();
  const match = raw.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^\s/]+)\/([^\s/#?]+)/i);
  if (!match) return null;
  const owner = match[1];
  let repo = match[2].replace(/\.git$/i, '');
  return { owner, repo, key: `${owner}/${repo}`.toLowerCase() };
}

function formatGitHubDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}, ${part('month')} ${Number(part('day'))}`;
}

async function resolveGitHubVersion(info, token = process.env.GITHUB_TOKEN) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'NAPL-Catalog/1.0 (https://github.com/fe2rr/Napl-prueba)'
  };
  if (token && typeof token === 'string' && token.trim()) {
    headers['Authorization'] = 'Bearer ' + token.trim();
  }
  const baseUrl = `https://api.github.com/repos/${info.owner}/${info.repo}`;

  try {
    const relRes = await fetch(`${baseUrl}/releases/latest`, { headers });
    if (relRes.status === 200) {
      const rel = await relRes.json();
      const version = String(rel.tag_name || rel.name || '').trim();
      if (version) {
        return {
          version,
          date: rel.published_at || rel.created_at || '',
          source: 'Release'
        };
      }
    }
  } catch (_) {}

  try {
    const tagsRes = await fetch(`${baseUrl}/tags?per_page=1`, { headers });
    if (tagsRes.ok) {
      const tags = await tagsRes.json();
      if (Array.isArray(tags) && tags.length && tags[0]?.name) {
        const version = String(tags[0].name).trim();
        let date = '';
        try {
          const repoRes = await fetch(baseUrl, { headers });
          if (repoRes.ok) {
            const repoData = await repoRes.json();
            date = repoData.pushed_at || '';
          }
        } catch (_) {}
        return { version, date, source: 'Tag' };
      }
    }
  } catch (_) {}

  return null;
}

function cleanLaunchBoxText(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|li|span|dd|dt)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveLaunchBoxMetadata(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NAPL/1.0)',
      'Accept': 'text/html'
    }
  });
  if (!res.ok) throw new Error(`LaunchBox HTTP ${res.status}`);
  const html = await res.text();

  let year = '';
  const dtDdMatch = html.match(/<dt[^>]*>\s*(?:Release Date|Release Year|Year)\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i);
  if (dtDdMatch) {
    const y = dtDdMatch[1].match(/\b(19\d{2}|20\d{2})\b/);
    if (y) year = y[1];
  }
  if (!year) {
    const legacy = html.match(/(?:Release Date|Release Year|Year)[\s\S]*?<td>([\s\S]*?)<\/td>/i);
    if (legacy) {
      const y = legacy[1].match(/\b(19\d{2}|20\d{2})\b/);
      if (y) year = y[1];
    }
  }

  let genre = '';
  const genreMatch = html.match(/<dt[^>]*>\s*(?:Genre|Genres)\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i);
  if (genreMatch) {
    genre = cleanLaunchBoxText(genreMatch[1]);
  }
  if (!genre) {
    const legacyGenre = html.match(/(?:Genre|Genres)[\s\S]*?<td>([\s\S]*?)<\/td>/i);
    if (legacyGenre) genre = cleanLaunchBoxText(legacyGenre[1]);
  }

  let description = '';
  const modernP = html.match(/<p class="mt-4 text-body-lg[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  if (modernP?.[1]) {
    description = cleanLaunchBoxText(modernP[1]);
  } else {
    const heading = /<h[1-6][^>]*>\s*Overview\s*<\/h[1-6]>/i.exec(html);
    if (heading) {
      const chunk = html.slice(heading.index, heading.index + 5000);
      const p = chunk.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
      if (p) description = cleanLaunchBoxText(p[1]);
    }
  }

  let coverUrl = '';
  const frontSection = html.match(/<h3[^>]*>Box\s*-\s*Front<\/h3>[\s\S]*?<img[^>]+src="([^">]+)"/i);
  if (frontSection?.[1] && /^https?:\/\//i.test(frontSection[1])) {
    coverUrl = frontSection[1];
  } else {
    const altFront = html.match(/<img[^>]+(?:alt|title)="[^"]*Box\s*-\s*Front[^"]*"[^>]+src="([^">]+)"/i);
    if (altFront?.[1] && /^https?:\/\//i.test(altFront[1])) {
      coverUrl = altFront[1];
    } else {
      const lbImg = html.match(/https:\/\/images\.launchbox-app\.com\/\/[a-f0-9-]+\.(?:jpg|jpeg|png|webp)/i) ||
                    html.match(/https:\/\/images\.launchbox-app\.com\/[a-f0-9-]+\.(?:jpg|jpeg|png|webp)/i);
      if (lbImg) coverUrl = lbImg[0];
    }
  }

  return { year, genre, description, coverUrl };
}

app.post(['/admin/resolve-metadata', '/api/admin/resolve-metadata'], async (req, res) => {
  const targetUrl = String(req.body?.url || '').trim();
  if (!targetUrl) {
    return res.status(400).json({ success: false, error: 'URL is required.' });
  }

  const gh = normalizeGitHubRepo(targetUrl);
  if (gh) {
    try {
      const ghData = await resolveGitHubVersion(gh);
      const formattedDate = ghData?.date ? formatGitHubDate(ghData.date) : '';
      return res.json({
        success: true,
        source: 'github',
        data: {
          developer: gh.owner,
          version: ghData?.version || '',
          lastUpdate: formattedDate,
          error: ghData?.error || null
        }
      });
    } catch (err) {
      return res.status(502).json({ success: false, error: err.message || 'GitHub resolution error' });
    }
  }

  if (/^https?:\/\/gamesdb\.launchbox-app\.com\/games\/details\//i.test(targetUrl)) {
    try {
      const metadata = await resolveLaunchBoxMetadata(targetUrl);
      return res.json({
        success: true,
        source: 'launchbox',
        data: metadata
      });
    } catch (err) {
      return res.status(422).json({ success: false, error: err.message || 'Could not fetch LaunchBox metadata.' });
    }
  }

  return res.status(400).json({ success: false, error: 'Enter a valid GitHub repository or LaunchBox URL.' });
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (/\.(html|css|js)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  })
);

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
