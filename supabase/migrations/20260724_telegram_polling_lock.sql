CREATE TABLE IF NOT EXISTS public.bot_lock (
  key TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.claim_polling_lock(
  p_key TEXT,
  p_instance TEXT,
  p_ttl_ms INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  claimed BOOLEAN;
BEGIN
  INSERT INTO public.bot_lock AS current_lock (key, instance_id, updated_at)
  VALUES (p_key, p_instance, NOW())
  ON CONFLICT (key) DO UPDATE
    SET instance_id = p_instance,
        updated_at = NOW()
    WHERE current_lock.instance_id = p_instance
       OR current_lock.updated_at
          < NOW() - make_interval(secs => p_ttl_ms / 1000.0)
  RETURNING TRUE INTO claimed;

  RETURN COALESCE(claimed, FALSE);
END;
$$;

REVOKE ALL ON TABLE public.bot_lock FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bot_lock TO service_role;

REVOKE ALL ON FUNCTION public.claim_polling_lock(TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_polling_lock(TEXT, TEXT, INTEGER)
  TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
