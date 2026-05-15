-- =============================================================================
-- 12_external_leads_osint.sql
-- Leads comerciales OSINT externos a ComprasMX.
-- Seguro por defecto: las tablas solo son usadas si ENABLE_EXTERNAL_LEADS_OSINT=true.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS external_leads (
  id                                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_name                         TEXT NOT NULL,
  source_url                          TEXT NOT NULL,
  detected_at                         TIMESTAMPTZ NOT NULL,
  title                               TEXT NOT NULL,
  organization_name                   TEXT,
  organization_type                   TEXT,
  state                               TEXT,
  municipality                        TEXT,
  sector                              TEXT,
  vertical                            TEXT NOT NULL,
  matched_keywords                    JSONB NOT NULL DEFAULT '[]',
  evidence_text                       TEXT NOT NULL,
  contact_area                        TEXT,
  contact_name_public_optional        TEXT,
  contact_email_public_optional       TEXT,
  contact_phone_public_optional       TEXT,
  estimated_interest_score            INTEGER NOT NULL DEFAULT 0,
  opportunity_type                    TEXT NOT NULL,
  confidence                          TEXT NOT NULL CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  next_action                         TEXT NOT NULL,
  status                              TEXT NOT NULL DEFAULT 'new',
  amount_visible                      BOOLEAN NOT NULL DEFAULT FALSE,
  buyer_area_identified               BOOLEAN NOT NULL DEFAULT FALSE,
  is_official_source                  BOOLEAN NOT NULL DEFAULT FALSE,
  source_published_at                 TIMESTAMPTZ,
  raw_json                            JSONB NOT NULL DEFAULT '{}',
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fingerprint_hash                    TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_external_leads_detected_at
  ON external_leads (detected_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_leads_fingerprint_hash
  ON external_leads (fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_external_leads_vertical
  ON external_leads (vertical, estimated_interest_score DESC);
CREATE INDEX IF NOT EXISTS idx_external_leads_state
  ON external_leads (state);
CREATE INDEX IF NOT EXISTS idx_external_leads_score_confidence
  ON external_leads (estimated_interest_score DESC, confidence);
CREATE INDEX IF NOT EXISTS idx_external_leads_status
  ON external_leads (status);

CREATE TABLE IF NOT EXISTS external_lead_alerts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_lead_id      UUID REFERENCES external_leads(id) ON DELETE CASCADE,
  fingerprint_hash      TEXT NOT NULL UNIQUE,
  telegram_message      TEXT NOT NULL,
  telegram_status       TEXT NOT NULL DEFAULT 'pending'
                          CHECK (telegram_status IN ('pending', 'sent', 'failed')),
  telegram_message_id   INTEGER,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_lead_alerts_status
  ON external_lead_alerts (telegram_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_lead_alerts_fingerprint_hash
  ON external_lead_alerts (fingerprint_hash);

CREATE OR REPLACE FUNCTION update_external_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_external_leads_updated_at ON external_leads;
CREATE TRIGGER trg_external_leads_updated_at
  BEFORE UPDATE ON external_leads
  FOR EACH ROW EXECUTE FUNCTION update_external_leads_updated_at();
