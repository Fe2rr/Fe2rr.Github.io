# NAPL Infrastructure Migration — GitHub + Cloudflare Workers & D1 (Sin Tarjeta)

NAPL ejecuta el sitio público, el panel administrativo, el catálogo JSON, las portadas WebP pre-optimizadas, los resúmenes comunitarios periódicos y toda la automatización pesada en **GitHub**, y utiliza **Cloudflare Workers + D1 (`cloudflare-community/`, sin tarjeta de crédito)** como **único servicio externo** estrictamente para las interacciones comunitarias en tiempo real.

## Arquitectura Optimizada (`0` lecturas en visita pasiva, `<= 250` lecturas por visita interactiva)

1. **GitHub Pages + Repositorio de datos (`Fe2rr/NAPL-Data`)**
   - `deploy-pages.yml` empaqueta `public/` junto con `catalog.json`, `community-summary.json` y `assets/covers/*` desde `Fe2rr/NAPL-Data`.
   - En visitas pasivas (home, Spotlight, categorías), el navegador solo consume archivos estáticos en GitHub Pages (`0` llamadas al Worker, `0` lecturas D1).
2. **GitHub Actions (CORS-free, sin colas ni cron en Cloudflare)**
   - `.github/workflows/sync-catalog.yml` + `scripts/sync-catalog.mjs` + `lib/catalog-core.mjs`: sincroniza ports contra GitHub/GitLab/Play Store, optimiza portadas a WebP (`cwebp` + `wsrv.nl`) y publica `catalog.json` + `manifest.json`.
   - `.github/workflows/sync-community-summary.yml` + `scripts/sync-community-summary.mjs`: cada hora descarga `/community-snapshot`, actualiza `assets/data/community-summary.json` en `Fe2rr/NAPL-Data`, re-despliega Pages solo si hubo cambios y envía un resumen agrupado a `DISCORD_WEBHOOK_URL` con los reportes de enlaces pendientes (`/link-reports-pending` + `/ack`).
   - `.github/workflows/lookup-metadata.yml` + `scripts/lookup-metadata.mjs`: resuelve consultas bajo demanda de LaunchBox, Steam (`library_600x900` / SteamGridDB) y repositorios/Play Store.
3. **Panel Admin estático por Fine-grained PAT (`public/js/lib/github-admin.js`)**
   - Autentica al administrador con Fine-grained PAT guardado únicamente en `sessionStorage`, edita `private/catalog-state.json` + `public/assets/data/catalog.json` en `Fe2rr/NAPL-Data` y dispara `workflow_dispatch`.
4. **Único servicio comunitario externo: `cloudflare-community/` (Cloudflare Workers + D1)**
   - Ver guía completa de despliegue paso a paso en [`cloudflare-community/README.md`](cloudflare-community/README.md).
   - Opcional auto-alojado: [`community-server/README.md`](community-server/README.md) (Node 22 + SQLite WAL + Caddy para VPS).

## Estado actual y pasos pendientes para producción

### Completado en `Fe2rr/Napl-prueba`

1. `NAPL_DATA_GITHUB_TOKEN` y el acceso de escritura a `Fe2rr/NAPL-Data` están verificados.
2. `NAPL catalog sync` terminó correctamente con `Import Sheets=false`: 1.262 ports totales, 869 comprobados, 393 omitidos, 9 actualizados y 1 error de origen externo (`Repository access blocked`). El commit de datos fue `19f1772`.
3. Worker `napl-community-api` y D1 `napl-community` están desplegados. El esquema, índices y conteos de las tablas fueron verificados directamente en D1.
4. El binding `REPORTER_HASH_SECRET` existe. Su valor no es legible desde la API; confirmar que coincide con el secreto original de Supabase antes de retirar ese servicio.
5. Los Actions secrets `NAPL_COMMUNITY_API_BASE` y `NAPL_DATA_GITHUB_TOKEN` están siendo reconocidos. La URL comunitaria está configurada en `public/index.html` y `public/js/lib/config.js`.
6. El frontend carga ratings, popularidad y resumen comunitario desde JSON estático; las visitas pasivas no consultan D1. Las consultas interactivas tienen límites por endpoint.
7. La sincronización comunitaria trata HTTP 429 por cooldown como una omisión controlada, no como fallo del workflow.

### Pendiente antes de migrar producción

1. Confirmar que el deploy de GitHub Pages posterior al catálogo finalizó correctamente.
2. Probar desde el sitio `/health`, un voto, registro de popularidad, consulta de compatibilidad y envío de reporte de enlace.
3. Confirmar el digest de Discord si `DISCORD_WEBHOOK_URL` está configurado.
4. Confirmar que `REPORTER_HASH_SECRET` conserva el valor original de Supabase.
5. Mantener Supabase y los Workers antiguos activos hasta completar estas pruebas. No modificar `Fe2rr/Fe2rr.Github.io` ni su rama `main` hasta validar el reemplazo.
