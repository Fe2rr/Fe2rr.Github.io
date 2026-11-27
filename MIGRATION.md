# NAPL infrastructure migration — development

This repository is the integration target for the Vercel API and GitHub Actions migration. The stable GitHub Pages deployment is not changed by these commits.

## Implemented in this branch
- Neon schema and full nine-table Supabase export/import scripts.
- Vercel Node API routes for community ratings, popularity, compatibility and broken-link reports.
- Admin API compatibility adapter running the existing catalog logic inside Vercel Node Functions (not Cloudflare Workers).
- GitHub Actions workflow for scheduled and manual full-catalog sync. It reads the canonical internal catalog state from `Fe2rr/NAPL-Data/private/catalog-state.json`, updates source availability in batches, then publishes the public JSON to `Fe2rr/NAPL-Data/public/assets/data/catalog.json`.
- WebP cover cache generation via wsrv.nl into NAPL-Data/public/assets/covers, plus a manifest consumed by the Vercel frontend.
- Frontend API selection uses the new routes on Vercel hosts; GitHub Pages remains on the old services until the production cutover.

## Catalog source of truth
- The current catalog in `Fe2rr/NAPL-Data` is authoritative.
- The legacy Google Sheets CSV is not automatically imported. It may be stale.
- GitHub Actions manual runs default to `import_sheets=false`; scheduled runs also skip the Sheets import.
- Only set `import_sheets=true` when intentionally replacing/refreshing catalog data from the Google Sheets source after verifying that source is current.
- Normal catalog synchronization reads the existing private state, checks source availability, applies status/version changes, and publishes the resulting public catalog. It does not rebuild the catalog from the legacy CSV.

## Required setup
1. Create Neon project/database; run database/neon-schema.sql.
2. Export Supabase and import into Neon:
   `SUPABASE_DB_URL='...' node scripts/export-supabase.mjs`
   `NEON_DATABASE_URL='...' node scripts/import-neon.mjs napl-supabase-export.json`
   `NEON_DATABASE_URL='...' node scripts/verify-neon-import.mjs`
3. Deploy this repository to Vercel with root directory /, framework preset Vite, build npm run build, output dist.
4. Configure Vercel environment variables from .env.vercel.example in Production and Preview. Never expose secrets with VITE_ prefixes.
5. Configure GitHub repository Actions secrets in Fe2rr/Napl-prueba: NAPL_ADMIN_PASSWORD, NAPL_SESSION_SECRET, NAPL_DATA_GITHUB_TOKEN (Contents read/write on Fe2rr/NAPL-Data).
6. Run workflow NAPL catalog sync manually with `import_sheets=false`; inspect all batch logs and confirm catalog publication and cover manifest commit.
7. Test community API and admin endpoints on the Vercel deployment before changing the stable frontend.
8. Only after successful parity checks, change the stable frontend to Vercel and disable Supabase/Cloudflare services.

## Vercel environment variables
See .env.vercel.example. Required values: NEON_DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET, GITHUB_TOKEN, CATALOG_DATA_GITHUB_TOKEN, GH_ACTIONS_TOKEN, ALLOWED_ORIGINS, DISCORD_WEBHOOK_URL, NAPL_DATA_REPO and NAPL_SYNC_WORKFLOW. Also configure REPORTER_HASH_SECRET with the existing Supabase default secret API key used by the report-link Edge Function.

## Important
The current Supabase database contains nine tables and the export script includes all of them. The export includes pseudonymous hashes and rating-token hashes; keep it private and delete local export copies after verified import. Copy the current Supabase service-role key (or the default secret key used by the Edge Functions) into Vercel as REPORTER_HASH_SECRET before cutover: report-link uses that key for HMAC reporter identities, so this preserves existing rate-limit identity continuity. Do not turn off Supabase or Cloudflare until all tests pass.

The GitHub Actions job runs daily at 04:17 UTC (01:17 Uruguay) to reduce private-repository Actions-minute consumption; it can also be triggered manually from the admin panel. It uses four concurrent provider checks with retries. The job uses the existing Worker implementation as a pure Node module to preserve import/merge/sync rules. The code is executed by the Actions runner, not deployed to Cloudflare Workers or Queues.
