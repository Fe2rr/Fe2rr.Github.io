# NAPL Admin API (Cloudflare Worker)

Worker deployed as `napl-admin-api` for the NAPL-prueba repository.

## Required secrets

Configure these under Cloudflare Dashboard → Workers & Pages → napl-admin-api → Settings → Variables and Secrets:

- `ADMIN_PASSWORD` — a strong password used by the administrator.
- `GITHUB_TOKEN` — GitHub fine-grained PAT with **Contents: Read and write** for `Fe2rr/Napl-prueba`.

`SESSION_SECRET` is generated and already configured as a Worker secret. Do not replace it unless you intend to invalidate active sessions.

## Fixed target

- Repository: `Fe2rr/Napl-prueba`
- Branch: `main`
- Catalog path: `public/assets/data/catalog.json`
- Admin page: `https://fe2rr.github.io/Napl-prueba/admin.html`
- API: `https://napl-admin-api.federicoxastro.workers.dev`

The public site remains static. The Worker is only used by the administrator to read/import/publish catalog data. Supabase is not used for the catalog.

## API

- `GET /api/health` — configuration status (no secrets exposed)
- `POST /api/login` — password login, returns an expiring signed session token
- `GET /api/catalog` — read the JSON catalog (authenticated)
- `POST /api/import-sheets` — import Google Sheets CSV into a preview (authenticated; does not publish)
- `POST /api/publish` — validate and commit the catalog JSON to GitHub (authenticated)

The admin session is stored in `sessionStorage`, expires after 8 hours, and is not the GitHub token. GitHub credentials never reach the browser.
