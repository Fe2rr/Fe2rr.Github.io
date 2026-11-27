# NAPL Community Worker + Cloudflare D1

Único backend externo activo para las funciones comunitarias en tiempo real: ratings, popularidad, compatibilidad y reportes de enlaces. También ofrece el dashboard administrativo de solo lectura.

El sitio público, catálogo, portadas WebP, panel de administración, sincronización y resúmenes comunitarios se sirven o automatizan desde GitHub Pages + GitHub Actions. Las visitas normales consumen archivos estáticos y no consultan D1.

## Estado desplegado

- D1: `napl-community`
- Database ID: `10427055-5b66-414b-9087-332631601bc1`
- Worker: `https://napl-community-api.federicoxastro.workers.dev`
- Binding D1: `DB`
- Variables: `GITHUB_DATA_REPO=Fe2rr/NAPL-Data`, `ALLOWED_ORIGINS`
- Secret: `REPORTER_HASH_SECRET`
- Esquema e índices aplicados; snapshot inicial importado y conteos comprobados.

## Configuración

El Worker utiliza:
- `ALLOWED_ORIGINS`: debe incluir `https://fe2rr.github.io`.
- `GITHUB_DATA_REPO`: `Fe2rr/NAPL-Data`.
- Binding D1: `DB`.
- Secret `REPORTER_HASH_SECRET`: mantener el valor original para conservar hashes y límites anti-spam.

No se debe agregar una cola ni cron para sincronizar el catálogo. Esas tareas corresponden a GitHub Actions.

## GitHub Actions

En `Fe2rr/Napl-prueba` → Settings → Secrets and variables → Actions:
- `NAPL_DATA_GITHUB_TOKEN`: Contents Read and write sobre `Fe2rr/NAPL-Data`.
- `NAPL_COMMUNITY_API_BASE`: `https://napl-community-api.federicoxastro.workers.dev`.
- `DISCORD_WEBHOOK_URL`: opcional.

El workflow `sync-community-summary.yml` corre cada hora y actualiza el JSON estático solo si hay cambios. Un HTTP 429 por cooldown se trata como omisión controlada.

## Panel administrativo

El panel vive en GitHub Pages: `https://fe2rr.github.io/Napl-prueba/admin/`.
Consulta `GET /admin-dashboard` con un Fine-grained PAT en el encabezado Bearer. El Worker verifica que el PAT tenga acceso al repositorio de datos configurado y devuelve los últimos 60 reportes de enlaces, 60 reportes de compatibilidad, 50 agregados de ratings, 80 registros de popularidad y totales.

El Worker no recibe ni almacena el PAT.

## Presupuesto de lecturas

| Operación | Máximo |
|---|---:|
| Visitas pasivas y resumen estático | 0 lecturas D1 |
| Compatibilidad detallada de hasta 10 juegos | <= 220 filas |
| Consulta de voto propio | 1 fila |
| Ratings de respaldo | <= 30 filas |
| Popularidad de respaldo | <= 30 filas |

El dashboard administrativo es una acción explícita del administrador y no forma parte del recorrido normal del visitante.

## Verificación

```bash
curl -fsS https://napl-community-api.federicoxastro.workers.dev/health
```

Mantener los servicios legacy y cualquier fuente histórica disponibles hasta completar las pruebas funcionales finales del reemplazo de producción.
