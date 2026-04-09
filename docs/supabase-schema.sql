-- =============================================================================
-- RADAR LICITACIONES MX — Esquema Supabase (PostgreSQL)
-- Versión: Phase 0
-- Ejecutar en el SQL Editor de Supabase en orden.
-- =============================================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Para búsquedas de texto full

-- =============================================================================
-- 1. SOURCES — Fuentes de datos
-- =============================================================================
CREATE TABLE IF NOT EXISTS sources (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('web_scraper', 'api', 'rss', 'pdf', 'search')),
  base_url      TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed inicial de fuentes
INSERT INTO sources (key, name, type, base_url) VALUES
  ('comprasmx',          'Compras MX (CompraNet)',         'web_scraper', 'https://www.comprasmx.gob.mx/'),
  ('dof',                'Diario Oficial de la Federación','web_scraper', 'https://dof.gob.mx/'),
  ('institutional',      'Sitios Institucionales',        'web_scraper', 'https://'),
  ('fallback_search',    'Fallback Search',               'search',      'https://')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 2. COLLECT_RUNS — Registro de ciclos de colección
-- =============================================================================
CREATE TABLE IF NOT EXISTS collect_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id       UUID NOT NULL REFERENCES sources(id),
  collector_key   TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'error', 'timeout')),
  items_seen      INTEGER NOT NULL DEFAULT 0,
  items_created   INTEGER NOT NULL DEFAULT 0,
  items_updated   INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  metadata_json   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collect_runs_collector_key ON collect_runs (collector_key, started_at DESC);
CREATE INDEX idx_collect_runs_status ON collect_runs (status);

-- =============================================================================
-- 3. RAW_ITEMS — Items crudos tal como vienen de la fuente
-- =============================================================================
CREATE TABLE IF NOT EXISTS raw_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id     UUID NOT NULL REFERENCES sources(id),
  external_id   TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_json      JSONB NOT NULL,
  raw_text      TEXT,
  fingerprint   TEXT NOT NULL,              -- SHA-256 del raw_json
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_raw_items_source_external UNIQUE (source_id, external_id)
);

CREATE INDEX idx_raw_items_fingerprint ON raw_items (fingerprint);
CREATE INDEX idx_raw_items_fetched_at ON raw_items (fetched_at DESC);

-- =============================================================================
-- 4. PROCUREMENTS — Expedientes normalizados
-- =============================================================================
CREATE TABLE IF NOT EXISTS procurements (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id             UUID NOT NULL REFERENCES sources(id),
  external_id           TEXT NOT NULL,
  expediente_id         TEXT,              -- e.g. EA-009000002-E1-2024
  licitation_number     TEXT,              -- Número de licitación oficial
  procedure_number      TEXT,              -- Número de procedimiento
  title                 TEXT NOT NULL,
  description           TEXT,
  dependency_name       TEXT,
  buying_unit           TEXT,
  procedure_type        TEXT NOT NULL DEFAULT 'unknown',
  status                TEXT NOT NULL DEFAULT 'unknown',
  publication_date      DATE,
  opening_date          DATE,
  award_date            DATE,
  state                 TEXT,
  municipality          TEXT,
  amount                NUMERIC(18, 2),
  currency              TEXT,
  source_url            TEXT NOT NULL,
  canonical_text        TEXT NOT NULL,
  canonical_fingerprint TEXT NOT NULL,
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_procurements_source_external UNIQUE (source_id, external_id)
);

-- Índices para búsqueda y deduplicación
CREATE INDEX idx_procurements_canonical_fp ON procurements (canonical_fingerprint);
CREATE INDEX idx_procurements_status ON procurements (status);
CREATE INDEX idx_procurements_last_seen ON procurements (last_seen_at DESC);
CREATE INDEX idx_procurements_dependency ON procurements (dependency_name);
CREATE INDEX idx_procurements_expediente ON procurements (expediente_id);
-- Full text search en título
CREATE INDEX idx_procurements_title_trgm ON procurements USING gin (title gin_trgm_ops);
CREATE INDEX idx_procurements_canonical_trgm ON procurements USING gin (canonical_text gin_trgm_ops);

-- =============================================================================
-- 5. PROCUREMENT_VERSIONS — Historial de cambios por expediente
-- =============================================================================
CREATE TABLE IF NOT EXISTS procurement_versions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  procurement_id        UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  version_number        INTEGER NOT NULL DEFAULT 1,
  status                TEXT,
  title                 TEXT,
  description           TEXT,
  publication_date      DATE,
  source_url            TEXT,
  fingerprint           TEXT NOT NULL,
  changed_fields_json   JSONB,            -- { campo: { prev, next } }
  raw_snapshot_json     JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_procurement_version UNIQUE (procurement_id, version_number)
);

