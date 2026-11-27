# NAPL Infrastructure Migration — GitHub + 1 Único Servicio Externo

NAPL concentra el sitio público, el panel administrativo, el catálogo JSON, las portadas WebP pre-optimizadas y toda la automatización pesada en **GitHub**, y utiliza **exactamente 1 servicio externo** (`community-server/`: Node.js 22 + SQLite WAL + Caddy HTTPS) únicamente para las escrituras y consultas comunitarias anónimas (`/ratings`, `/popularity`, `/compatibility`, `/report-link`).

## Arquitectura implementada

1. **GitHub Pages + Repositorio de datos (`Fe2rr/NAPL-Data`)**
   - `deploy-pages.yml` empaqueta el sitio público desde `public/` e incluye automáticamente `catalog.json` y `public/assets/covers/*` desde `Fe2rr/NAPL-Data` (cuando el secret `NAPL_DATA_GITHUB_TOKEN` está configurado), sirviéndolos desde el mismo origen sin Workers ni proxies.
2. **GitHub Actions (CORS-free, sin Workers ni Colas)**
   - `.github/workflows/sync-catalog.yml` + `scripts/sync-catalog.mjs` + `lib/catalog-core.mjs`: sincroniza todos los ports contra GitHub/GitLab/Play Store con concurrencia acotada, optimiza portadas nuevas a WebP estático (240px vía `cwebp` local o fallback `wsrv.nl`), actualiza `private/catalog-state.json`, `public/assets/data/catalog.json` y `public/assets/covers/manifest.json` en `Fe2rr/NAPL-Data`, y dispara el redeploy de GitHub Pages si hubo cambios.
   - `.github/workflows/lookup-metadata.yml` + `scripts/lookup-metadata.mjs`: resuelve consultas bajo demanda de LaunchBox, Steam (verticales `library_600x900` / SteamGridDB) y repositorios/Play Store sin problemas de CORS y pre-optimiza la portada descubierta.
3. **Panel Admin estático por Fine-grained PAT (`public/js/lib/github-admin.js`)**
   - El administrador inicia sesión ingresando un GitHub Fine-grained PAT (almacenado solo en `sessionStorage`).
   - Valida permisos de escritura en `Fe2rr/NAPL-Data`, lee y edita `private/catalog-state.json` mediante commits atómicos (Git Data API) junto a `public/assets/data/catalog.json`, y dispara `workflow_dispatch` para sync/Sheets/lookup con seguimiento de progreso.
4. **Único servicio externo comunitario (`community-server/`)**
   - Microservidor Node.js 22 sin dependencias externas con SQLite WAL (`schema.sql`), CORS estricto, queries parametrizadas, validación de dispositivos y proxy Caddy con HTTPS automático. Pensado para desplegarse en Oracle Cloud Always Free (10 TB/mes, sin pausas por inactividad ni límites de CPU/invocaciones).

## Pasos de migración y despliegue

### 1. Configurar secrets en GitHub (`Fe2rr/Napl-prueba`)
- `NAPL_DATA_GITHUB_TOKEN`: Fine-grained PAT con `Contents: Read and write` sobre `Fe2rr/NAPL-Data`.
- `STEAMGRIDDB_API_KEY` *(opcional)*: para fallback vertical en consultas de Steam.
- Ejecuta manualmente el workflow `NAPL catalog sync` con `import_sheets=false` y verifica que genere `catalog.json` y `public/assets/covers/`.

### 2. Migrar datos comunitarios de Supabase a SQLite
Antes de apagar Supabase:
```bash
SUPABASE_DB_URL="postgresql://..." node scripts/export-supabase.mjs
node community-server/import-from-supabase.mjs napl-supabase-export.json ./community-server/data/napl-community.sqlite
```
> Guarda el `REPORTER_HASH_SECRET` previo en `community-server/.env` para preservar los rate-limits de `report-link` y borra `napl-supabase-export.json` al terminar.

### 3. Desplegar `community-server/` en tu VM (Oracle Cloud Always Free)
Sigue la guía en [`community-server/README.md`](community-server/README.md) (puertos 80/443 abiertos, `docker compose up -d --build` o `systemd` + Caddy, y cron diario `.backup` de SQLite).

### 4. Apuntar el frontend al servicio comunitario
Configura tu dominio HTTPS en `public/js/lib/config.js` (`DEFAULT_COMMUNITY_API_BASE`) o agrega en `public/index.html`:
```html
<meta name="napl-community-api" content="https://api.tudominio.com">
```

### 5. Verificación final y baja de servicios legacy
Una vez verificados catálogo estático, portadas WebP, sync en Actions, admin por PAT y los 4 endpoints comunitarios en `https://api.tudominio.com/health`, puedes dar de baja Cloudflare Workers/Images y el proyecto de Supabase.
