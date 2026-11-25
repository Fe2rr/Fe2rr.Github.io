const ALLOWED_HOSTS = new Set(["images.launchbox-app.com", "gamesdb-images.launchbox.gg"]);
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function allowedSource(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.username || url.password || url.port) return null;
  url.protocol = "https:";
  return url;
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
    }
    if (requestUrl.pathname === "/health") {
      return json({ ok: true, service: "napl-image-optimizer", imagesBinding: Boolean(env.IMAGES) });
    }
    if (requestUrl.pathname !== "/image") return new Response("Not found", { status: 404 });

    const source = allowedSource(requestUrl.searchParams.get("url") || "");
    if (!source) return json({ error: "Unsupported image source" }, 400);

    const widthRaw = Number(requestUrl.searchParams.get("w") || 180);
    const width = [160, 180, 200, 240].includes(widthRaw) ? widthRaw : 180;

    let origin;
    try {
      origin = await fetch(source.toString(), {
        headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
        redirect: "follow"
      });
    } catch {
      return json({ error: "Image source unavailable" }, 502);
    }

    if (!origin.ok || !origin.body) {
      return json({ error: "Image source returned an error", upstreamStatus: origin.status }, 502);
    }

    let finalUrl;
    try { finalUrl = new URL(origin.url || source.href); } catch { return json({ error: "Invalid image redirect" }, 502); }
    if (finalUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(finalUrl.hostname.toLowerCase())) {
      return json({ error: "Image redirect rejected" }, 403);
    }

    const contentType = (origin.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return json({ error: "Source is not an image" }, 415);
    const contentLength = Number(origin.headers.get("content-length") || 0);
    if (contentLength > MAX_SOURCE_BYTES) return json({ error: "Image exceeds 20 MB limit" }, 413);

    try {
      const transformed = await env.IMAGES.input(origin.body)
        .transform({ width, fit: "scale-down" })
        .output({ format: "image/webp", quality: 74 });

      return transformed.response({
        headers: {
          "cache-control": "public, max-age=2592000, s-maxage=31536000, stale-while-revalidate=86400",
          "x-content-type-options": "nosniff",
          "access-control-allow-origin": "*"
        }
      });
    } catch (error) {
      console.error("image transformation failed", { message: String(error?.message || error) });
      return json({ error: "Image transformation failed" }, 502);
    }
  }
};