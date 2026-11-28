import fs from "node:fs/promises";
import path from "node:path";
import {
  SHEET_URL,
  csvParse,
  fromRows,
  mergeImportedCatalog,
  toPublicCatalog,
  syncSinglePortWithSource,
} from "../lib/catalog-core.mjs";
import {
  optimizeSingleCover,
  writeCoverManifest,
} from "../lib/cover-optimizer.mjs";

const dataDir = path.resolve(process.env.NAPL_DATA_DIR || "data");
const privateStatePath = path.join(dataDir, "private", "catalog-state.json");
const publicCatalogPath = path.join(dataDir, "public", "assets", "data", "catalog.json");
const coversDir = path.join(dataDir, "public", "assets", "covers");

const IMPORT_SHEETS = String(process.env.IMPORT_SHEETS || "false") === "true";
const OPTIMIZE_COVERS = String(process.env.OPTIMIZE_COVERS || "true") !== "false";
const SYNC_CONCURRENCY = Math.min(
  Math.max(Number(process.env.SYNC_CONCURRENCY || 6) || 6, 1),
  12
);

const githubEnv = {
  GITHUB_TOKEN:
    process.env.GITHUB_TOKEN ||
    process.env.NAPL_DATA_GITHUB_TOKEN ||
    process.env.CATALOG_DATA_GITHUB_TOKEN ||
    "",
  GITLAB_TOKEN: process.env.GITLAB_TOKEN || "",
  STEAMGRIDDB_API_KEY: process.env.STEAMGRIDDB_API_KEY || "",
};

async function retry(fn, label, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.warn(`${label} attempt ${i}/${attempts}: ${err.message}`);
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, 1200 * 2 ** (i - 1)));
      }
    }
  }
  throw lastError;
}

async function readState() {
  try {
    const raw = await fs.readFile(privateStatePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.catalog && Array.isArray(parsed.catalog.games)) {
      return {
        version: Number(parsed.version) || 1,
        catalog: parsed.catalog,
        syncCursor: Number(parsed.syncCursor) || 0,
        syncLog: Array.isArray(parsed.syncLog) ? parsed.syncLog : [],
        lastSync: parsed.lastSync && typeof parsed.lastSync === "object" ? parsed.lastSync : null,
      };
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw new Error(`Could not read ${privateStatePath}: ${err.message}`);
    }
  }

  try {
    const rawPublic = await fs.readFile(publicCatalogPath, "utf8");
    const pub = JSON.parse(rawPublic);
    if (pub && Array.isArray(pub.games)) {
      return {
        version: 1,
        catalog: pub,
        syncCursor: 0,
        syncLog: [],
        lastSync: null,
      };
    }
  } catch {
    // Fall through
  }

  throw new Error(
    `Missing catalog state in ${privateStatePath} and ${publicCatalogPath}.`
  );
}

const state = await readState();
console.log(
  `Loaded catalog state: ${state.catalog.games.length} games.`
);

