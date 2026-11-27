# NAPL Community API en Deno Deploy + Deno KV (Sin tarjeta de crédito)

Alternativa gratuita **sin tarjeta de crédito**, **sin pausas por inactividad** y **sin límites diarios**, consolidando cómputo y almacenamiento en **1 solo servicio externo** conectado directamente a tu repositorio de GitHub.

## Límites gratuitos mensuales (Deno Deploy Free)
- **Requests:** 1,000,000 / mes
- **Ancho de banda:** 20 GiB / mes
- **Deno KV:** 1 GiB de almacenamiento, 1,000,000 unidades de lectura/mes y 500,000 unidades de escritura/mes
- Gracias a los resúmenes sharded en KV y caché en memoria del isolate (15–20 s), cada lectura de catálogo en la portada consume **0 a 1 lectura**, permitiendo miles de visitas diarias dentro del nivel gratuito.

## 1. Desplegar en Deno Deploy (2 minutos, sin tarjeta)
1. Crea una cuenta en [dash.deno.com](https://dash.deno.com) iniciando sesión con **GitHub**.
2. Selecciona **New Project** -> elige el repositorio `Fe2rr/Napl-prueba`.
3. Configura:
   - **Root Directory:** `/` (importante para que lea `public/assets/data/devices.json` al iniciar)
   - **Entrypoint:** `deno-community/main.ts`
4. En **Settings -> Environment Variables**, agrega las variables de `deno-community/.env.example`:
   - `ALLOWED_ORIGINS`: `https://fe2rr.github.io,https://napl-catalog.pages.dev,https://napl-admin.pages.dev,http://localhost:3000,http://127.0.0.1:3000`
   - `REPORTER_HASH_SECRET`: la misma clave secreta que usaba `report-link` en Supabase.
   - `GITHUB_DATA_REPO`: `Fe2rr/NAPL-Data`
   - `DISCORD_WEBHOOK_URL` *(opcional)*
5. Verifica que responde `200 OK` en `https://tu-proyecto.deno.dev/health`.

## 2. Migrar historial desde Supabase
Exporta las tablas actuales con el script Node existente:
```bash
SUPABASE_DB_URL="postgresql://..." node scripts/export-supabase.mjs
```
Luego sube el archivo directamente a tu servicio en Deno Deploy autenticado con tu **GitHub Fine-grained PAT** (el mismo que tiene permiso de escritura sobre `Fe2rr/NAPL-Data`):
```bash
curl -fsS -X POST "https://tu-proyecto.deno.dev/admin-import" \
  -H "Authorization: Bearer TU_GITHUB_PAT" \
  -H "Content-Type: application/json" \
  --data-binary @napl-supabase-export.json
```
*(Borra `napl-supabase-export.json` tras confirmar `{"success": true}`.)*

## 3. Conectar el frontend en GitHub Pages
Agrega en `<head>` de `public/index.html` (o actualiza `DEFAULT_COMMUNITY_API_BASE` en `public/js/lib/config.js`):
```html
<meta name="napl-community-api" content="https://tu-proyecto.deno.dev">
```
