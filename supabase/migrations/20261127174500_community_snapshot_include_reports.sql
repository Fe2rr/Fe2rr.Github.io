-- Add recent compatibility reports to the static GitHub community snapshot.
-- This lets passive page views avoid live Supabase reads.

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
        ),
        'reports', recent.reports
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
  ) AS grouped
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'deviceId', latest.device_id,
          'deviceName', COALESCE(NULLIF(d.model, ''), latest.device_name),
          'deviceSoc', COALESCE(d.soc, ''),
          'deviceType', COALESCE(NULLIF(d.device_type, ''), 'phone'),
          'status', latest.status,
          'works', latest.status IN ('playable_30', 'playable_60'),
          'updatedAt', latest.updated_at
        )
        ORDER BY latest.updated_at DESC, latest.id DESC
      ),
      '[]'::jsonb
    ) AS reports
    FROM (
      SELECT id, device_id, device_name, status, works, updated_at
      FROM public.compatibility_reports
      WHERE port_id = grouped.port_id
      ORDER BY updated_at DESC, id DESC
      LIMIT 30
    ) AS latest
    LEFT JOIN public.devices d ON d.id = latest.device_id
  ) AS recent;
$function$;

REVOKE ALL ON FUNCTION public.napl_get_compatibility_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.napl_get_compatibility_summary() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.napl_get_compatibility_summary() TO service_role;
NOTIFY pgrst, 'reload schema';
