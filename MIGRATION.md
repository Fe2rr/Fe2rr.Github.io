# NAPL Infrastructure Migration — GitHub + Cloudflare Workers & D1 (Sin Tarjeta)

NAPL ejecuta el sitio público, el panel administrativo, el catálogo JSON, las portadas WebP pre-optimizadas, los resúmenes comunitarios periódicos y toda la automatización pesada en **GitHub**, y utiliza **Cloudflare Workers + D1 (`cloudflare-community/`, sin tarjeta de crédito)** como **único servicio externo** estrictamente para las interacciones comunitarias en tiempo real.

## Arquitectura Optimizada (`0` lecturas en visita pasiva, `<= 250` lecturas por visita interactiva)

1. **GitHub Pages + Repositorio de datos (`Fe2rr/NAPL-Data`)**
   - `deploy-pages.yml` empaqueta `public/` junto con `catalog.json`, `community-summary.json` y `assets/covers/*` desde `Fe2rr/NAPL-Data`.
   - En visitas pasivas (home, Spotlight, categorías), el navegador solo consume archivos estáticos en GitHub Pages (`0` llamadas al Worker, `0` lecturas D1).
2. **GitHub Actions (CORS-free, sin colas ni cron en Cloudflare)**
   - `.github/workflows/sync-catalog.yml` + `scripts/sync-catalog.mjs` + `lib/catalog-core.mjs`: sincroniza ports contra GitHub/GitLab/Play Store, optimiza portadas a WebP (`cwebp` + `wsrv.nl`) y publica `catalog.json` + `manifest.json`.
   - `.github/workflows/sync-community-summary.yml` + `scripts/sync-community-summary.mjs`: cada 30 minutos descarga `/community-snapshot`, actualiza `assets/data/community-summary.json` en `Fe2rr/NAPL-Data`, re-despliega Pages solo si hubo cambios y envía un resumen agrupado a `DISCORD_WEBHOOK_URL` con los reportes de enlaces pendientes (`/link-reports-pending` + `/ack`).
   - `.github/workflows/lookup-metadata.yml` + `scripts/lookup-metadata.mjs`: resuelve consultas bajo demanda de LaunchBox, Steam (`library_600x900` / SteamGridDB) y repositorios/Play Store.
3. **Panel Admin estático por Fine-grained PAT (`public/js/lib/github-admin.js`)**
   - Autentica al administrador con Fine-grained PAT guardado únicamente en `sessionStorage`, edita `private/catalog-state.json` + `public/assets/data/catalog.json` en `Fe2rr/NAPL-Data` y dispara `workflow_dispatch`.
4. **Único servicio comunitario externo: `cloudflare-community/` (Cloudflare Workers + D1)**
   - Ver guía completa de despliegue paso a paso en [`cloudflare-community/README.md`](cloudflare-community/README.md).
   - Opcional auto-alojado: [`community-server/README.md`](community-server/README.md) (Node 22 + SQLite WAL + Caddy para VPS).

## Pasos de corte a producción

1. Configura `NAPL_DATA_GITHUB_TOKEN` (Fine-grained PAT con `Contents: Read and write` sobre `Fe2rr/NAPL-Data`) en **Actions secrets** de `Fe2rr/Napl-prueba` y ejecuta `NAPL catalog sync`.
2. Despliega el Worker + D1 siguiendo [`cloudflare-community/README.md`](cloudflare-community/README.md) e importa tu respaldo de Supabase con `node cloudflare-community/export-to-d1-sql.mjs`.
3. Agrega los **Actions secrets** `NAPL_COMMUNITY_API_BASE` (`https://napl-community-api.<tu-subdominio>.workers.dev`) y `DISCORD_WEBHOOK_URL` en `Fe2rr/Napl-prueba`, luego ejecuta `NAPL community summary & Discord digest`.
4. Configura `DEFAULT_COMMUNITY_API_BASE` en `public/js/lib/config.js` (o `<meta name="napl-community-api" content="...">` en `public/index.html`).
5. Verifica `/health`, votos, popularidad, compatibilidad, digest a Discord y admin por PAT antes de dar de baja Supabase/Workers antiguos.
