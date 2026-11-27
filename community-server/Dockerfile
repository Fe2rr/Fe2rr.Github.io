FROM node:22-alpine

WORKDIR /app

COPY community-server/package.json ./
COPY community-server/schema.sql ./
COPY community-server/server.mjs ./
COPY community-server/import-from-supabase.mjs ./
COPY public/assets/data/devices.json ./devices/devices.json
COPY public/assets/data/device-catalog ./devices/device-catalog

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV SQLITE_PATH=/data/napl-community.sqlite
ENV DEVICES_JSON_PATH=/app/devices/devices.json

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
