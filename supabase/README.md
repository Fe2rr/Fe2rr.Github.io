# NAPL — backend comunitario Supabase

## Arquitectura de producción

- GitHub Pages + `Fe2rr/NAPL-Data`: sitio, catálogo, dispositivos, portadas y snapshots públicos.
- GitHub Actions: sincronización del catálogo, snapshots cada seis horas y digest de reportes de enlaces.
- Supabase: operaciones comunitarias que requieren escrituras o datos frescos.
- Cloudflare: sin recursos NAPL activos.
- Neon: staging aislado, sin tráfico de producción.

## Funciones

- `ratings`: emisión de token, consulta de voto propio y envío/eliminación de votos. Los ratings públicos se leen desde el snapshot de GitHub; el endpoint GET masivo está retirado.
- `compatibility`: búsqueda de hardware, envío de reportes y consultas frescas. Las lecturas pasivas usan el snapshot.
- `popularity`: registro de visitas. El endpoint GET de rankings está retirado; los rankings públicos se leen desde GitHub.
- `report-link`: almacena reportes y aplica rate limit.
- `community-sync`: snapshot autenticado para GitHub Actions, cola de reportes y dashboard admin consolidado.

El endpoint antiguo `admin-dashboard` está retirado del frontend. Su stub remoto responde HTTP 410; la eliminación del recurso remoto requiere la operación de administración de funciones, no disponible mediante el conector actual.

## Controles de consumo

- Las visitas pasivas deben generar cero llamadas a Supabase.
- Ratings, popularidad, compatibilidad y dispositivos públicos se descargan desde JSON estático de GitHub.
- Las visitas se deduplican localmente por juego/día y en Postgres por IP/juego/ventana.
- La búsqueda de hardware solo consulta Supabase cuando el usuario la solicita.
- Las consultas frescas se reservan para acciones explícitas.
- El snapshot se actualiza cada seis horas y se publica solo cuando cambia.
- Los reportes de enlaces se envían a Discord en lotes.

## Seguridad

- Las funciones usan claves de servidor solo en Edge Functions.
- El PAT del administrador se valida contra GitHub y no se almacena en Postgres.
- Las tablas transaccionales no deben conceder acceso directo a `anon` o `authenticated`; las funciones del servidor acceden con el rol de servicio.
- Mantener RLS activado y los permisos mínimos en tablas y RPC.

## Despliegue

Las fuentes y migraciones de este directorio se versionan en el repositorio activo. Desplegar funciones de forma individual después de revisar y validar sus cambios.
