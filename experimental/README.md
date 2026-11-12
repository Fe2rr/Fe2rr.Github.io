# NAPL Experimental

An isolated rebuild concept for Native Android Port List. This folder does not replace the production website.

## Current prototype

- Responsive public catalog with search, platform/genre filters and sorting.
- Port detail dialog.
- Admin page with add, edit, delete, JSON import and JSON export.
- Preserves the existing 21-column catalog vocabulary.
- Demo data is intentionally fictional and must be replaced with a verified export before real use.

## Data mode

The prototype loads `data/ports.json`. Admin changes are stored in browser `localStorage` under `napl-experimental-ports-v1`. This is a front-end prototype only: changes do not reach GitHub, R2, D1 or any shared server.

## Intended production architecture

- Static frontend hosted on GitHub Pages.
- Cloudflare Worker as the authenticated API boundary.
- Cloudflare R2 for catalog objects and cover assets.
- Existing Cloudflare D1 ratings service kept independent initially.
- A versioned data contract based on the existing NAPL fields.

Before production, replace localStorage persistence with Worker API calls, add authentication/authorization, validate all inputs server-side, implement safe concurrent writes and migrate the verified catalog. Never place Worker secrets in frontend code.

## Preview

Open `index.html` from this folder through GitHub Pages after the branch is published, or run a static local server from this directory.
