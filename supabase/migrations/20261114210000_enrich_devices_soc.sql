ALTER TABLE public.devices
    ADD COLUMN IF NOT EXISTS manufacturer text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS soc text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS device_type text NOT NULL DEFAULT 'phone';

CREATE INDEX IF NOT EXISTS devices_soc_idx
    ON public.devices (soc);

CREATE INDEX IF NOT EXISTS devices_type_idx
    ON public.devices (device_type);

CREATE OR REPLACE FUNCTION public.get_compatibility_devices()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', id,
                'name', name,
                'manufacturer', manufacturer,
                'model', model,
                'soc', soc,
                'deviceType', device_type
            )
            ORDER BY name COLLATE "C"
        ),
        '[]'::jsonb
    )
    FROM public.devices;
$function$;

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
                'reports', recent.reports
            )
        ),
        '{}'::jsonb
    )
    FROM (
        SELECT DISTINCT unnest(COALESCE(p_port_ids, ARRAY[]::text[])) AS port_id
    ) AS requested
    CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE works IS TRUE)::integer AS yes_count,
               count(*) FILTER (WHERE works IS FALSE)::integer AS no_count
        FROM public.compatibility_reports WHERE port_id = requested.port_id
    ) AS stats
    CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'deviceId', latest.device_id,
                'deviceName', COALESCE(NULLIF(d.model, ''), latest.device_name),
                'deviceSoc', COALESCE(d.soc, ''),
                'deviceType', COALESCE(NULLIF(d.device_type, ''), 'phone'),
                'works', latest.works,
                'updatedAt', latest.updated_at
            ) ORDER BY latest.updated_at DESC, latest.id DESC
        ), '[]'::jsonb) AS reports
        FROM (
            SELECT id, device_id, device_name, works, updated_at
            FROM public.compatibility_reports
            WHERE port_id = requested.port_id
            ORDER BY updated_at DESC, id DESC LIMIT 30
        ) AS latest
        LEFT JOIN public.devices d ON d.id = latest.device_id
    ) AS recent;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_compatibility_report(
    p_port_id text,
    p_token_hash text,
    p_device_id text,
    p_works boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
    saved public.compatibility_reports%ROWTYPE;
    selected_device public.devices%ROWTYPE;
BEGIN
    SELECT * INTO selected_device FROM public.devices WHERE id = p_device_id;
    IF selected_device.id IS NULL THEN
        RAISE EXCEPTION 'Invalid device ID';
    END IF;

    INSERT INTO public.compatibility_reports
        (port_id, token_hash, device_id, device_name, works, updated_at)
    VALUES
        (p_port_id, p_token_hash, p_device_id, selected_device.name, p_works, now())
    ON CONFLICT (port_id, token_hash, device_id)
    DO UPDATE SET
        device_name = EXCLUDED.device_name,
        works = EXCLUDED.works,
        updated_at = now()
    RETURNING * INTO saved;

    RETURN jsonb_build_object(
        'report', jsonb_build_object(
            'portId', saved.port_id,
            'deviceId', saved.device_id,
            'deviceName', COALESCE(NULLIF(selected_device.model, ''), saved.device_name),
            'deviceSoc', COALESCE(selected_device.soc, ''),
            'deviceType', COALESCE(NULLIF(selected_device.device_type, ''), 'phone'),
            'works', saved.works,
            'updatedAt', saved.updated_at
        ),
        'summary', public.get_compatibility_for_ports(ARRAY[p_port_id]) -> p_port_id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_compatibility_devices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_compatibility_devices() TO service_role;
REVOKE ALL ON FUNCTION public.get_compatibility_for_ports(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_compatibility_for_ports(text[]) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_compatibility_report(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_compatibility_report(text, text, text, boolean) TO service_role;
