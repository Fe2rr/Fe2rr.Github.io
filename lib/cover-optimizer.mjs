import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OPTIMIZABLE_COVER_HOSTS = new Set([
  "images.launchbox-app.com",
  "gamesdb-images.launchbox.gg",
  "shared.fastly.steamstatic.com",
  "shared.akamai.steamstatic.com",
  "cdn.cloudflare.steamstatic.com",
  "cdn.akamai.steamstatic.com",
  "steamcdn-a.akamaihd.net",
  "img.itch.zone",
  "itch.zone",
  "static.itch.io",
  "cdn2.steamgriddb.com",
]);

let cwebpAvailablePromise = null;
async function hasCwebp() {
  if (!cwebpAvailablePromise) {
    cwebpAvailablePromise = execFileAsync("cwebp", ["-version"], {
      timeout: 3000,
    })
      .then(() => true)
      .catch(() => false);
  }
  return cwebpAvailablePromise;
}

export function isOptimizableCoverUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      OPTIMIZABLE_COVER_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function getCoverFilename(sourceUrl) {
  return (
    createHash("sha256").update(String(sourceUrl).trim()).digest("hex").slice(0, 24) +
    ".webp"
  );
}

function isLikelyWebp(bytes) {
  return (
    bytes.length >= 16 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

async function convertWithCwebp(sourceBytes, width = 240, quality = 82) {
  const tmpId = createHash("sha256")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 12);
  const inPath = path.join(os.tmpdir(), `napl-in-${tmpId}`);
  const outPath = path.join(os.tmpdir(), `napl-out-${tmpId}.webp`);
  try {
    await fs.writeFile(inPath, sourceBytes);
    await execFileAsync(
      "cwebp",
      ["-quiet", "-q", String(quality), "-resize", String(width), "0", inPath, "-o", outPath],
      { timeout: 15000 }
    );
    const outBytes = await fs.readFile(outPath);
    if (!isLikelyWebp(outBytes) || outBytes.length < 256) {
      throw new Error("cwebp produced invalid WebP output");
    }
    return outBytes;
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}

async function fetchOriginalBytes(sourceUrl) {
  const res = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "NAPL-Cover-Optimizer/2.0",
      Accept: "image/webp,image/png,image/jpeg,image/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Source image HTTP ${res.status}`);
  }
  const type = String(res.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("image/")) {
    throw new Error(`Source did not return an image (${type || "unknown"})`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 256) {
    throw new Error("Source image is unexpectedly small");
  }
  return bytes;
}

async function fetchViaWsrv(sourceUrl, width = 240, quality = 82) {
  const u = new URL("https://wsrv.nl/");
  u.searchParams.set("url", sourceUrl);
  u.searchParams.set("output", "webp");
  u.searchParams.set("w", String(width));
  u.searchParams.set("q", String(quality));
  const res = await fetch(u, {
    headers: { Accept: "image/webp,image/*;q=0.8" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`wsrv.nl HTTP ${res.status}`);
  const type = String(res.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("image/")) {
    throw new Error("wsrv.nl did not return an image");
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 256) {
    throw new Error("Optimized image is unexpectedly small");
  }
  return bytes;
}

export async function optimizeSingleCover(
  rawSource,
  coversDir,
  { width = 240, quality = 82, useLocalCwebp } = {}
) {
  const source = String(rawSource || "").trim();
  if (!isOptimizableCoverUrl(source)) {
    return { status: "ignored", source, filename: "", relativePath: "" };
  }

  const filename = getCoverFilename(source);
  const targetFile = path.join(coversDir, filename);
  const relativePath = `assets/covers/${filename}`;

  try {
    const stat = await fs.stat(targetFile);
    if (stat.size >= 256) {
      return { status: "cached", source, filename, relativePath };
    }
  } catch {
    // Not cached yet
  }

  const canUseCwebp =
    typeof useLocalCwebp === "boolean" ? useLocalCwebp : await hasCwebp();

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let webpBytes = null;
      if (canUseCwebp) {
        try {
          const origBytes = await fetchOriginalBytes(source);
          webpBytes = await convertWithCwebp(origBytes, width, quality);
        } catch {
          // Fallback to wsrv.nl if format (e.g., AVIF/GIF) isn't supported by cwebp
          webpBytes = null;
        }
      }
      if (!webpBytes) {
        webpBytes = await fetchViaWsrv(source, width, quality);
      }
      await fs.mkdir(coversDir, { recursive: true });
      await fs.writeFile(targetFile, webpBytes);
      return { status: "generated", source, filename, relativePath };
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  return {
    status: "failed",
    source,
    filename,
    relativePath: "",
    error: lastError?.message || "Cover optimization failed",
  };
}

export async function readCoverManifest(coversDir) {
  const manifestPath = path.join(coversDir, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.covers === "object" && !Array.isArray(parsed.covers)) {
      return parsed;
    }
  } catch {
    // Missing or invalid manifest
  }
  return { version: 1, generatedAt: "", covers: {} };
}

export async function writeCoverManifest(coversDir, coversMap) {
  await fs.mkdir(coversDir, { recursive: true });
  const sortedEntries = Object.entries(coversMap).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    covers: Object.fromEntries(sortedEntries),
  };
  await fs.writeFile(
    path.join(coversDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
  return manifest;
}
