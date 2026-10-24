-- Registro mínimo de consumo de IA para el reporte diario de gastos.
--
-- Sólo metadatos: proveedor, modelo, operación, fecha, tokens, estado,
-- intento y costo. NUNCA prompts, respuestas, textos de error ni claves.
-- Las filas nuevas no reconstruyen consumo histórico anterior a esta tabla.
--
-- Los cortes del contador de OpenRouter y el estado de envío del reporte
-- viven en system_state (claves cost_snapshot:* y cost_report:*), sin tablas
-- adicionales.

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'openrouter')),
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  attempt SMALLINT NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  -- Costo informado por el proveedor en la respuesta (OpenRouter usage.cost).
  cost_reported_usd NUMERIC(14, 8),
  -- Costo calculado con tokens × tarifa verificada (pricing.ts).
  cost_estimated_usd NUMERIC(14, 8),
  -- Clasificación corta (http_429, timeout, network...). Sin mensajes.
  error_kind TEXT CHECK (error_kind IS NULL OR length(error_kind) <= 40)
);

CREATE INDEX IF NOT EXISTS ai_usage_events_occurred_at_idx
  ON public.ai_usage_events (occurred_at);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_usage_events FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.ai_usage_events TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
