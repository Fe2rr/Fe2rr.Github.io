DO $$
DECLARE
  pair record;
  source_exists boolean;
  target_exists boolean;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('catalog:htc-htc-u11-eyes-msm8976-07ebf4a9', 'catalog:htc-u11-eyes-snapdragon-652-c4063b33'),
      ('catalog:infinix-infinix-note-40-mediatek-mt6789v-cd-00151cdf', 'catalog:infinix-note-40-mediatek-helio-g99-0fa94324'),
      ('catalog:poco-poco-f4-sm8250-4c175080', 'catalog:poco-f4-snapdragon-865-9d6fc7aa'),
      ('catalog:poco-poco-f8-pro-qti-sm8750-71aa111a', 'catalog:poco-f8-pro-snapdragon-8-elite-1568d549'),
      ('catalog:poco-poco-x3-sm7150-8b307caf', 'catalog:poco-x3-snapdragon-730g-cbd78ca1'),
      ('catalog:poco-poco-x6-5g-sm7435-2e8a09da', 'catalog:poco-x6-5g-snapdragon-7s-gen-2-19ad278f'),
      ('catalog:poco-poco-x7-pro-mediatek-mt6899-5d64aed0', 'catalog:poco-x7-pro-mediatek-dimensity-8400-0a32e6ca'),
      ('catalog:realme-realme-9pro-5g-qti-sm6375-29bfdd90', 'catalog:realme-9pro-5g-snapdragon-695-e8ad2fa0'),
      ('redmi-10c', 'catalog:redmi-10c-snapdragon-680-366e4d05'),
      ('catalog:redmi-redmi-10c-snapdragon-680-f3ba292a', 'catalog:redmi-10c-snapdragon-680-366e4d05')
    ) AS mappings(source_id, target_id)
  LOOP
    SELECT EXISTS (SELECT 1 FROM public.devices WHERE id = pair.source_id) INTO source_exists;
    SELECT EXISTS (SELECT 1 FROM public.devices WHERE id = pair.target_id) INTO target_exists;
    IF source_exists AND NOT target_exists THEN
      RAISE EXCEPTION 'Target device % does not exist', pair.target_id;
    END IF;
    IF source_exists THEN
      UPDATE public.compatibility_reports
      SET device_id = pair.target_id
      WHERE device_id = pair.source_id;
      DELETE FROM public.devices WHERE id = pair.source_id;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_compatibility_devices()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
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
  FROM public.devices
  WHERE NULLIF(BTRIM(manufacturer), '') IS NOT NULL
    AND NULLIF(BTRIM(model), '') IS NOT NULL
    AND NULLIF(BTRIM(soc), '') IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_compatibility_devices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_compatibility_devices() TO service_role;
