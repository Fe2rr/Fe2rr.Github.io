# Cloudflare en NAPL

GitHub es la plataforma principal. Cloudflare queda reducido a compatibilidad con la versión archivada v5.

## Recursos activos

- **Worker `napl-admin-api`:** shim mínimo de `GET /api/public-catalog` para v5. No contiene autenticación, administración, sincronización ni acceso a bases de datos.
- **Worker `napl-image-optimizer`:** se conserva mientras la versión archivada v5 lo necesite.

## Recursos retirados

- **Worker `napl-community-api`:** retirado el 27/11/2026. Las operaciones comunitarias activas usan las Edge Functions de Supabase.
- **D1 `napl-community`:** retirado el 27/11/2026. Los datos comunitarios se verificaron contra Supabase antes del retiro.
- Pages `napl-admin`: reemplazado por `https://fe2rr.github.io/admin/`.
- Queue `napl-sync-tasks` y dead-letter queue `napl-sync-dlq`: la sincronización pasó a GitHub Actions.

## Límites de arquitectura

- No desplegar un backend comunitario en Cloudflare.
- No recrear D1, Queues ni Pages para funciones ya resueltas por GitHub o Supabase.
- No retirar `napl-admin-api` ni `napl-image-optimizer` mientras se quiera conservar la compatibilidad con v5.