CREATE INDEX idx_proc_versions_procurement ON procurement_versions (procurement_id, version_number DESC);

-- =============================================================================
-- 6. ATTACHMENTS — Adjuntos de expedientes
-- =============================================================================
CREATE TABLE IF NOT EXISTS attachments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  procurement_id  UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  version_id      UUID REFERENCES procurement_versions(id),
  file_name       TEXT NOT NULL,
  file_type       TEXT,
  file_url        TEXT NOT NULL,
  storage_path    TEXT,
  file_size_bytes BIGINT,
  file_hash       TEXT,
  source_url      TEXT,
  detected_text   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_procurement ON attachments (procurement_id);
CREATE UNIQUE INDEX uq_attachments_proc_file ON attachments (procurement_id, file_name);
CREATE INDEX idx_attachments_file_hash ON attachments (file_hash);

-- =============================================================================
-- 7. RADARS — Configuración de radares
-- =============================================================================
CREATE TABLE IF NOT EXISTS radars (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key              TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  description      TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  priority         INTEGER NOT NULL DEFAULT 3,       -- 1 más alta
  schedule_minutes INTEGER NOT NULL DEFAULT 30,
  config_json      JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed de radares
INSERT INTO radars (key, name, priority, is_active) VALUES
  ('capufe_emergencia',          'CAPUFE — Vehículos y Equipamiento de Emergencia',       1, TRUE),
  ('capufe_peaje',               'CAPUFE — Insumos y Equipos de Caseta de Peaje',          1, TRUE),
  ('capufe_oportunidades',       'CAPUFE — Oportunidades (Desiertas / Baja Competencia)', 2, TRUE),
  ('issste_oficinas_centrales',  'ISSSTE — Oficinas Centrales y Servicios Administrativos',1, TRUE),
  ('conavi_federal',             'CONAVI — Federal (Vivienda y Subsidios)',                 2, TRUE),
  ('imss_morelos',               'IMSS — Delegación Morelos (OOAD)',                        1, TRUE),
  ('imss_bienestar_morelos',     'IMSS Bienestar — Morelos (Hospitales Comunitarios)',      1, TRUE),
  ('habitat_morelos',            'Hábitat — Morelos (Programas de Mejoramiento Urbano)',    3, TRUE)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 8. RADAR_RULES — Reglas individuales de cada radar
-- =============================================================================
CREATE TABLE IF NOT EXISTS radar_rules (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  radar_id      UUID NOT NULL REFERENCES radars(id) ON DELETE CASCADE,
  rule_type     TEXT NOT NULL,        -- 'keyword' | 'entity' | 'geo' | 'status' | 'dependency'
  field_name    TEXT NOT NULL,
  operator      TEXT NOT NULL,        -- 'contains' | 'exact' | 'any_of' | 'none_of' | 'regex'
  value         TEXT NOT NULL,        -- JSON string si es array
  weight        NUMERIC(3, 2) NOT NULL DEFAULT 0.5,
  is_required   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_radar_rules_radar ON radar_rules (radar_id);

-- =============================================================================
-- 9. MATCHES — Coincidencias de expedientes contra radares
-- =============================================================================
CREATE TABLE IF NOT EXISTS matches (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  radar_id              UUID NOT NULL REFERENCES radars(id),
  procurement_id        UUID NOT NULL REFERENCES procurements(id),
  match_score           NUMERIC(4, 3) NOT NULL,      -- 0.000 – 1.000
  match_level           TEXT NOT NULL CHECK (match_level IN ('high', 'medium', 'low')),
  matched_terms_json    JSONB NOT NULL DEFAULT '[]',
  excluded_terms_json   JSONB NOT NULL DEFAULT '[]',
  explanation           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_match_radar_procurement UNIQUE (radar_id, procurement_id)
);

CREATE INDEX idx_matches_radar ON matches (radar_id, created_at DESC);
CREATE INDEX idx_matches_procurement ON matches (procurement_id);
CREATE INDEX idx_matches_level ON matches (match_level);

-- =============================================================================
-- 10. ALERTS — Alertas enviadas por Telegram
-- =============================================================================
CREATE TABLE IF NOT EXISTS alerts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  radar_id              UUID REFERENCES radars(id),
  procurement_id        UUID REFERENCES procurements(id),
  alert_type            TEXT NOT NULL,   -- 'new_match' | 'status_change' | 'new_document' | 'daily_summary' | 'system'
  telegram_message      TEXT NOT NULL,
  telegram_status       TEXT NOT NULL DEFAULT 'pending'
                          CHECK (telegram_status IN ('pending', 'sent', 'failed')),
  telegram_message_id   INTEGER,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_status ON alerts (telegram_status, created_at DESC);
CREATE INDEX idx_alerts_radar ON alerts (radar_id);

-- =============================================================================
-- 11. TELEGRAM_LOGS — Log de comandos recibidos
-- =============================================================================
CREATE TABLE IF NOT EXISTS telegram_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  command           TEXT NOT NULL,
  request_payload   JSONB,
  response_payload  JSONB,
  status            TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_telegram_logs_created ON telegram_logs (created_at DESC);

-- =============================================================================
-- 12. DAILY_SUMMARIES — Resúmenes diarios
-- =============================================================================
CREATE TABLE IF NOT EXISTS daily_summaries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  summary_date    DATE NOT NULL UNIQUE,
  total_seen      INTEGER NOT NULL DEFAULT 0,
  total_new       INTEGER NOT NULL DEFAULT 0,
  total_updated   INTEGER NOT NULL DEFAULT 0,
  total_matches   INTEGER NOT NULL DEFAULT 0,
  total_alerts    INTEGER NOT NULL DEFAULT 0,
  summary_text    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 13. ENTITY_MEMORY — Memoria de entidades para expansión semántica
-- =============================================================================
CREATE TABLE IF NOT EXISTS entity_memory (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type           TEXT NOT NULL CHECK (entity_type IN ('institution', 'person', 'product', 'geo', 'concept')),
  entity_key            TEXT NOT NULL UNIQUE,
  aliases_json          JSONB NOT NULL DEFAULT '[]',
  context_terms_json    JSONB NOT NULL DEFAULT '[]',
  exclusion_terms_json  JSONB NOT NULL DEFAULT '[]',
  geo_terms_json        JSONB NOT NULL DEFAULT '[]',
  metadata_json         JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed de entidades base
INSERT INTO entity_memory (entity_type, entity_key, aliases_json, context_terms_json, geo_terms_json) VALUES
  ('institution', 'capufe', '["Caminos y Puentes Federales", "CAPUFE"]', '["carretera", "autopista", "peaje", "caseta", "vialidad"]', '[]'),
  ('institution', 'issste', '["ISSSTE", "Instituto de Seguridad y Servicios Sociales de los Trabajadores del Estado"]', '["salud", "pension", "trabajadores del estado"]', '[]'),
  ('institution', 'conavi', '["CONAVI", "Comisión Nacional de Vivienda"]', '["vivienda", "subsidio", "habitacional"]', '[]'),
  ('institution', 'imss',   '["IMSS", "Instituto Mexicano del Seguro Social"]', '["salud", "seguro social", "medico"]', '["morelos", "cdmx"]'),
  ('geo', 'morelos', '["Estado de Morelos", "Mor."]', '[]', '["cuernavaca", "cuautla", "jiutepec", "temixco", "jojutla"]')
ON CONFLICT (entity_key) DO NOTHING;

-- =============================================================================
-- 14. SYSTEM_STATE — Estado del sistema (scheduler, locks, config)
-- =============================================================================
CREATE TABLE IF NOT EXISTS system_state (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key           TEXT NOT NULL UNIQUE,
  value_json    JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed de estado inicial
INSERT INTO system_state (key, value_json) VALUES
  ('scheduler_status', '{"status": "inactive", "lastCycle": null}'),
  ('last_collect_run', '{"collectorKey": null, "startedAt": null, "status": null}')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- Row Level Security (desactivado para service_role — habilitarlo si se añade auth)
-- =============================================================================
-- ALTER TABLE procurements ENABLE ROW LEVEL SECURITY;
-- En Fase 0 se usa service_role key que bypasea RLS.

-- =============================================================================
-- Función de trigger para updated_at automático
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a tablas con updated_at
CREATE TRIGGER trg_sources_updated_at
  BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_procurements_updated_at
  BEFORE UPDATE ON procurements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_radars_updated_at
  BEFORE UPDATE ON radars
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_matches_updated_at
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_entity_memory_updated_at
  BEFORE UPDATE ON entity_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
