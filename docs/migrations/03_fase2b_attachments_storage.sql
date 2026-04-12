-- =============================================================================
-- MIGRACIÓN FASE 2B: modelo robusto de attachments para Data Lake OSINT
-- =============================================================================
-- Objetivo:
-- 1) Si la tabla NO existe, crearla con campos para Storage.
-- 2) Si la tabla YA existe, endurecerla con ALTER TABLE sin romper compatibilidad.
-- 3) Garantizar anti-duplicado por expediente + nombre de archivo.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  storage_path TEXT NOT NULL,
  file_type VARCHAR(100),
  file_size_bytes BIGINT,
  file_hash VARCHAR(64),
  source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Mantener compatibilidad con instalaciones previas:
-- file_hash puede existir como TEXT. Si no existe, se crea.
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64);

-- Anti-duplicado por expediente + nombre visible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attachments_proc_file
  ON attachments (procurement_id, file_name);

-- Índices de soporte para consultas y deduplicación por contenido.
CREATE INDEX IF NOT EXISTS idx_attachments_procurement_id
  ON attachments (procurement_id);

CREATE INDEX IF NOT EXISTS idx_attachments_file_hash
  ON attachments (file_hash);

COMMENT ON COLUMN attachments.storage_path IS
  'Ruta relativa en Supabase Storage (bucket tender-documents): [procurement_id]/[file_name]';
COMMENT ON COLUMN attachments.file_hash IS
  'SHA-256 del archivo para deduplicación fuerte';
