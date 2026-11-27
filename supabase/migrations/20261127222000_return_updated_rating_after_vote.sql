CREATE OR REPLACE FUNCTION public.napl_submit_vote(p_port_id text, p_token_hash text, p_stars smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    already_voted boolean;
    recent_votes integer;
    port_votes integer;
    port_avg numeric;
    global_avg numeric;
    weighted_score numeric;
BEGIN
    IF p_port_id IS NULL OR length(p_port_id) < 1 OR length(p_port_id) > 120
       OR p_token_hash IS NULL OR length(p_token_hash) <> 64
       OR p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
        RAISE EXCEPTION 'invalid_vote' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_token_hash, 0));

    SELECT EXISTS (
        SELECT 1 FROM public.rating_votes
        WHERE port_id = p_port_id AND token_hash = p_token_hash
    ) INTO already_voted;

    IF NOT already_voted THEN
        SELECT count(*)::integer INTO recent_votes
        FROM public.rating_votes
        WHERE token_hash = p_token_hash
          AND created_at > now() - interval '1 hour';

        IF recent_votes >= 20 THEN
            RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    INSERT INTO public.rating_votes (port_id, token_hash, stars, created_at, updated_at)
    VALUES (p_port_id, p_token_hash, p_stars, now(), now())
    ON CONFLICT (port_id, token_hash)
    DO UPDATE SET stars = EXCLUDED.stars, updated_at = now();

    SELECT count(*)::integer, avg(stars)::numeric
    INTO port_votes, port_avg
    FROM public.rating_votes
    WHERE port_id = p_port_id;

    SELECT COALESCE(avg(stars), 0)::numeric
    INTO global_avg
    FROM public.rating_votes;

    weighted_score := round(
        (port_votes::numeric / (port_votes + 5)) * port_avg
        + (5::numeric / (port_votes + 5)) * global_avg,
        2
    );

    RETURN jsonb_build_object(
        'ok', true,
        'port_id', p_port_id,
        'stars', p_stars,
        'rating', jsonb_build_object(
            'avg', round(port_avg, 2),
            'votes', port_votes,
            'score', weighted_score
        )
    );
END;
$function$;
