# NAPL Community Worker + Cloudflare D1

Backend externo único para las cuatro funciones comunitarias en tiempo real: ratings, popularidad, compatibilidad y reportes de enlaces.

El catálogo, las portadas WebP, la sincronización, los resúmenes públicos y el panel de edición se mantienen en GitHub Actions + GitHub Pages. Las visitas normales consumen archivos estáticos; no consultan D1. Las consultas interactivas están acotadas a un máximo de 250 filas por petición pública.

## Estado de despliegue

- D1: `napl-community`
- Database ID: `10427055-5b66-414b-9087-332631601bc1`
- Worker: `https://napl-community-api.federicoxastro.workers.dev`
- Subdominio `workers.dev`: habilitado
- Esquema e índices: aplicados y verificados.
- Snapshot inicial de Supabase: importado; conteos comprobados directamente en D1.
- Binding D1 `DB`, `GITHUB_DATA_REPO`, `ALLOWED_ORIGINS` y el secret binding `REPORTER_HASH_SECRET`: presentes.
- GitHub Actions: `NAPL_DATA_GITHUB_TOKEN` y `NAPL_COMMUNITY_API_BASE` comprobados por ejecución; `DISCORD_WEBHOOK_URL` es opcional.
- Pendiente: prueba funcional externa de `/health`, ratings, popularidad, compatibilidad y reportes antes de retirar Supabase.
- Nota: Cloudflare no permite leer el valor del secret; hay que conservar el mismo valor original de Supabase para mantener continuidad de hashes y límites anti-spam.

## 1. Configuración del Worker

El Worker ya está desplegado y enlazado a D1. Las variables públicas están configuradas:

- `ALLOWED_ORIGINS`: GitHub Pages de NAPL, panel admin y localhost.
- `GITHUB_DATA_REPO`: `Fe2rr/NAPL-Data`.
- Binding D1: `DB`.

`REPORTER_HASH_SECRET` ya está creado como **Secret** del Worker. Su valor está oculto por Cloudflare, por lo que no se puede comprobar desde la API; debe coincidir con el valor original de Supabase para conservar la continuidad de los hashes y los límites anti-spam.

Desde el directorio `cloudflare-community` se puede establecer con:

```bash
npx wrangler secret put REPORTER_HASH_SECRET
```

También se puede agregar desde Cloudflare Dashboard → Workers & Pages → `napl-community-api` → Settings → Variables and Secrets → Add → Secret.

## 2. Exportar e importar Supabase en otra instalación

Desde la raíz del repositorio:

```bash
SUPABASE_DB_URL="postgresql://..." node scripts/export-supabase.mjs
node cloudflare-community/export-to-d1-sql.mjs napl-supabase-export.json cloudflare-community/d1-import
```

Después, desde `cloudflare-community`:

```bash
npx wrangler d1 execute napl-community --remote --file=./schema.sql
npx wrangler d1 execute napl-community --remote --file=./d1-import/01-devices.sql
npx wrangler d1 execute napl-community --remote --file=./d1-import/02-community.sql
```

El exportador incluye todas las tablas comunitarias, incluyendo `rating_token_issues` y `game_popularity_visit_limits`. Estas conservan los límites anti-spam y la deduplicación histórica de visitas. Los INSERT se agrupan en lotes para reducir el tiempo de importación.

No borres el archivo exportado ni los SQL de importación hasta verificar los conteos de las tablas en D1.

## 3. GitHub Actions

En `Fe2rr/Napl-prueba` → Settings → Secrets and variables → Actions → Repository secrets:

- `NAPL_DATA_GITHUB_TOKEN`: ya está configurado y funciona con el workflow de catálogo. Fine-grained PAT con Contents Read and write sobre `Fe2rr/NAPL-Data`.
- `NAPL_COMMUNITY_API_BASE`: configurado como `https://napl-community-api.federicoxastro.workers.dev` y reconocido por el workflow.
- `DISCORD_WEBHOOK_URL`: opcional; solo si se quiere enviar el digest de reportes a Discord.

Los workflows no declaran un Environment; por eso estos secretos deben estar en **Repository secrets**, no solamente dentro de un Environment.

El workflow `NAPL community summary & Discord digest` corre cada hora y solo actualiza el JSON estático cuando detecta cambios. Luego solicita el redeploy de GitHub Pages. Si el Worker responde HTTP 429 por cooldown, el script ahora registra una omisión controlada y termina sin marcar el workflow como error; la siguiente ejecución programada vuelve a intentarlo.

## 4. Frontend

La URL del Worker ya está configurada en:

- `public/index.html` mediante `meta[name="napl-community-api"]`.
- `public/js/lib/config.js` como fallback.

El catálogo se carga desde los archivos de GitHub Pages. No se usa el antiguo fallback `napl-catalog.pages.dev`.

## 5. Presupuesto de lecturas

| Operación pública | Máximo de filas |
|---|---:|
| Resumen estático de ratings, popularidad y compatibilidad | 0 |
| Compatibilidad detallada de hasta 10 juegos | <= 220 |
| Consulta del voto del usuario para un juego | 1 |
| Endpoint de ratings de respaldo | <= 30 |
| Endpoint de popularidad de respaldo | <= 30 |
| Registro de visita | 0 lecturas previas (upsert condicional) |

La web no consulta los rankings completos en D1: los descarga como JSON estático desde GitHub. Si un visitante abre la compatibilidad detallada de un juego, esa consulta queda acotada a 220 filas; la consulta de su voto individual agrega una sola fila. Los endpoints de respaldo están limitados a 30 filas y no los usa el frontend normal. El snapshot administrativo ejecutado por GitHub Actions es una tarea de fondo, no una petición de visitante.

## 6. Verificación

```bash
curl -fsS https://napl-community-api.federicoxastro.workers.dev/health
```

La respuesta de health comprueba también que el binding D1 está accesible. Mantén Supabase activo hasta completar las pruebas de ratings, popularidad, compatibilidad y reportes en el sitio y realizar una última sincronización de los cambios recientes.