if (IMPORT_SHEETS) {
  console.log("Fetching Google Sheets CSV...");
  const csvRes = await retry(async () => {
    const r = await fetch(SHEET_URL, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Google Sheets HTTP ${r.status}`);
    return r.text();
  }, "Google Sheets CSV download");
  const rows = csvParse(csvRes);
  if (!rows.length) {
    throw new Error("Google Sheets CSV returned 0 rows.");
  }
  const imported = fromRows(rows);
  const { imported: merged, summary } = mergeImportedCatalog(state, imported);
  state.catalog = merged;
  console.log("Sheets import summary:", JSON.stringify(summary));
} else {
  console.log("Google Sheets import skipped (safe default).");
}

// Collect all ports cleanly for bounded parallel sync
const syncTargets = [];
for (const game of state.catalog.games || []) {
  for (const port of game.ports || []) {
    if (!port) continue;
    if (!port.gameSlug && game.slug) {
      port.gameSlug = game.slug;
    }
    syncTargets.push(port);
  }
}

let cursor = 0;
let checkedCount = 0;
let skippedCount = 0;
let updatedCount = 0;
let errorCount = 0;
const syncEntries = [];
const syncResults = [];

async function syncWorker() {
  while (cursor < syncTargets.length) {
    const port = syncTargets[cursor++];
    try {
      const result = await retry(
        () => syncSinglePortWithSource(githubEnv, port),
        `sync ${port.portId || port.project || "port"}`,
        2
      );
      syncResults.push({
        portId: port.portId || "",
        gameSlug: port.gameSlug || "",
        project: port.project || "",
        status: result.status || "checked",
        changed: Boolean(result.changed),
        message: result.message || "",
      });
      if (result.status === "skipped") {
        skippedCount++;
      } else {
        checkedCount++;
        if (result.changed) {
          updatedCount++;
        }
        if (result.status === "down" || result.changed) {
          syncEntries.push({
            at: new Date().toISOString(),
            ...result,
          });
        }
      }
    } catch (err) {
      checkedCount++;
      errorCount++;
      console.warn(
        `Sync error [${port.portId || port.project}]: ${err.message}`
      );
      const failedResult = {
        portId: port.portId || "",
        gameSlug: port.gameSlug || "",
        project: port.project || "",
        status: "error",
        changed: false,
        message: err.message,
      };
      syncResults.push(failedResult);
      syncEntries.push({
        at: new Date().toISOString(),
        ...failedResult,
      });
    }
  }
}

await Promise.all(
  Array.from({ length: SYNC_CONCURRENCY }, () => syncWorker())
);

if (updatedCount > 0 || IMPORT_SHEETS) {
  state.catalog.updatedAt = new Date().toISOString();
}
state.syncCursor = 0;
state.lastSync = {
  at: new Date().toISOString(),
  total: syncTargets.length,
  checked: checkedCount,
  skipped: skippedCount,
  updated: updatedCount,
  errors: errorCount,
  ports: syncResults,
};
if (syncEntries.length > 0) {
  state.syncLog = [...syncEntries.slice(0, 40), ...(state.syncLog || [])].slice(
    0,
    80
  );
}

await fs.mkdir(path.dirname(privateStatePath), { recursive: true });
await fs.writeFile(
  privateStatePath,
  JSON.stringify(state, null, 2) + "\n",
  "utf8"
);

const publicCatalog = toPublicCatalog(state.catalog);
await fs.mkdir(path.dirname(publicCatalogPath), { recursive: true });
await fs.writeFile(
  publicCatalogPath,
  JSON.stringify(publicCatalog) + "\n",
  "utf8"
);

console.log(
  `Sync finished: totalPorts=${syncTargets.length}, checked=${checkedCount}, skipped=${skippedCount}, updated=${updatedCount}, errors=${errorCount}`
);

if (OPTIMIZE_COVERS) {
  const sources = new Set();
  for (const game of publicCatalog.games || []) {
    if (game.coverUrl) sources.add(String(game.coverUrl).trim());
    for (const port of game.ports || []) {
      if (port.coverUrl) sources.add(String(port.coverUrl).trim());
    }
  }

  await fs.mkdir(coversDir, { recursive: true });
  const coverQueue = [...sources].filter(Boolean);
  let coverCursor = 0;
  const covers = {};
  const activeFilenames = new Set();
  let generated = 0;
  let cached = 0;
  let ignored = 0;
  let failed = 0;

  async function coverWorker() {
    while (coverCursor < coverQueue.length) {
      const source = coverQueue[coverCursor++];
      const res = await optimizeSingleCover(source, coversDir);
      if (res.status === "generated") {
        generated++;
        covers[source] = res.relativePath;
        activeFilenames.add(res.filename);
      } else if (res.status === "cached") {
        cached++;
        covers[source] = res.relativePath;
        activeFilenames.add(res.filename);
      } else if (res.status === "ignored") {
        ignored++;
      } else {
        failed++;
        console.warn(`Cover optimization skipped: ${source} (${res.error})`);
      }
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => coverWorker()));
  await writeCoverManifest(coversDir, covers);

  // Prune orphaned .webp files only when a healthy catalog cover set was processed
  let pruned = 0;
  if (sources.size >= 50 && activeFilenames.size > 0) {
    const existingFiles = await fs.readdir(coversDir);
    for (const file of existingFiles) {
      if (file.endsWith(".webp") && !activeFilenames.has(file)) {
        await fs.unlink(path.join(coversDir, file)).catch(() => {});
        pruned++;
      }
    }
  }

  console.log(
    `Cover pipeline: ${generated} generated, ${cached} cached, ${ignored} skipped-host, ${failed} failed, ${pruned} pruned (${sources.size} source URLs).`
  );
}

if (errorCount > 0) {
  console.warn("Sync completed with some upstream source errors; check logs above.");
}
