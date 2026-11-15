ALTER TABLE public.compatibility_reports
    ADD COLUMN IF NOT EXISTS status text;

UPDATE public.compatibility_reports
SET status = CASE WHEN works IS TRUE THEN 'playable_30' ELSE 'crash' END
WHERE status IS NULL
   OR status NOT IN ('crash', 'low_fps', 'playable_30', 'playable_60');

ALTER TABLE public.compatibility_reports
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'crash';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'compatibility_reports_status_check'
    ) THEN
        ALTER TABLE public.compatibility_reports
            ADD CONSTRAINT compatibility_reports_status_check
            CHECK (status IN ('crash', 'low_fps', 'playable_30', 'playable_60'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS compatibility_reports_device_idx
    ON public.compatibility_reports (device_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.get_compatibility_for_ports(p_port_ids text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
    SELECT COALESCE(
        jsonb_object_agg(
            requested.port_id,
            jsonb_build_object(
                'yes', stats.yes_count,
                'no', stats.no_count,
                'counts', jsonb_build_object(
                    'playable_60', stats.playable_60_count,
                    'playable_30', stats.playable_30_count,
                    'low_fps', stats.low_fps_count,
                    'crash', stats.crash_count
                ),
                'reports', recent.reports
            )
        ),
        '{}'::jsonb
    )
    FROM (
        SELECT DISTINCT unnest(COALESCE(p_port_ids, ARRAY[]::text[])) AS port_id
    ) AS requested
    CROSS JOIN LATERAL (
        SELECT
            count(*) FILTER (WHERE status IN ('playable_30', 'playable_60'))::integer AS yes_count,
            count(*) FILTER (WHERE status IN ('crash', 'low_fps'))::integer AS no_count,
            count(*) FILTER (WHERE status = 'playable_60')::integer AS playable_60_count,
            count(*) FILTER (WHERE status = 'playable_30')::integer AS playable_30_count,
            count(*) FILTER (WHERE status = 'low_fps')::integer AS low_fps_count,
            count(*) FILTER (WHERE status = 'crash')::integer AS crash_count
        FROM public.compatibility_reports
        WHERE port_id = requested.port_id
    ) AS stats
    CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'deviceId', latest.device_id,
                'deviceName', COALESCE(NULLIF(d.model, ''), latest.device_name),
                'deviceSoc', COALESCE(d.soc, ''),
                'deviceType', COALESCE(NULLIF(d.device_type, ''), 'phone'),
                'status', latest.status,
                'works', latest.status IN ('playable_30', 'playable_60'),
                'updatedAt', latest.updated_at
            ) ORDER BY latest.updated_at DESC, latest.id DESC
        ), '[]'::jsonb) AS reports
        FROM (
            SELECT id, device_id, device_name, status, works, updated_at
            FROM public.compatibility_reports
            WHERE port_id = requested.port_id
            ORDER BY updated_at DESC, id DESC LIMIT 30
        ) AS latest
        LEFT JOIN public.devices d ON d.id = latest.device_id
    ) AS recent;
$function$;

DROP FUNCTION IF EXISTS public.upsert_compatibility_report(text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.upsert_compatibility_report(
    p_port_id text,
    p_token_hash text,
    p_device_id text,
    p_works boolean DEFAULT NULL,
    p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
    saved public.compatibility_reports%ROWTYPE;
    selected_device public.devices%ROWTYPE;
    resolved_status text;
    resolved_works boolean;
BEGIN
    SELECT * INTO selected_device FROM public.devices WHERE id = p_device_id;
    IF selected_device.id IS NULL THEN
        RAISE EXCEPTION 'Invalid device ID';
    END IF;

    IF p_status IN ('crash', 'low_fps', 'playable_30', 'playable_60') THEN
        resolved_status := p_status;
    ELSIF p_works IS TRUE THEN
        resolved_status := 'playable_30';
    ELSIF p_works IS FALSE THEN
        resolved_status := 'crash';
    ELSE
        RAISE EXCEPTION 'Invalid compatibility status';
    END IF;

    resolved_works := resolved_status IN ('playable_30', 'playable_60');

    INSERT INTO public.compatibility_reports
        (port_id, token_hash, device_id, device_name, works, status, updated_at)
    VALUES
        (p_port_id, p_token_hash, p_device_id, selected_device.name, resolved_works, resolved_status, now())
    ON CONFLICT (port_id, token_hash, device_id)
    DO UPDATE SET
        device_name = EXCLUDED.device_name,
        works = EXCLUDED.works,
        status = EXCLUDED.status,
        updated_at = now()
    RETURNING * INTO saved;

    RETURN jsonb_build_object(
        'report', jsonb_build_object(
            'portId', saved.port_id,
            'deviceId', saved.device_id,
            'deviceName', COALESCE(NULLIF(selected_device.model, ''), saved.device_name),
            'deviceSoc', COALESCE(selected_device.soc, ''),
            'deviceType', COALESCE(NULLIF(selected_device.device_type, ''), 'phone'),
            'status', saved.status,
            'works', saved.works,
            'updatedAt', saved.updated_at
        ),
        'summary', public.get_compatibility_for_ports(ARRAY[p_port_id]) -> p_port_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_compatibility_by_hardware(
    p_device_id text DEFAULT NULL,
    p_soc text DEFAULT NULL,
    p_query text DEFAULT NULL,
    p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_device_id text := trim(COALESCE(p_device_id, ''));
    v_soc text := trim(COALESCE(p_soc, ''));
    v_query text := trim(COALESCE(p_query, ''));
    v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
BEGIN
    IF v_device_id = '' AND v_soc = '' AND v_query = '' THEN
        RETURN '[]'::jsonb;
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'portId', row_data.port_id,
                'deviceId', row_data.device_id,
                'deviceName', row_data.resolved_name,
                'deviceSoc', row_data.resolved_soc,
                'deviceType', row_data.resolved_type,
                'status', row_data.status,
                'works', row_data.status IN ('playable_30', 'playable_60'),
                'updatedAt', row_data.updated_at
            )
            ORDER BY row_data.updated_at DESC, row_data.id DESC
        )
        FROM (
            SELECT
                cr.id,
                cr.port_id,
                cr.device_id,
                cr.status,
                cr.updated_at,
                COALESCE(NULLIF(d.model, ''), cr.device_name) AS resolved_name,
                COALESCE(d.soc, '') AS resolved_soc,
                COALESCE(NULLIF(d.device_type, ''), 'phone') AS resolved_type
            FROM public.compatibility_reports cr
            LEFT JOIN public.devices d ON d.id = cr.device_id
            WHERE (
                (v_device_id <> '' AND cr.device_id = v_device_id)
                OR (v_soc <> '' AND lower(COALESCE(d.soc, '')) = lower(v_soc))
                OR (
                    v_device_id = '' AND v_soc = '' AND v_query <> '' AND (
                        lower(COALESCE(NULLIF(d.model, ''), cr.device_name)) LIKE '%' || lower(v_query) || '%'
                        OR lower(COALESCE(d.soc, '')) LIKE '%' || lower(v_query) || '%'
                        OR lower(cr.device_name) LIKE '%' || lower(v_query) || '%'
                    )
                )
            )
            ORDER BY cr.updated_at DESC, cr.id DESC
            LIMIT v_limit
        ) AS row_data
    ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_compatibility_for_ports(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_compatibility_for_ports(text[]) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_compatibility_report(text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_compatibility_report(text, text, text, boolean, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_compatibility_by_hardware(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_compatibility_by_hardware(text, text, text, integer) TO service_role;
