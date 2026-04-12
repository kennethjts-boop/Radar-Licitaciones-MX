-- =============================================================================
-- MIGRACIÓN FASE 4: motor de oportunidad y win probability
-- =============================================================================

ALTER TABLE document_analysis
  ADD COLUMN IF NOT EXISTS win_probability INTEGER CHECK (win_probability >= 0 AND win_probability <= 100),
  ADD COLUMN IF NOT EXISTS competitor_threat_level VARCHAR(10) CHECK (competitor_threat_level IN ('LOW', 'MEDIUM', 'HIGH')),
  ADD COLUMN IF NOT EXISTS implementation_complexity VARCHAR(10) CHECK (implementation_complexity IN ('LOW', 'MEDIUM', 'HIGH')),
  ADD COLUMN IF NOT EXISTS red_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_document_analysis_win_probability
  ON document_analysis (win_probability DESC);

CREATE INDEX IF NOT EXISTS idx_document_analysis_threat_level
  ON document_analysis (competitor_threat_level, created_at DESC);
