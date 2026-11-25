# NAPL Image Optimizer

Worker independiente para reducir el peso de portadas de LaunchBox usadas en la lista de juegos.

## Comportamiento

- Solo admite imágenes de `images.launchbox-app.com` y `gamesdb-images.launchbox.gg`.
- Normaliza fuentes HTTP a HTTPS.
- Genera WebP de hasta 180 px de ancho por defecto, calidad 74.
- Acepta únicamente anchos 160, 180, 200 y 240 px.
- Limita el tamaño de origen a 20 MB.
- Cachea las respuestas transformadas en Cloudflare Cache.
- No almacena imágenes originales en Cloudflare Images ni altera el catálogo.

## Endpoints

- `/health`: estado básico del Worker.
- `/image?url=<URL codificada>&w=180`: portada optimizada.

## Despliegue

Desde esta carpeta, con Wrangler autenticado en la cuenta de NAPL:

```bash
npx wrangler deploy
```

El binding `IMAGES` requiere que Cloudflare Images esté disponible en la cuenta. El plan Free incluye 5.000 transformaciones únicas por mes; superar el límite no genera cargos automáticos, pero las transformaciones nuevas fallan hasta el siguiente mes o hasta cambiar de plan.

El Worker se mantiene separado de `napl-admin-api`.
