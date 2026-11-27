# NAPL Infrastructure Migration — GitHub + 1 Único Servicio Externo

NAPL concentra el sitio público, el panel administrativo, el catálogo JSON, las portadas WebP pre-optimizadas y toda la automatización pesada en **GitHub**, y utiliza **exactamente 1 servicio externo** únicamente para las métricas y reportes comunitarios anónimos (`/ratings`, `/popularity`, `/compatibility`, `/report-link`).

## Opciones disponibles para el único servicio comunitario

1. **Opción recomendada sin tarjeta de crédito: `deno-community/` (Deno Deploy + Deno KV)**
   - **Sin tarjeta de crédito**, **sin pausas por inactividad** y **sin topes diarios** (1M requests/mes, 20 GiB egress/mes, 1M lecturas KV/mes con caché en memoria + resúmenes particionados).
   - Se despliega directo desde GitHub con entrypoint `deno-community/main.ts` y raíz `/` (ver [`deno-community/README.md`](deno-community/README.md)).
2. **Opción alternativa auto-alojada / VPS: `community-server/` (Node.js 22 + SQLite WAL + Caddy)**
   - Pensado para **Oracle Cloud Always Free**, **Serv00** o cualquier VPS económico con Docker/systemd (`community-server/README.md`).

## Arquitectura en GitHub

1. **GitHub Pages + Repositorio de datos (`Fe2rr/NAPL-Data`)**
   - `deploy-pages.yml` empaqueta el sitio público desde `public/` e incluye automáticamente `catalog.json` y `public/assets/covers/*` desde `Fe2rr/NAPL-Data` (cuando `NAPL_DATA_GITHUB_TOKEN` está configurado).
2. **GitHub Actions (CORS-free, sin Workers ni Colas)**
   - `.github/workflows/sync-catalog.yml` + `scripts/sync-catalog.mjs` + `lib/catalog-core.mjs`: sincroniza todos los ports contra GitHub/GitLab/Play Store, optimiza portadas a WebP estático (`cwebp` local con fallback `wsrv.nl`), publica `catalog.json` + `manifest.json` en `Fe2rr/NAPL-Data` y dispara el redeploy de GitHub Pages.
   - `.github/workflows/lookup-metadata.yml` + `scripts/lookup-metadata.mjs`: resuelve consultas bajo demanda de LaunchBox, Steam (`library_600x900` / SteamGridDB) y repositorios/Play Store sin CORS.
3. **Panel Admin estático por Fine-grained PAT (`public/js/lib/github-admin.js`)**
   - Autentica al administrador con un Fine-grained PAT guardado únicamente en `sessionStorage`, lee y commitea atómicamente `private/catalog-state.json` + `public/assets/data/catalog.json` y dispara `workflow_dispatch` para sync/Sheets/lookup.

## Pasos de corte a producción

1. Configura `NAPL_DATA_GITHUB_TOKEN` (Fine-grained PAT con `Contents: Read and write` sobre `Fe2rr/NAPL-Data`) en **Actions secrets** de `Fe2rr/Napl-prueba` y ejecuta `NAPL catalog sync` con `import_sheets=false`.
2. Exporta tus datos actuales de Supabase (`SUPABASE_DB_URL="..." node scripts/export-supabase.mjs`) e impórtalos en **Deno Deploy** (`/admin-import`) o en **SQLite** (`community-server/import-from-supabase.mjs`).
3. Configura el dominio HTTPS de tu único servicio comunitario en `public/js/lib/config.js` (`DEFAULT_COMMUNITY_API_BASE`) o vía `<meta name="napl-community-api" content="https://tu-proyecto.deno.dev">` en `public/index.html`.
4. Verifica `/health`, votos, popularidad, compatibilidad y admin por PAT antes de dar de baja Cloudflare Workers/Images y Supabase.
