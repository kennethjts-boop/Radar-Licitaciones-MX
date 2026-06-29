CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tender_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  expediente TEXT,
  licitacion_id TEXT,
  document_name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'otro',
  original_url TEXT NOT NULL,
  public_url TEXT NOT NULL,
  mime_type TEXT,
  file_extension TEXT,
  file_size INTEGER,
  sha256_hash TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_available BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'ComprasMX',
  discard_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tender_id, public_url)
);

CREATE INDEX IF NOT EXISTS idx_tender_documents_tender ON tender_documents(tender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tender_documents_expediente ON tender_documents(expediente);
CREATE INDEX IF NOT EXISTS idx_tender_documents_sha256 ON tender_documents(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_tender_documents_available ON tender_documents(is_available, last_checked_at DESC);
