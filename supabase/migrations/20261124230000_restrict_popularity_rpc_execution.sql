-- Keep popularity RPCs behind the Edge Function, which supplies the server-side key.
REVOKE EXECUTE ON FUNCTION public.napl_register_game_visit(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.napl_get_popularity(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.napl_register_game_visit(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.napl_get_popularity(text) TO service_role;
