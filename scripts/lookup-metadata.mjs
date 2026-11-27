import fs from "node:fs/promises";
import path from "node:path";
import {
  inspectLaunchboxUrl,
  inspectSteamApp,
  inspectPortSource,
} from "../lib/catalog-core.mjs";
import {
  optimizeSingleCover,
  readCoverManifest,
  writeCoverManifest,
} from "../lib/cover-optimizer.mjs";

const dataDir = path.resolve(process.env.NAPL_DATA_DIR || "data");
const mode = String(process.env.LOOKUP_MODE || "").trim().toLowerCase();
const url = String(process.env.LOOKUP_URL || "").trim();
const rawRequestId = String(process.env.LOOKUP_REQUEST_ID || "").trim();
const requestId = /^[a-zA-Z0-9_-]{4,80}$/.test(rawRequestId) ? rawRequestId : "";

const env = {
  GITHUB_TOKEN:
    process.env.GITHUB_TOKEN ||
    process.env.NAPL_DATA_GITHUB_TOKEN ||
    "",
  GITLAB_TOKEN: process.env.GITLAB_TOKEN || "",
  STEAMGRIDDB_API_KEY: process.env.STEAMGRIDDB_API_KEY || "",
};

const coversDir = path.join(dataDir, "public", "assets", "covers");
const resultsDir = path.join(dataDir, "private", "lookup-results");

async function pruneOldResults() {
  try {
    const files = await fs.readdir(resultsDir);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const fullPath = path.join(resultsDir, file);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) {
        await fs.unlink(fullPath).catch(() => {});
      }
    }
  } catch {
    // Ignore when directory doesn't exist yet
  }
}

async function inspectItchPage(rawUrl) {
  let target;
  try { target = new URL(rawUrl); } catch { throw new Error("URL de itch.io inválida."); }
  if (target.protocol !== "https:" || !(target.hostname === "itch.io" || target.hostname.endsWith(".itch.io"))) {
    throw new Error("Solo se permiten páginas HTTPS de itch.io.");
  }
  const response = await fetch(target.toString(), {headers:{"User-Agent":"Mozilla/5.0 NAPL metadata lookup","Accept":"text/html"}});
  if (!response.ok) throw new Error("itch.io respondió HTTP " + response.status + ".");
  const html = await response.text();
  const readMeta = (pattern) => {
    const match = html.match(pattern);
    return match ? match[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : "";
  };
  const name = readMeta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim();
  if (!name) throw new Error("No se pudo obtener el título de itch.io.");
  return {
    name,
    coverUrl: readMeta(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
    description: readMeta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    itchUrl: target.toString()
  };
}
let output = null;
let fatalError = null;
");
    const patterns = [
      new RegExp('<meta[^>]*'+attr+'=["\\']'+escaped+'["\\'][^>]*content=["\\']([^"\\']*)["\\']','i'),
      new RegExp('<meta[^>]*content=["\\']([^"\\']*)["\\'][^>]*'+attr+'=["\\']'+escaped+'["\\']','i')
    ];
    for (const pattern of patterns) { const match=html.match(pattern); if(match) return match[1].replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim(); }
    return "";
  };
  const name = meta("og:title") || (html.match(/<title[^>]*>([\s\S]*?)<\\/title>/i)?.[1] || "").replace(/<[^>]+>/g,"").trim();
  if (!name) throw new Error("No se pudo obtener el título de itch.io.");
  return {name,coverUrl:meta("og:image"),description:meta("og:description","name"),itchUrl:target.toString()};
}
let output = null;
let fatalError = null;

try {
  if (!mode || !url) {
    throw new Error("Both LOOKUP_MODE and LOOKUP_URL are required.");
  }

  let data;
  if (mode === "launchbox") {
    data = await inspectLaunchboxUrl(url);
  } else if (mode === "steam") {
    data = await inspectSteamApp(url, env);
  } else if (mode === "itch") {
    data = await inspectItchPage(url);
  } else if (mode === "port_source" || mode === "source") {
    data = await inspectPortSource(url, env);
  } else if (mode === "optimize_cover") {
    const res = await optimizeSingleCover(url, coversDir);
    if (res.status === "failed") {
      throw new Error(res.error || "Cover optimization failed.");
    }
    data = {
      coverUrl: url,
      staticCoverPath: res.relativePath,
      status: res.status,
    };
  } else {
    throw new Error(`Unsupported LOOKUP_MODE: ${mode}`);
  }

  // Pre-optimize any discovered cover image right away into NAPL-Data
  if (data && typeof data.coverUrl === "string" && data.coverUrl.trim()) {
    const coverRes = await optimizeSingleCover(data.coverUrl, coversDir);
    if (coverRes.relativePath) {
      data.staticCoverPath = coverRes.relativePath;
      const manifest = await readCoverManifest(coversDir);
      manifest.covers[data.coverUrl.trim()] = coverRes.relativePath;
      await writeCoverManifest(coversDir, manifest.covers);
    }
  }

  output = {
    ok: true,
    mode,
    url,
    requestId,
    generatedAt: new Date().toISOString(),
    data,
  };
} catch (err) {
  fatalError = err;
  output = {
    ok: false,
    mode,
    url,
    requestId,
    generatedAt: new Date().toISOString(),
    error: err?.message || "Lookup failed.",
  };
}

if (requestId) {
  await fs.mkdir(resultsDir, { recursive: true });
  await pruneOldResults();
  await fs.writeFile(
    path.join(resultsDir, `${requestId}.json`),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );
}

console.log(JSON.stringify(output, null, 2));

if (fatalError && !requestId) {
  process.exitCode = 1;
}
