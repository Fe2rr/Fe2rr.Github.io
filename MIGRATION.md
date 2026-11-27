# NAPL — Arquitectura GitHub + Cloudflare

NAPL utiliza **GitHub Pages, GitHub Actions y Fe2rr/NAPL-Data** para el sitio, el catálogo, las portadas, el panel administrativo y las automatizaciones. El único servicio externo activo para las operaciones comunitarias en tiempo real es **Cloudflare Workers + D1**.

## Arquitectura

1. **GitHub Pages**
   - Sitio público estático.
   - Catálogo, dispositivos, resúmenes comunitarios y portadas WebP.
   - Panel administrativo en `https://fe2rr.github.io/Napl-prueba/admin/`.
2. **GitHub Actions**
   - `sync-catalog.yml`: sincronización de ports y optimización WebP.
   - `sync-community-summary.yml`: resumen comunitario y digest de reportes.
   - `lookup-metadata.yml`: consultas de metadatos y optimización de portadas.
   - `deploy-pages.yml`: publicación de la web.
3. **Fe2rr/NAPL-Data**
   - `private/catalog-state.json`: estado editable y privado.
   - `public/assets/data/catalog.json`: catálogo público.
   - `public/assets/data/community-summary.json`: snapshot comunitario estático.
4. **Cloudflare**
   - Worker `napl-community-api` + D1 `napl-community`: ratings, popularidad, compatibilidad, reportes y dashboard administrativo.
   - Workers legacy `napl-admin-api` y `napl-image-optimizer`: se conservan temporalmente por compatibilidad con la versión v5 del sitio de producción.

## Panel administrativo

El panel es una SPA estática de GitHub Pages. Se autentica con un Fine-grained PAT que queda guardado únicamente en `sessionStorage`.

Permisos requeridos:
- `Fe2rr/NAPL-Data`: Contents — Read and write.
- `Fe2rr/Napl-prueba`: Actions — Read and write (para disparar workflows) y acceso de lectura al repositorio.

Funciones:
- Crear, editar y eliminar juegos y ports.
- Guardar estado privado y snapshot público en un commit atómico.
- Publicar los cambios en GitHub Pages.
- Ejecutar sincronización del catálogo e importación CSV bajo demanda.
- Consultar metadatos mediante GitHub Actions.
- Abrir el dashboard comunitario y revisar reportes consultando el Worker de Cloudflare.

El PAT nunca se envía al Worker comunitario para editar el catálogo. El Worker solo verifica el PAT contra GitHub para autorizar el dashboard.

## Optimización de lecturas

- Visitas pasivas: 0 llamadas al Worker y 0 lecturas D1.
- Resumen público: JSON estático desde GitHub Pages.
- Consultas de compatibilidad y operaciones comunitarias: Worker + D1, con límites por endpoint.
- El dashboard administrativo utiliza consultas acotadas y no forma parte del tráfico normal de visitantes.

## Recursos legacy

No eliminar `napl-admin-api` ni `napl-image-optimizer` mientras la rama `v5` de `Fe2rr/Fe2rr.Github.io` siga dependiendo de ellos. La migración del panel administrativo a GitHub Pages no modifica el sitio de producción.

Supabase y Neon ya no forman parte de la arquitectura de ejecución de este repositorio. La instancia de Supabase debe permanecer disponible hasta completar las pruebas funcionales finales y confirmar la continuidad de `REPORTER_HASH_SECRET`.
