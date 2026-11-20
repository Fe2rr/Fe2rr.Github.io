# NAPL API & Database Worker (Cloudflare Worker + D1)

## Producción — 20 de noviembre de 2026

- D1 `napl-catalog-db` creada y esquema aplicado.
- Worker `napl-admin-api` desplegado con binding `DB`.
- Secretos `ADMIN_PASSWORD`, `GITHUB_TOKEN` y `SESSION_SECRET` conservados.
- Cron Trigger activo cada 6 horas (`0 */6 * * *`).
- D1 solo es accesible desde el Worker; los endpoints de datos requieren sesión de administrador.
- El sitio público carga exclusivamente `public/assets/data/catalog.json` con caché local stale-while-revalidate.
- El panel Admin publica la instantánea de D1 hacia ese JSON en GitHub Pages.
- D1 se siembra desde el JSON estático solo cuando está vacía.

Worker `napl-admin-api` para gestionar el catálogo de **NAPL** sobre **Cloudflare D1**, con:
- API de datos privada: todas las rutas de lectura/escritura de D1 requieren sesión de administrador.
- El sitio público no llama al Worker ni a D1; consume exclusivamente el JSON estático.
- Autenticación de administrador y operaciones CRUD directas sobre juegos y ports en D1.
- Autocompletado server-side al pegar URLs de **GitHub** (`POST /api/lookup/github`) y **LaunchBox GamesDB** (`POST /api/lookup/launchbox`).
- Sincronización automática programada (Cron Trigger cada 6 horas) y manual (`POST /api/sync-github`) de versiones, fechas, redirecciones y repositorios caídos en GitHub.
- Publicación de instantánea hacia `public/assets/data/catalog.json` en `Fe2rr/Napl-prueba` (`POST /api/publish`) para mantener GitHub Pages y el fallback estático al día.

## Configuración en Cloudflare

1. **Crear la base de datos D1** (desde Dashboard o CLI):
   ```bash
   npx wrangler d1 create napl-catalog-db
   ```
   Copiá el `database_id` en `cloudflare/wrangler.toml` (o enlazá la base con nombre de binding **`DB`** desde *Workers & Pages → napl-admin-api → Settings → Bindings*).

2. **Aplicar el esquema SQL**:
   ```bash
   npx wrangler d1 execute napl-catalog-db --remote --file=cloudflare/schema.sql
   ```
   *(El Worker inicializa las tablas si no existen y siembra D1 desde `catalog.json` cuando el administrador abre el panel y la base está vacía).*

3. **Variables y Secretos requeridos** (*Settings → Variables and Secrets*):
   - `ADMIN_PASSWORD`: contraseña de acceso al panel Admin.
   - `GITHUB_TOKEN`: Fine-grained PAT con **Contents: Read and write** para `Fe2rr/Napl-prueba` (también amplía el límite de consultas GitHub a 5.000 req/h).
   - `SESSION_SECRET`: secreto HMAC ya configurado para firmar tokens de sesión.
   - `ADMIN_ORIGIN` *(opcional)*: orígenes extra separados por coma además de `https://fe2rr.github.io`.
   - `AUTO_PUBLISH_CRON` *(opcional, default `"true"`)*: si es `"true"`, cuando el Cron detecta cambios en GitHub actualiza también `public/assets/data/catalog.json` en GitHub.

4. **Desplegar Worker y Cron**:
   ```bash
   npx wrangler deploy --config cloudflare/wrangler.toml
   ```

## Endpoints principales

- `GET /api/health` — estado de D1 y secretos configurados.
- `POST /api/login` / `POST /api/logout` — sesión de administrador (Bearer token de 8h).
- `GET /api/catalog` — catálogo completo, estadísticas y últimos logs de sincronización.
- `POST /api/games` / `PUT /api/games/:slug` / `DELETE /api/games/:slug` — CRUD directo en D1.
- `POST /api/ports/sync` — sincroniza un port individual de GitHub y lo guarda en D1.
- `POST /api/lookup/github` — extrae proyecto, desarrollador, versión, fecha y descarga desde una URL de GitHub.
- `POST /api/lookup/launchbox` — extrae título, año, género, descripción y portada desde LaunchBox GamesDB.
- `POST /api/sync-github` — ejecuta lote de revisión de repositorios en GitHub y registra historial.
- `POST /api/import-sheets` — importa CSV de Google Sheets a D1.
- `POST /api/publish` — publica la instantánea actual de D1 en `Fe2rr/Napl-prueba` (`public/assets/data/catalog.json`).
