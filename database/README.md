# Neon migration

1. Create a Neon PostgreSQL database and run `database/neon-schema.sql`.
2. Export the current Supabase data using a direct Postgres connection:
   `SUPABASE_DB_URL='postgresql://...' node scripts/export-supabase.mjs`
3. Import the export into Neon:
   `NEON_DATABASE_URL='postgresql://...' node scripts/import-neon.mjs napl-supabase-export.json`
4. Compare all nine table counts between Supabase and Neon before switching the frontend.
5. Keep the export file private. It contains anonymous identifiers and hashed IP/token data; do not commit it.

The export includes all nine existing tables, including visit de-duplication windows, issued rating tokens, compatibility devices, and report rate-limit state. Import preserves identity IDs and original timestamps.
