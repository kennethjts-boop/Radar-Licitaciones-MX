-- =============================================================================
-- MIGRACIÓN 09: Agregar columnas faltantes detectadas en producción
-- Idempotente — seguro de ejecutar múltiples veces (IF NOT EXISTS en todo).
--
-- Errores corregidos:
--   - "Could not find the 'last_attachments_checked_at' column of 'procurements'"
--     → Migration 02 no fue aplicada en producción
--   - "Could not find the 'raw_data' column of 'raw_items'"
--     → El código usaba raw_data en lugar de raw_json (corregido en código)
-- =============================================================================

-- ── procurements: columnas de estrategia incremental (Fase 2A) ───────────────
ALTER TABLE procurements
  ADD COLUMN IF NOT EXISTS lightweight_fingerprint      TEXT,
  ADD COLUMN IF NOT EXISTS last_detail_checked_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attachments_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_item_id                  UUID REFERENCES raw_items(id);

-- Índices para la estrategia incremental
CREATE INDEX IF NOT EXISTS idx_proc_source_ext_id   ON procurements (source_id, external_id);
CREATE INDEX IF NOT EXISTS idx_proc_lightweight_fp  ON procurements (lightweight_fingerprint);

COMMENT ON COLUMN procurements.lightweight_fingerprint
  IS 'Fingerprint superficial calculado sobre los datos del listado, para evitar detail fetch si no cambia';
COMMENT ON COLUMN procurements.last_detail_checked_at
  IS 'Fecha del último scrape a profundidad nivel 2 (Detail)';
COMMENT ON COLUMN procurements.last_attachments_checked_at
  IS 'Fecha del último chequeo de documentos adjuntos (Nivel 3)';
COMMENT ON COLUMN procurements.raw_item_id
  IS 'FK al raw_item original de donde se derivó este procurement';
