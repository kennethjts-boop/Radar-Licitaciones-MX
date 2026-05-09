-- =============================================================================
-- MIGRACION FASE H: persistencia de enrichment OSINT, requisitos y similares
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- H3: scope y cache de enrichment en tablas existentes
ALTER TABLE procurements
  ADD COLUMN IF NOT EXISTS scope TEXT CHECK (
    scope IS NULL OR scope IN ('MORELOS_ONLY', 'NATIONAL_CAPUFE_DESIERTA', 'REJECTED_OUT_OF_SCOPE')
  ),
  ADD COLUMN IF NOT EXISTS enrichment_data JSONB,
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS opportunity_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scope TEXT CHECK (
    scope IS NULL OR scope IN ('MORELOS_ONLY', 'NATIONAL_CAPUFE_DESIERTA', 'REJECTED_OUT_OF_SCOPE')
  );

CREATE INDEX IF NOT EXISTS idx_procurements_scope ON procurements(scope);
CREATE INDEX IF NOT EXISTS idx_procurements_last_enriched_at ON procurements(last_enriched_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_score_breakdown ON matches(match_score DESC, opportunity_score DESC, document_score DESC);

-- H1: estado de jobs de enrichment
CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  radar_key TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('MORELOS_ONLY', 'NATIONAL_CAPUFE_DESIERTA')),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial_success', 'failed', 'skipped_no_documents')),
  documents_found INTEGER NOT NULL DEFAULT 0,
  documents_downloaded INTEGER NOT NULL DEFAULT 0,
  errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_procurement ON enrichment_jobs(procurement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON enrichment_jobs(status, created_at DESC);

-- H1: documentos descubiertos/descargados
CREATE TABLE IF NOT EXISTS procurement_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  job_id UUID REFERENCES enrichment_jobs(id) ON DELETE SET NULL,
  title TEXT,
  file_name TEXT,
  file_url TEXT NOT NULL,
  file_type TEXT,
  document_hint TEXT,
  sha256_hash TEXT,
  size_bytes INTEGER,
  local_path TEXT,
  download_status TEXT NOT NULL DEFAULT 'not_downloaded',
  classification_type TEXT,
  classification_confidence TEXT,
  parse_status TEXT,
  text_excerpt TEXT,
  discovered_at TIMESTAMPTZ,
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (procurement_id, file_url)
);

CREATE INDEX IF NOT EXISTS idx_procurement_documents_procurement ON procurement_documents(procurement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_procurement_documents_hash ON procurement_documents(sha256_hash);

-- H1: chunks de texto parseado para busqueda/RAG posterior
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_document_id UUID NOT NULL REFERENCES procurement_documents(id) ON DELETE CASCADE,
  procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (procurement_document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_procurement ON document_chunks(procurement_id);

-- H2: requisitos extraidos
CREATE TABLE IF NOT EXISTS procurement_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  procurement_document_id UUID REFERENCES procurement_documents(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('tecnico', 'economico', 'legal')),
  requirement_text TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('alta', 'media', 'baja')),
  matched_keywords_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_excerpt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_requirements_procurement ON procurement_requirements(procurement_id, category);

-- H2: senales de presupuesto
CREATE TABLE IF NOT EXISTS budget_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  procurement_document_id UUID REFERENCES procurement_documents(id) ON DELETE SET NULL,
  raw_text TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('alta', 'media', 'baja')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_signals_procurement ON budget_signals(procurement_id, amount DESC);

-- H2: antecedentes similares
CREATE TABLE IF NOT EXISTS similar_procedures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  procedure_id TEXT,
  title TEXT,
  supplier TEXT,
  awarded_amount NUMERIC(18,2),
  year INTEGER,
  similarity_score NUMERIC(5,4) NOT NULL,
  reason TEXT,
  evidence_url TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('MORELOS_ONLY', 'NATIONAL_CAPUFE_DESIERTA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_similar_procedures_procurement ON similar_procedures(procurement_id, similarity_score DESC);
