-- Keep all community data behind the Edge Functions' service role.
-- The browser now loads the device catalog from static GitHub JSON.
REVOKE ALL ON TABLE public.rating_votes FROM anon, authenticated;
REVOKE ALL ON TABLE public.devices FROM anon, authenticated;
DROP POLICY IF EXISTS "Public can read device catalog" ON public.devices;
DROP INDEX IF EXISTS public.idx_link_reports_port_id;
