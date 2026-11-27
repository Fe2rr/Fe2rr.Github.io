# NAPL Community Server (1 Servicio Externo Único: Node.js 22 + SQLite WAL + Caddy)

Microservidor ligero con **cero dependencias npm externas** pensado para alojar únicamente las 4 APIs comunitarias anónimas de NAPL (`/ratings`, `/popularity`, `/compatibility`, `/report-link`) más `/admin-dashboard` (autenticado por GitHub PAT contra `Fe2rr/NAPL-Data`) en **un solo servidor** (por ejemplo, Oracle Cloud Always Free ARM `A1.Flex` o AMD `E2.1.Micro`, o cualquier VPS Linux).

## Por qué Node.js 22 + SQLite
- Usa el módulo nativo `node:sqlite` (`DatabaseSync`) incluido en Node.js 22 (sin compilación nativa C++).
- Mantiene modo WAL en disco con claves foráneas activas e índices dedicados para búsquedas por `port_id`, `device_id` y `device_soc`.
- Permite hasta **10 TB/mes de transferencia** en Oracle Cloud Always Free, sin pausas por inactividad ni límites por invocación.

## 1. Preparar la VM (Oracle Cloud Always Free / Ubuntu 24.04)
1. En la consola de Oracle Cloud (VCN -> Security Lists -> Ingress Rules), abrir TCP **80** y **443** hacia `0.0.0.0/0` (para HTTP challenge de Let's Encrypt y HTTPS).
2. En el firewall interno de Ubuntu (iptables/ufw):
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
3. Apuntar un dominio o subdominio gratuito (ej. DuckDNS, Cloudflare DNS sin proxy naranja o dominio propio) a la IP pública de la VM.

## 2. Exportar Supabase e importar en SQLite
Desde tu máquina local antes de apagar Supabase:
```bash
SUPABASE_DB_URL="postgresql://..." node scripts/export-supabase.mjs
node community-server/import-from-supabase.mjs napl-supabase-export.json ./community-server/data/napl-community.sqlite
```
> Importante: guarda el mismo valor que usaba `report-link` como `REPORTER_HASH_SECRET` en `.env` para conservar la continuidad de los rate-limits. Borra `napl-supabase-export.json` tras verificar la importación.

## 3. Arranque con Docker Compose (recomendado)
```bash
cd community-server
cp .env.example .env
# Edita .env con REPORTER_HASH_SECRET, ALLOWED_ORIGINS y DISCORD_WEBHOOK_URL (opcional)
NAPL_API_DOMAIN=api.tudominio.com docker compose up -d --build
```
Verifica el healthcheck:
```bash
curl -fsS https://api.tudominio.com/health
```

## 4. Arranque bare-metal con systemd + Caddy
Si prefieres correr sin Docker:
1. Instala Node.js 22+ y Caddy (`apt install caddy`).
2. Copia el proyecto en `/opt/napl`, crea `/opt/napl/community-server/.env` y asigna permisos a usuario `napl`.
3. Instala `napl-community.service` en `/etc/systemd/system/napl-community.service` y activa:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now napl-community
   ```
4. Copia `Caddyfile` a `/etc/caddy/Caddyfile` con tu dominio y ejecuta `sudo systemctl reload caddy`.

## 5. Respaldo automático diario de SQLite (cron)
Agrega un cron diario en la VM usando `.backup` seguro en caliente (compatible con modo WAL):
```cron
15 3 * * * sqlite3 /opt/napl/community-server/data/napl-community.sqlite ".backup '/opt/napl/backups/napl-community-$(date +\%F).sqlite'" && find /opt/napl/backups -name 'napl-community-*.sqlite' -mtime +14 -delete
```

## 6. Conectar el frontend en GitHub Pages
Configura en `<head>` de `public/index.html` (o mediante `window.NAPL_COMMUNITY_API_BASE` / `public/js/lib/config.js`):
```html
<meta name="napl-community-api" content="https://api.tudominio.com">
```
