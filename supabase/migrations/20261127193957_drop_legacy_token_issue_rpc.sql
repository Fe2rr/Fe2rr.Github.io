-- Replaced by napl_issue_rating_token, which performs rate limiting and token creation atomically.
DROP FUNCTION IF EXISTS public.napl_record_token_issue(text);
