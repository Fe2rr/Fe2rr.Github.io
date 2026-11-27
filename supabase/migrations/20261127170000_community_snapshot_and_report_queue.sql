-- NAPL community backend consolidation.
-- Public reads are served from GitHub snapshots; this schema supports the scheduled snapshot and report digest.

ALTER TABLE public.link_reports
  ADD COLUMN IF NOT EXISTS discord_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.napl_get_compatibility_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO public, pg_temp
AS $function$
  SELECT COALESCE(
    jsonb_object_agg(
      grouped.port_id,
      jsonb_build_object(
        'yes', grouped.yes_count,
        'no', grouped.no_count,
        'counts', jsonb_build_object(
          'playable_60', grouped.playable_60_count,
          'playable_30', grouped.playable_30_count,
          'low_fps', grouped.low_fps_count,
          'crash', grouped.crash_count
        )
      )
    ),
    '{}'::jsonb
  )
  FROM (
    SELECT
      port_id,
      count(*) FILTER (WHERE status IN ('playable_30', 'playable_60'))::integer AS yes_count,
      count(*) FILTER (WHERE status IN ('crash', 'low_fps'))::integer AS no_count,
      count(*) FILTER (WHERE status = 'playable_60')::integer AS playable_60_count,
      count(*) FILTER (WHERE status = 'playable_30')::integer AS playable_30_count,
      count(*) FILTER (WHERE status = 'low_fps')::integer AS low_fps_count,
      count(*) FILTER (WHERE status = 'crash')::integer AS crash_count
    FROM public.compatibility_reports
    GROUP BY port_id
  ) AS grouped;
$function$;

REVOKE ALL ON FUNCTION public.napl_get_compatibility_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.napl_get_compatibility_summary() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.napl_get_compatibility_summary() TO service_role;

NOTIFY pgrst, 'reload schema';
