import fs from 'fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function naplPublicRootPlugin(): Plugin {
  const publicDir = path.resolve(__dirname, 'public');
  const distDir = path.resolve(__dirname, 'dist');

  return {
    name: 'napl-public-root',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '/';
        const [pathname, search = ''] = rawUrl.split('?');
        const isPublicPrefixed =
          pathname === '/public' || pathname.startsWith('/public/');
        const cleanPath = isPublicPrefixed
          ? pathname.replace(/^\/public/, '') || '/'
          : pathname;

        if (cleanPath === '/compatibility' || cleanPath === '/compatibility.html') {
          const p = new URLSearchParams(search);
          if (!p.has('page')) p.set('page', 'compatibility');
          const qs = p.toString();
          res.writeHead(301, {Location: qs ? `/?${qs}` : '/?page=compatibility'});
          res.end();
          return;
        }

        const isLegacyRoute =
          cleanPath === '/game' ||
          cleanPath === '/game.html' ||
          cleanPath === '/all-games' ||
          cleanPath === '/all-games.html' ||
          (isPublicPrefixed && cleanPath === '/index.html');

        if (isLegacyRoute || isPublicPrefixed) {
          const targetPath = isLegacyRoute ? '/' : cleanPath;
          res.writeHead(301, {Location: targetPath + (search ? `?${search}` : '')});
          res.end();
          return;
        }

        if (pathname === '/' || pathname === '/index.html') {
          const publicIndex = path.join(publicDir, 'index.html');
          if (fs.existsSync(publicIndex)) {
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
            res.end(fs.readFileSync(publicIndex, 'utf8'));
            return;
          }
        }

        next();
      });
    },
    closeBundle() {
      const srcIndex = path.join(publicDir, 'index.html');
      const destIndex = path.join(distDir, 'index.html');
      if (fs.existsSync(srcIndex) && fs.existsSync(distDir)) {
        fs.copyFileSync(srcIndex, destIndex);
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), naplPublicRootPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
