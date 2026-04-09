-- =============================================================================
-- MIGRACIÓN FASE 2B: Adjuntos en Supabase Storage + metadata incremental
-- =============================================================================

ALTER TABLE attachments
ADD COLUMN IF NOT EXISTS storage_path TEXT,
ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

CREATE INDEX IF NOT EXISTS idx_attachments_procurement_filename
  ON attachments (procurement_id, file_name);

COMMENT ON COLUMN attachments.storage_path IS
  'Ruta relativa en Supabase Storage (bucket tender-documents): [procurement_id]/[file_name]';
COMMENT ON COLUMN attachments.file_size_bytes IS
  'Tamaño del archivo descargado en bytes';
