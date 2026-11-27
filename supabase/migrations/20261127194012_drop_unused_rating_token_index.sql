-- Remove an unused index on rating_tokens.created_at; no active query filters by this column.
DROP INDEX IF EXISTS public.rating_tokens_created_idx;
