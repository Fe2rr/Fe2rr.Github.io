# Cloudflare legacy resources

El sitio de desarrollo `Fe2rr/Napl-prueba` ya usa GitHub Pages + GitHub Actions para el catálogo y el nuevo panel administrativo. Cloudflare queda como backend comunitario dinámico y conserva recursos legacy requeridos por la versión v5 de producción.

## Recursos que siguen activos temporalmente

- Worker `napl-admin-api`: compatibilidad con `Fe2rr/Fe2rr.Github.io`, rama `v5`. Su endpoint `GET /api/public-catalog` redirige al JSON público de `Fe2rr/NAPL-Data`.
- Worker `napl-image-optimizer`: todavía referenciado por la versión v5; retirarlo solo después de migrar producción a portadas WebP estáticas.
- Queue `napl-sync-tasks`: legado de sincronización manual; revisar y retirar junto con las rutas administrativas antiguas cuando v5 deje de depender de ellas.
- Pages `napl-admin`: panel anterior. El reemplazo estático está en `https://fe2rr.github.io/Napl-prueba/admin/`. Mantener el proyecto anterior hasta comprobar acceso, edición, sincronización y dashboard en el nuevo panel.

## Recursos retirados

- Pages `napl-catalog`.
- Cron triggers del Worker `napl-admin-api`.

## Regla de despliegue

No volver a agregar cron triggers al Worker legacy. Las sincronizaciones periódicas corresponden a GitHub Actions. No borrar Workers ni Pages legacy hasta validar el reemplazo en producción.
