# NAPL Community Worker + Cloudflare D1 (Sin tarjeta de crédito)

Micro-worker ligero en Cloudflare Workers + D1 dedicado **exclusivamente a interacciones comunitarias en tiempo real** (`/ratings`, `/popularity`, `/compatibility`, `/report-link`), sin cron triggers, sin proxy de imágenes y sin catálogo público.

Toda la carga pasiva de la web (catálogo JSON, portadas WebP y resúmenes de calificaciones/popularidad/compatibilidad) se sirve estáticamente desde GitHub Pages con **0 peticiones a Cloudflare** y **<= 220 filas leídas** incluso en consultas interactivas complejas.

## 1. Crear D1 y desplegar el Worker (sin tarjeta)
```bash
cd cloudflare-community
npx wrangler login
npx wrangler d1 create napl-community
# Copia el database_id obtenido dentro de cloudflare-community/wrangler.toml
npx wrangler d1 execute napl-community --remote --file=./schema.sql
npx wrangler secret put REPORTER_HASH_SECRET
npx wrangler deploy
```

## 2. Cargar dispositivos e historial de Supabase en D1
```bash
SUPABASE_DB_URL="postgresql://..." node scripts/export-supabase.mjs
node cloudflare-community/export-to-d1-sql.mjs napl-supabase-export.json cloudflare-community/d1-import
npx wrangler d1 execute napl-community --remote --file=./cloudflare-community/d1-import/01-devices.sql
npx wrangler d1 execute napl-community --remote --file=./cloudflare-community/d1-import/02-community.sql
```
*(Borra `napl-supabase-export.json` y `cloudflare-community/d1-import/` después de verificar.)*

## 3. Conectar GitHub Actions y Frontend
1. En **Actions secrets & variables** de `Fe2rr/Napl-prueba`, agrega:
   - Secret `NAPL_DATA_GITHUB_TOKEN` (Fine-grained PAT con `Contents: Read and write` sobre `Fe2rr/NAPL-Data`).
   - Secret `DISCORD_WEBHOOK_URL` *(opcional, para digest periódico de enlaces rotos)*.
   - Variable `NAPL_COMMUNITY_API_BASE` con la URL `https://napl-community-api.<tu-subdominio>.workers.dev`.
2. Ejecuta el workflow `NAPL community summary & Discord digest` para generar `public/assets/data/community-summary.json`.
3. En `public/index.html` (o `public/js/lib/config.js`), apunta `<meta name="napl-community-api" content="https://napl-community-api.<tu-subdominio>.workers.dev">`.
