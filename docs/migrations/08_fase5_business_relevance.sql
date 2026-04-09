-- Fase 5: Perfil de Interés y relevancia de negocio
-- Agrega señales para filtrar alertas VIP de IA por pertinencia real.

ALTER TABLE document_analysis
  ADD COLUMN IF NOT EXISTS is_relevant BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS category_detected TEXT,
  ADD COLUMN IF NOT EXISTS relevance_justification TEXT;

CREATE INDEX IF NOT EXISTS idx_document_analysis_relevance
  ON document_analysis (is_relevant, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_analysis_category_detected
  ON document_analysis (category_detected, created_at DESC);
