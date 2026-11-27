# NAPL community backend

## Production routing

- GitHub Pages + `Fe2rr/NAPL-Data`: public catalog, device catalog, community JSON snapshots, and static assets.
- GitHub Actions: scheduled catalog sync, community snapshot generation, and optional batched Discord report digest.
- Supabase: only transactional community operations (ratings, compatibility submissions/queries, link reports, visit counters) and the authenticated snapshot endpoint used by Actions.
- Cloudflare: legacy v5 compatibility only. The community D1 Worker is being retired after the Supabase cutover is verified.
- Neon: staging/rollback copy only; not connected to visitor traffic. The current Neon project is in a region without Neon Functions, so it is not used as a production API.

## Functions

- `ratings`: token issuance, own-vote lookup, vote submission; public ratings are read from GitHub snapshots.
- `compatibility`: detailed compatibility reads and report submissions; device catalog is static JSON on GitHub.
- `popularity`: visit registration; public rankings are read from GitHub snapshots.
- `report-link`: stores link reports and queues them for the scheduled digest.
- `community-sync`: validates a GitHub PAT with push access to `Fe2rr/NAPL-Data`, then serves the static snapshot source and pending report digest endpoints.

All browser-facing functions validate inputs and use server-side database keys. The community snapshot endpoint authenticates the GitHub PAT itself; do not put a Supabase secret key in GitHub Pages or the browser.

## Consumption controls

- Passive page loads use static JSON and should cause zero Supabase or Cloudflare requests.
- Popularity submissions are deduplicated in local storage per game/day; the database also enforces IP/game/day deduplication.
- Compatibility reads are cached in local storage for 15 minutes; report submissions refresh their own game's summary.
- Community snapshots run every six hours and are committed only when content changes.
- Link reports are batched by GitHub Actions; the Edge Function does not send one Discord webhook per report.

## Deployment

The function sources and `config.toml` are versioned in this repository. Deploy individual functions with the Supabase CLI, using the project ref above. Do not deploy the whole directory until all function sources are present and reviewed.
