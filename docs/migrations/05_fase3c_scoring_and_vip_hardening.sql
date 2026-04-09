-- =============================================================================
-- MIGRACIÓN FASE 3C: scoring avanzado + metadata de negocio + anti-duplicados
-- =============================================================================

ALTER TABLE document_analysis
  RENAME COLUMN score TO score_total;

ALTER TABLE document_analysis
  ADD COLUMN IF NOT EXISTS score_tech INTEGER CHECK (score_tech >= 0 AND score_tech <= 100),
  ADD COLUMN IF NOT EXISTS score_commercial INTEGER CHECK (score_commercial >= 0 AND score_commercial <= 100),
  ADD COLUMN IF NOT EXISTS score_urgency INTEGER CHECK (score_urgency >= 0 AND score_urgency <= 100),
  ADD COLUMN IF NOT EXISTS score_viability INTEGER CHECK (score_viability >= 0 AND score_viability <= 100),
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(255),
  ADD COLUMN IF NOT EXISTS deadline VARCHAR(255),
  ADD COLUMN IF NOT EXISTS guarantees TEXT,
  ADD COLUMN IF NOT EXISTS alert_sent BOOLEAN NOT NULL DEFAULT FALSE;

DROP INDEX IF EXISTS idx_document_analysis_score;

CREATE INDEX IF NOT EXISTS idx_document_analysis_score_total
  ON document_analysis (score_total DESC);

CREATE INDEX IF NOT EXISTS idx_document_analysis_alert_sent
  ON document_analysis (alert_sent, created_at DESC);
