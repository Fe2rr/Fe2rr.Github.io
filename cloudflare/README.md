# Cloudflare en NAPL

NAPL ya no depende de Cloudflare en producción. Los Workers antiguos se retiraron porque la versión activa no los utiliza y la compatibilidad con v5 dejó de ser necesaria.

## Estado

- Workers NAPL: ninguno.
- D1: ninguna base de datos NAPL.
- Queues: ninguna cola NAPL.
- Pages: ningún proyecto NAPL.

Las portadas se optimizan en GitHub Actions y se publican como WebP estáticos. El catálogo, las imágenes y los snapshots se sirven desde GitHub Pages / Fe2rr/NAPL-Data.

No desplegar ni recrear Workers, D1, Queues o Pages para funciones cubiertas por GitHub o Supabase. Cloudflare queda fuera del camino crítico de NAPL.
