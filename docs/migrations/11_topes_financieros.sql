-- docs/migrations/11_topes_financieros.sql
-- Topes financieros federales según PEF 2026 Anexo 9
-- Fuente: DOF Presupuesto de Egresos de la Federación 2026, Anexo 9
-- Artículos 43 LAASSP y 43 LOPSRM

-- ── Enum ──────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE tipo_contratacion AS ENUM (
    'adquisicion',
    'arrendamiento',
    'obra_publica'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tabla ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topes_financieros_federales (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  anio                    INTEGER       NOT NULL,
  tipo                    tipo_contratacion NOT NULL,
  presupuesto_desde       BIGINT        NOT NULL,     -- en pesos MXN (inclusive)
  presupuesto_hasta       BIGINT,                     -- en pesos MXN (exclusive); NULL = sin límite superior
  tope_adjudicacion_miles NUMERIC(14,2) NOT NULL,     -- miles de pesos MXN
  tope_invitacion_miles   NUMERIC(14,2) NOT NULL,     -- miles de pesos MXN
  fuente                  TEXT          NOT NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_topes_anio_tipo_presupuesto
    UNIQUE (anio, tipo, presupuesto_desde)
);

-- Índice para búsquedas por (anio, tipo, presupuesto_desde DESC)
CREATE INDEX IF NOT EXISTS idx_topes_anio_tipo
  ON topes_financieros_federales (anio, tipo, presupuesto_desde DESC);

-- ── Seed PEF 2026 Anexo 9 ─────────────────────────────────────────────────────
-- Valores en miles de pesos MXN (ej: 300 = $300,000 MXN)
-- Para convertir a pesos reales: tope_adjudicacion_miles * 1000

INSERT INTO topes_financieros_federales
  (anio, tipo, presupuesto_desde, presupuesto_hasta, tope_adjudicacion_miles, tope_invitacion_miles, fuente)
VALUES
  -- ── LAASSP: Adquisiciones ────────────────────────────────────────────────
  -- presupuesto autorizado < $500 millones
  (2026, 'adquisicion',    0,              500000000,    300,    2000,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  -- $500M – $2,000M
  (2026, 'adquisicion',    500000000,      2000000000,   600,    4500,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  -- $2,000M – $10,000M
  (2026, 'adquisicion',    2000000000,     10000000000,  1200,   9000,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  -- > $10,000M
  (2026, 'adquisicion',    10000000000,    NULL,         2400,   18000, 'PEF 2026 Anexo 9 — LAASSP Art.43'),

  -- ── LAASSP: Arrendamientos (mismos topes que adquisición) ────────────────
  (2026, 'arrendamiento',  0,              500000000,    300,    2000,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  (2026, 'arrendamiento',  500000000,      2000000000,   600,    4500,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  (2026, 'arrendamiento',  2000000000,     10000000000,  1200,   9000,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  (2026, 'arrendamiento',  10000000000,    NULL,         2400,   18000, 'PEF 2026 Anexo 9 — LAASSP Art.43'),

  -- ── LOPSRM: Obra pública y servicios relacionados ────────────────────────
  -- presupuesto autorizado < $500 millones
  (2026, 'obra_publica',   0,              500000000,    4200,   21000, 'PEF 2026 Anexo 9 — LOPSRM Art.43'),
  -- $500M – $2,000M
  (2026, 'obra_publica',   500000000,      2000000000,   8400,   42000, 'PEF 2026 Anexo 9 — LOPSRM Art.43'),
  -- > $2,000M
  (2026, 'obra_publica',   2000000000,     NULL,         16800,  84000, 'PEF 2026 Anexo 9 — LOPSRM Art.43')

ON CONFLICT (anio, tipo, presupuesto_desde) DO NOTHING;
