-- =============================================================================
-- MIGRACIÓN FASE 3: análisis documental con OpenAI
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS document_analysis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attachment_id UUID NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  summary TEXT NOT NULL,
  opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_analysis_score
  ON document_analysis (score DESC);

CREATE INDEX IF NOT EXISTS idx_document_analysis_created_at
  ON document_analysis (created_at DESC);
