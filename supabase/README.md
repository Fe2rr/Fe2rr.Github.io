# NAPL community backend

## Production routing

- GitHub Pages + `Fe2rr/NAPL-Data`: public catalog, device catalog, community JSON snapshots, and static assets.
- GitHub Actions: scheduled catalog sync, community snapshot generation, and optional batched Discord report digest.
- Supabase: only transactional community operations (ratings, compatibility submissions/queries, link reports, visit counters) and the authenticated snapshot endpoint used by Actions.
- Cloudflare: legacy v5 compatibility only. The community D1 Worker and database were retired on 2026-11-27 after the Supabase cutover passed its GitHub Actions snapshot and report-digest checks.
- Neon: the existing `napl-prueba` project is an isolated test copy, not a current backup and not connected to visitor traffic. Its `sa-east-1` region is not among the current Neon Functions deployment regions; using Neon Functions would require a separate project in a supported region, so it adds no benefit to this architecture today.

## Functions

- `ratings`: token issuance, own-vote lookup, vote submission; public ratings are read from GitHub snapshots.
- `compatibility`: hardware search and report submissions; compatibility details are served from GitHub snapshots during passive page loads.
- `popularity`: visit registration; public rankings are read from GitHub snapshots.
- `report-link`: stores link reports and queues them for the scheduled digest.
- `community-sync`: validates a GitHub PAT with push access to `Fe2rr/NAPL-Data`, then serves the static snapshot source and pending report digest endpoints.

All browser-facing functions validate inputs and use server-side database keys. The community snapshot endpoint authenticates the GitHub PAT itself; do not put a Supabase secret key in GitHub Pages or the browser.

## Consumption controls

- Passive page loads use static JSON and should cause zero Supabase or Cloudflare requests.
- Popularity submissions are deduplicated in local storage per game/day; the database also enforces IP/game/day deduplication.
- Compatibility details are included in the six-hour GitHub snapshot; local cache lasts 15 minutes. Supabase is used for user-initiated hardware search and fresh post-submit reads.
- Community snapshots run every six hours and are committed only when content changes.
- Link reports are batched by GitHub Actions; the Edge Function does not send one Discord webhook per report.

## Deployment

The function sources and `config.toml` are versioned in this repository. Deploy individual functions with the Supabase CLI, using the project ref above. Do not deploy the whole directory until all function sources are present and reviewed.
