# NAPL — arquitectura actual

NAPL funciona con GitHub como plataforma principal. La versión activa es la publicada desde `Fe2rr/Fe2rr.github.io`, rama `main`. El repositorio `archive` es un respaldo separado y no forma parte del despliegue.

## Componentes

1. **GitHub Pages:** sitio público, panel administrativo, catálogo, dispositivos, portadas WebP y snapshots comunitarios.
2. **Fe2rr/NAPL-Data:** estado privado del catálogo y datos públicos generados.
3. **GitHub Actions:** sincronización del catálogo, optimización estática de portadas, consultas de metadatos, snapshots comunitarios, digest de Discord y publicación.
4. **Supabase:** operaciones comunitarias transaccionales y endpoint autenticado que consume GitHub Actions y el panel admin.
5. **Cloudflare:** sin Workers, D1, Queues ni Pages activos para NAPL. No se debe recrear infraestructura para tareas que ya resuelven GitHub o Supabase.
6. **Neon:** entorno de staging aislado; no recibe tráfico de producción.

## Panel administrativo

El panel estático se publica en `https://fe2rr.github.io/admin/`.

- Catálogo y cambios: GitHub API contra `Fe2rr/NAPL-Data`.
- Automatizaciones: GitHub Actions del repositorio `Fe2rr/Fe2rr.github.io`.
- Comunidad: snapshot de GitHub más endpoint `community-sync/admin-dashboard` de Supabase.
- El Fine-grained PAT se mantiene en `sessionStorage`; se envía a GitHub y al endpoint comunitario únicamente para validar permisos. No se persiste en la base de datos.

Permisos del PAT:
- `Fe2rr/NAPL-Data`: Contents — Read and write.
- `Fe2rr/Fe2rr.github.io`: Actions — Read and write; Contents — Read.

## Consumo

- Las lecturas públicas de ratings, popularidad, compatibilidad y dispositivos deben salir de JSON estático de GitHub.
- Supabase queda limitado a escrituras, consultas de hardware solicitadas por el usuario, lecturas frescas posteriores a envíos y snapshots programados.
- Las visitas se deduplican en el navegador y en Postgres.
- GitHub Actions actualiza el snapshot cada seis horas y envía reportes de enlaces en lotes.
- No usar Cloudflare como proxy o backend de reserva.

## Funciones comunitarias Supabase

- `ratings`: emisión de token, consulta de voto propio y envío/eliminación de votos. La lectura pública masiva se sirve desde el snapshot.
- `popularity`: registro de visitas. Los rankings públicos se sirven desde el snapshot.
- `compatibility`: envíos, consultas frescas y búsqueda de hardware.
- `report-link`: recepción y limitación de reportes de enlaces.
- `community-sync`: snapshot, digest de reportes y dashboard administrativo consolidado.
- `admin-dashboard`: endpoint antiguo retirado; el stub remoto responde HTTP 410 y no se utiliza desde el frontend.

## Regla de mantenimiento

Antes de agregar infraestructura, comprobar si GitHub Actions, JSON estático o las funciones existentes ya resuelven la necesidad. No modificar `archive` sin autorización explícita.
