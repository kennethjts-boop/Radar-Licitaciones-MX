-- Lock distribuido para ciclos de colección (collect-job / recheck-job).
--
-- Reusa la tabla bot_lock y la función claim_polling_lock que ya introdujo
-- 20260724_telegram_polling_lock.sql para el polling de Telegram. Esa función
-- no tiene nada específico de polling: es un upsert genérico "reclama la fila
-- si nadie más la tiene vigente, o si el dueño actual soy yo mismo" parametrizado
-- por (key, instance, ttl_ms). Por eso NO se duplica aquí con otro nombre —
-- claim_polling_lock("collect-job", instance, ttl_ms) sirve tal cual para
-- reclamar/renovar el lock de un ciclo de colección.
--
-- Lo único que faltaba para reusar el patrón en collect.job.ts es un release
-- explícito (el polling nunca libera su lock: vive mientras el proceso vive y
-- se abandona por TTL). Los ciclos de colección sí terminan y deben soltar el
-- lock de inmediato para no bloquear el siguiente ciclo hasta que expire el TTL.

CREATE TABLE IF NOT EXISTS public.bot_lock (
  key TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.release_job_lock(
  p_key TEXT,
  p_instance TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  released BOOLEAN;
BEGIN
  DELETE FROM public.bot_lock
  WHERE key = p_key
    AND instance_id = p_instance
  RETURNING TRUE INTO released;

  RETURN COALESCE(released, FALSE);
END;
$$;

REVOKE ALL ON TABLE public.bot_lock FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bot_lock TO service_role;

REVOKE ALL ON FUNCTION public.release_job_lock(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_job_lock(TEXT, TEXT)
  TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
