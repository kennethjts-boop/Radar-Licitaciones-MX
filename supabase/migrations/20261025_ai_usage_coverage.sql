-- Cobertura de la medición de IA (reporte diario de gastos).
--
-- http_attempts: intentos HTTP que hizo el SDK para una solicitud observada
--   (1 = sin reintentos internos). NULL = no observable (filas previas).
-- key_id: huella "sha256:" + 16 hex de la clave usada; NUNCA la clave.
--   Permite contrastar el contador de OpenRouter sólo con respuestas de la
--   misma clave.
--
-- El worker funciona sin esta migración: si las columnas no existen, registra
-- las filas sin ellas y el reporte indica "reintentos no medibles" y
-- "sin identidad de clave". Idempotente.

ALTER TABLE public.ai_usage_events
  ADD COLUMN IF NOT EXISTS http_attempts SMALLINT CHECK (http_attempts IS NULL OR http_attempts >= 1),
  ADD COLUMN IF NOT EXISTS key_id TEXT CHECK (key_id IS NULL OR key_id ~ '^sha256:[0-9a-f]{16}$');

SELECT pg_notify('pgrst', 'reload schema');
