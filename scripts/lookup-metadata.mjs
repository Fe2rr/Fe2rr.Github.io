import fs from "node:fs/promises";
import path from "node:path";
import {
  inspectLaunchboxUrl,
  inspectSteamApp,
  inspectItchPage,
  inspectPortSource,
} from "../lib/catalog-core.mjs";

const dataDir = path.resolve(process.env.NAPL_DATA_DIR || "data");
const dataRepo = String(process.env.NAPL_DATA_REPO || "Fe2rr/NAPL-Data").trim();
const dataBranch = String(process.env.NAPL_DATA_BRANCH || "main").trim();
const writeViaApi = process.env.NAPL_WRITE_VIA_API === "1";

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

async function writeResultViaGithubApi(resultPath, contentText) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("Missing GITHUB_TOKEN for API result commit.");
  }
  const apiUrl = `https://api.github.com/repos/${dataRepo}/contents/${resultPath}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "NAPL-Metadata-Lookup/1.0",
  };
  const encoded = Buffer.from(contentText, "utf8").toString("base64");
  const commitMsg = `NAPL: metadata lookup (${mode || "lookup"})`;

  let res = await fetch(apiUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: commitMsg,
      content: encoded,
      branch: dataBranch,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 422 || res.status === 409) {
    const existingRes = await fetch(
      `${apiUrl}?ref=${encodeURIComponent(dataBranch)}`,
      { headers, signal: AbortSignal.timeout(5_000) }
    );
    const existing = await existingRes.json().catch(() => ({}));
    if (existing?.sha) {
      res = await fetch(apiUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: commitMsg,
          content: encoded,
          branch: dataBranch,
          sha: existing.sha,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`GitHub Contents API HTTP ${res.status}: ${errText}`);
  }
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
    const { optimizeSingleCover, readCoverManifest, writeCoverManifest } =
      await import("../lib/cover-optimizer.mjs");
    const res = await optimizeSingleCover(url, coversDir);
    if (res.status === "failed") {
      throw new Error(res.error || "Cover optimization failed.");
    }
    if (res.relativePath) {
      const manifest = await readCoverManifest(coversDir);
      const cleanCoverUrl = url.trim();
      if (manifest.covers[cleanCoverUrl] !== res.relativePath) {
        manifest.covers[cleanCoverUrl] = res.relativePath;
        await writeCoverManifest(coversDir, manifest.covers);
      }
    }
    data = {
      coverUrl: url,
      staticCoverPath: res.relativePath,
      status: res.status,
    };
  } else {
    throw new Error(`Unsupported LOOKUP_MODE: ${mode}`);
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

const serialized = JSON.stringify(output, null, 2) + "\n";

if (requestId) {
  if (writeViaApi && env.GITHUB_TOKEN && mode !== "optimize_cover") {
    await writeResultViaGithubApi(`private/lookup-results/${requestId}.json`, serialized);
  } else {
    await fs.mkdir(resultsDir, { recursive: true });
    await pruneOldResults();
    await fs.writeFile(
      path.join(resultsDir, `${requestId}.json`),
      serialized,
      "utf8"
    );
  }
}

console.log(serialized);

if (fatalError && !requestId) {
  process.exitCode = 1;
}
