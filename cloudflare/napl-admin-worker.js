// Minimal compatibility shim for the archived v5 frontend.
// Catalog data and administration now live on GitHub Pages / GitHub Actions.
const CATALOG_URL = "https://fe2rr.github.io/assets/data/catalog.json";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "public, max-age=30",
    };

    if (url.pathname !== "/api/public-catalog") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, OPTIONS" },
      });
    }

    return new Response(null, {
      status: 302,
      headers: { ...headers, Location: CATALOG_URL },
    });
  },
};
