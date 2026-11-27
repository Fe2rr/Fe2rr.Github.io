# Cloudflare legacy resources

Cloudflare ya no debe encargarse de sincronizar el catálogo ni publicar los archivos estáticos. Esas tareas se ejecutan desde GitHub Actions y GitHub Pages.

## Recursos que siguen activos temporalmente

- Worker `napl-admin-api`: compatibilidad con la versión v5 de producción. Su endpoint `GET /api/public-catalog` ahora redirige al JSON público de `Fe2rr/NAPL-Data` en `raw.githubusercontent.com`; ya no depende del proyecto Pages `napl-catalog`.
- Worker `napl-image-optimizer`: todavía referenciado por la versión v5. Se retirará cuando la versión de producción use exclusivamente las portadas WebP estáticas publicadas desde GitHub.
- Queue `napl-sync-tasks`: se conserva mientras existan rutas legacy de sincronización manual. No tiene cron programado.
- Pages `napl-admin`: panel administrativo legacy conectado al repositorio `Fe2rr/Napl-Admin`; se mantiene hasta migrar el panel a GitHub Pages.

## Recursos retirados

- Pages `napl-catalog`: eliminado. Los 252 despliegues antiguos se borraron y Cloudflare eliminó el proyecto junto con su último despliegue activo.
- Cron triggers del Worker `napl-admin-api`: eliminados. La sincronización y publicación periódica corresponden a GitHub Actions.
- No se usa D1 para el catálogo. La única D1 actual es `napl-community`, destinada a ratings, popularidad, compatibilidad y reportes.

## Regla de despliegue

No vuelvas a agregar `[triggers] crons` al `wrangler.toml` legacy. Para sincronización programada usa los workflows de GitHub Actions. No borres los dos Workers legacy hasta que la rama `v5` de `Fe2rr/Fe2rr.Github.io` deje de referenciarlos.
