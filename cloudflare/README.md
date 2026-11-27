# Cloudflare en NAPL

La web activa se ejecuta con GitHub Pages y GitHub Actions. GitHub mantiene el catálogo, los dispositivos, las portadas estáticas, la sincronización, la edición y la publicación.

Cloudflare conserva únicamente las operaciones comunitarias dinámicas y dos compatibilidades necesarias para la copia estable v5.

## Recursos activos

- **Worker `napl-community-api` + D1 `napl-community`:** valoraciones, votos propios, registro de popularidad, compatibilidad de dispositivos, reportes de enlaces y dashboard comunitario protegido por GitHub PAT. Los snapshots públicos se generan y publican con GitHub Actions.
- **Worker `napl-admin-api`:** quedó reducido a un endpoint de compatibilidad `GET /api/public-catalog` para la versión archivada v5. Redirige al catálogo estático de `https://fe2rr.github.io/assets/data/catalog.json`. Ya no contiene login, administración, sincronización ni procesamiento de colas.
- **Worker `napl-image-optimizer`:** se conserva únicamente porque la versión archivada v5 todavía lo referencia. La web activa usa portadas WebP estáticas generadas por GitHub Actions y fallback externo.

## Recursos retirados

- Pages `napl-admin`: reemplazado por `https://fe2rr.github.io/admin/`.
- Queue `napl-sync-tasks` y dead-letter queue `napl-sync-dlq`: la sincronización pasó a GitHub Actions.
- Secrets de sincronización y administración del Worker `napl-admin-api`: ya no son necesarios.

## Límites de arquitectura

- No volver a implementar sincronización del catálogo en Workers o Queues.
- No usar D1 para servir el catálogo, las portadas ni los snapshots públicos.
- Mantener las lecturas D1 para operaciones comunitarias que realmente necesiten datos dinámicos.
- No retirar `napl-admin-api` ni `napl-image-optimizer` mientras se quiera conservar la funcionalidad de la copia estable v5.
