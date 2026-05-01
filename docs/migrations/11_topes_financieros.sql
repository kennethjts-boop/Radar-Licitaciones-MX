-- docs/migrations/11_topes_financieros.sql
-- Topes financieros federales — PEF 2026 Anexo 9
-- Fuente: DOF 21 noviembre 2025
-- Artículos 43 LAASSP (adquisiciones/arrendamientos) y 43 LOPSRM (obra pública)
--
-- UNIDADES:
--   presupuesto_desde / presupuesto_hasta : pesos MXN
--   tope_*_miles                          : miles de pesos MXN (× 1,000 = pesos reales)

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
  id                           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  anio                         INTEGER       NOT NULL,
  tipo                         tipo_contratacion NOT NULL,
  presupuesto_desde            BIGINT        NOT NULL,    -- pesos MXN, inclusive
  presupuesto_hasta            BIGINT,                   -- pesos MXN, exclusive; NULL = sin límite superior
  tope_adjudicacion_miles      NUMERIC(14,2) NOT NULL,   -- miles de pesos MXN
  tope_invitacion_miles        NUMERIC(14,2) NOT NULL,   -- miles de pesos MXN
  tope_adjudicacion_srob_miles NUMERIC(14,2),            -- solo obra_publica: servicios relacionados (adj. directa)
  tope_invitacion_srob_miles   NUMERIC(14,2),            -- solo obra_publica: servicios relacionados (inv. 3 personas)
  fuente                       TEXT          NOT NULL,
  created_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_topes_anio_tipo_presupuesto UNIQUE (anio, tipo, presupuesto_desde)
);

-- ── Columnas adicionales — idempotente para upgrades ─────────────────────────
DO $$ BEGIN
  ALTER TABLE topes_financieros_federales ADD COLUMN tope_adjudicacion_srob_miles NUMERIC(14,2);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE topes_financieros_federales ADD COLUMN tope_invitacion_srob_miles NUMERIC(14,2);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ── Índice ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_topes_anio_tipo
  ON topes_financieros_federales (anio, tipo, presupuesto_desde DESC);

-- ── Seed PEF 2026 — limpiar filas anteriores y reinsertar ────────────────────
DELETE FROM topes_financieros_federales WHERE anio = 2026;

INSERT INTO topes_financieros_federales
  (anio, tipo, presupuesto_desde, presupuesto_hasta,
   tope_adjudicacion_miles, tope_invitacion_miles,
   tope_adjudicacion_srob_miles, tope_invitacion_srob_miles,
   fuente)
VALUES

  -- ── LAASSP: Adquisiciones (14 tramos) ──────────────────────────────────────
  (2026, 'adquisicion',          0,   15000000,   309,  2272, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',   15000000,   30000000,   343,  2649, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',   30000000,   50000000,   376,  2983, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',   50000000,  100000000,   391,  3264, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',  100000000,  150000000,   492,  4351, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',  150000000,  250000000,   554,  5165, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',  250000000,  350000000,   624,  6138, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',  350000000,  450000000,   686,  7068, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',  450000000,  600000000,   697,  7551, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',  600000000,  750000000,   777,  8880, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion',  750000000, 1000000000,   790,  9461, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion', 1000000000, 1250000000,   902, 11547, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion', 1250000000, 1500000000,  1023, 13741, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'adquisicion', 1500000000,        NULL,  1145, 16086, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),

  -- ── LAASSP: Arrendamientos — mismos topes que adquisición ──────────────────
  (2026, 'arrendamiento',          0,   15000000,   309,  2272, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',   15000000,   30000000,   343,  2649, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',   30000000,   50000000,   376,  2983, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',   50000000,  100000000,   391,  3264, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',  100000000,  150000000,   492,  4351, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',  150000000,  250000000,   554,  5165, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',  250000000,  350000000,   624,  6138, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',  350000000,  450000000,   686,  7068, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',  450000000,  600000000,   697,  7551, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',  600000000,  750000000,   777,  8880, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento',  750000000, 1000000000,   790,  9461, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento', 1000000000, 1250000000,   902, 11547, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento', 1250000000, 1500000000,  1023, 13741, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),
  (2026, 'arrendamiento', 1500000000,        NULL,  1145, 16086, NULL, NULL, 'PEF 2026 Anexo 9 — LAASSP Art.43, DOF 21-nov-2025'),

  -- ── LOPSRM: Obra pública (15 tramos, 4 columnas de topes) ──────────────────
  --   tope_adjudicacion_miles      = adj. directa para obra pública
  --   tope_invitacion_miles        = inv. 3 personas para obra pública
  --   tope_adjudicacion_srob_miles = adj. directa para servicios relacionados con obra
  --   tope_invitacion_srob_miles   = inv. 3 personas para servicios relacionados con obra
  (2026, 'obra_publica',          0,   15000000,   499,  3776,  223,  2868, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',   15000000,   30000000,   590,  4469,  294,  3240, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',   30000000,   50000000,   678,  5079,  357,  3981, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',   50000000,  100000000,   753,  5637,  403,  4528, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',  100000000,  150000000,  1027,  7642,  492,  5649, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',  150000000,  250000000,  1189,  9024,  537,  6620, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',  250000000,  350000000,  1386, 10522,  683,  7621, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',  350000000,  450000000,  1588, 12116,  781,  8656, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',  450000000,  600000000,  1699, 12968,  888, 10148, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',  600000000,  750000000,  1993, 15258, 1066, 12082, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica',  750000000, 1000000000,  2128, 16276, 1152, 12981, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica', 1000000000, 1250000000,  2591, 19932, 1340, 15258, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica', 1250000000, 1500000000,  3083, 23617, 1574, 17819, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica', 1500000000, 2700000000,  3471, 26766, 1760, 19966, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025'),
  (2026, 'obra_publica', 2700000000,        NULL,  3893, 28913, 1975, 22372, 'PEF 2026 Anexo 9 — LOPSRM Art.43, DOF 21-nov-2025')

ON CONFLICT (anio, tipo, presupuesto_desde) DO NOTHING;
