-- =============================================================================
-- MIGRACIÓN FASE 2A: Agregar campos para estrategia incremental en procurements
-- =============================================================================

ALTER TABLE procurements
ADD COLUMN IF NOT EXISTS lightweight_fingerprint TEXT,
ADD COLUMN IF NOT EXISTS last_detail_checked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_attachments_checked_at TIMESTAMPTZ;

-- Índice para búsqueda rápida combinando origin y external_id (clave natural) para la decisión incremental
CREATE INDEX IF NOT EXISTS idx_proc_source_ext_id ON procurements (source_id, external_id);

-- Índice en el nuevo fingerprint superficial
CREATE INDEX IF NOT EXISTS idx_proc_lightweight_fp ON procurements (lightweight_fingerprint);

-- Comentario documental
COMMENT ON COLUMN procurements.lightweight_fingerprint IS 'Fingerprint superficial calculado sobre los datos de la lista, usado para evitar entrar al detalle si no cambia';
COMMENT ON COLUMN procurements.last_detail_checked_at IS 'Fecha del último scrape a profundidad nivel 2 (Detail)';
COMMENT ON COLUMN procurements.last_attachments_checked_at IS 'Fecha del último chequeo a los documentos (Nivel 3)';
