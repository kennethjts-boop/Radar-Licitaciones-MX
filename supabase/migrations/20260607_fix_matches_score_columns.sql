ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS opportunity_score NUMERIC(5,4) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS document_score NUMERIC(5,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_matches_score_breakdown
ON public.matches(match_score DESC, opportunity_score DESC, document_score DESC);

SELECT pg_notify('pgrst', 'reload schema');
