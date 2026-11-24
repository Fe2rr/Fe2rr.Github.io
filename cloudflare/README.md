# NAPL API — Cloudflare Worker + GitHub JSON

## Arquitectura vigente (24 de noviembre de 2026)

El Worker `napl-admin-api` ya no utiliza Cloudflare D1. El catálogo operativo se guarda como JSON privado versionado en `Fe2rr/NAPL-Data`.

- `private/catalog-state.json`: fuente interna del catálogo, con metadatos de sincronización y estado de ports. No se publica en Pages.
- `public/assets/data/catalog.json`: proyección pública del catálogo, sin campos internos.
- `private/backups/d1-pre-migration-2026-11-24.json`: exportación íntegra de las tablas D1 anteriores (1000 juegos, 1249 ports, 28 plataformas, 96 logs y metadatos).
- Cloudflare Pages `napl-catalog` publica exclusivamente la carpeta `public`.
- El Worker valida la sesión y lee/escribe el JSON privado usando `CATALOG_DATA_GITHUB_TOKEN`.
- Los visitantes siguen consumiendo únicamente el JSON estático de Pages; no consultan el Worker ni GitHub.
- Supabase conserva los reportes, visitas, dispositivos y ratings; no se migraron.

## Worker y secretos

Worker: `napl-admin-api`  
URL: `https://napl-admin-api.federicoxastro.workers.dev`

Secretos conservados:
- `ADMIN_PASSWORD`: contraseña del panel.
- `SESSION_SECRET`: firma de sesiones.
- `GITHUB_TOKEN`: respaldo del JSON público en `Fe2rr/Napl-prueba`.
- `CATALOG_DATA_GITHUB_TOKEN`: acceso Contents Read and write limitado a `Fe2rr/NAPL-Data`.

Variables:
- `AUTO_PUBLISH_CRON = true`
- `CRON_BATCH_SIZE = 40`

Cron activo: `0 * * * *` (cada hora).

## Endpoints

- `GET /api/health`: verifica configuración y lectura del JSON privado; informa `storage: github-json` y `d1: false`.
- `POST /api/login` / `POST /api/logout`: sesión de administrador (Bearer token de 8 horas).
- `GET /api/catalog`: catálogo interno, estadísticas y últimos logs.
- `POST /api/games`, `PUT /api/games/:slug`, `DELETE /api/games/:slug`: CRUD sobre el JSON privado.
- `POST /api/ports/sync`: sincroniza un port individual.
- `POST /api/lookup/github`, `POST /api/lookup/source`, `POST /api/lookup/launchbox`: consulta fuentes.
- `POST /api/sync-github`: lote manual de sincronización.
- `POST /api/import-sheets`: importa desde Google Sheets al JSON privado.
- `POST /api/publish`: vuelve a publicar el JSON público y el respaldo de Napl-prueba.
- `GET /api/public-catalog`: redirige al JSON público de Pages para compatibilidad.

## Restauración

La exportación completa anterior a la migración está en `Fe2rr/NAPL-Data/private/backups/d1-pre-migration-2026-11-24.json`. El estado operativo inicial migrado está en `private/catalog-state.json`. Ambos archivos están fuera de `public/` y no son servidos por Cloudflare Pages.

La base D1 anterior quedó desconectada del Worker para permitir una reversión controlada; no eliminarla hasta validar el panel y conservar el backup fuera de línea.
