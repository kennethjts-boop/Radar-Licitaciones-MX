-- Reactivación operativa sin cambiar las 12 configuraciones de producción.
-- Reutiliza cuatro slots históricos, generaliza watchdog y conserva historia.

BEGIN;

INSERT INTO public.system_state (key, value_json, updated_at)
VALUES ('radar_mode', '"full"'::jsonb, now())
ON CONFLICT (key) DO UPDATE
SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at;

-- Copia reversible de las 12 configuraciones antes de adaptar cuatro slots.
INSERT INTO public.system_state (key, value_json, updated_at)
SELECT
  'radar_config_snapshot_pre_20260813',
  jsonb_agg(to_jsonb(r) ORDER BY r.key),
  now()
FROM public.radars r
ON CONFLICT (key) DO NOTHING;

-- La identidad de un slot (radars.id) es estable, pero su criterio puede cambiar.
-- Cada match queda ligado a la versión inmutable que realmente lo produjo.
CREATE TABLE IF NOT EXISTS public.radar_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radar_id uuid NOT NULL REFERENCES public.radars(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  version_key text NOT NULL,
  radar_key text NOT NULL,
  radar_name text NOT NULL,
  radar_description text,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  criteria_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radar_config_versions_number_unique UNIQUE (radar_id, version_number),
  CONSTRAINT radar_config_versions_key_unique UNIQUE (radar_id, version_key),
  CONSTRAINT radar_config_versions_interval_valid CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS radar_config_versions_current_unique_idx
  ON public.radar_config_versions (radar_id) WHERE effective_to IS NULL;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS radar_config_version_id uuid
  REFERENCES public.radar_config_versions(id);

-- Versiona exactamente la configuración vigente antes del cambio. Incluye las
-- radar_rules almacenadas, además del nombre/config y la explicación ya propia
-- de cada match.
INSERT INTO public.radar_config_versions (
  radar_id, version_number, version_key, radar_key, radar_name,
  radar_description, config_json, criteria_snapshot, effective_from
)
SELECT
  r.id,
  1,
  'legacy_pre_20260813',
  r.key,
  r.name,
  r.description,
  r.config_json,
  jsonb_build_object(
    'config_json', r.config_json,
    'rules', COALESCE((
      SELECT jsonb_agg(to_jsonb(rr) ORDER BY rr.created_at, rr.id)
      FROM public.radar_rules rr WHERE rr.radar_id = r.id
    ), '[]'::jsonb)
  ),
  r.created_at
FROM public.radars r
ON CONFLICT (radar_id, version_key) DO NOTHING;

UPDATE public.matches m
SET radar_config_version_id = rcv.id
FROM public.radar_config_versions rcv
WHERE m.radar_config_version_id IS NULL
  AND rcv.radar_id = m.radar_id
  AND rcv.version_key = 'legacy_pre_20260813';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.matches WHERE radar_config_version_id IS NULL
  ) THEN
    RAISE EXCEPTION 'No se pudo versionar la configuración de todos los matches históricos';
  END IF;
END $$;

ALTER TABLE public.matches
  ALTER COLUMN radar_config_version_id SET NOT NULL;

-- La unicidad debe pertenecer a la versión efectiva, no al slot mutable. Esto
-- permite que A y B conserven semántica propia incluso para un mismo expediente.
ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS uq_match_radar_procurement;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_match_config_version_procurement'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT uq_match_config_version_procurement
      UNIQUE (radar_config_version_id, procurement_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_matches_radar_config_version
  ON public.matches (radar_config_version_id, created_at DESC);

DO $$
DECLARE
  before_count integer;
  after_count integer;
  active_count integer;
BEGIN
  SELECT count(*) INTO before_count FROM public.radars;
  IF before_count <> 12 THEN
    RAISE EXCEPTION 'Se esperaban exactamente 12 filas en radars; se encontraron %', before_count;
  END IF;

  IF (
    SELECT count(*) FROM public.radars
    WHERE key IN ('capufe_oportunidades', 'imss_morelos', 'imss_bienestar_morelos', 'habitat_morelos')
  ) <> 4 THEN
    RAISE EXCEPTION 'Faltan uno o más slots históricos requeridos para los cuatro focos';
  END IF;

  UPDATE public.radar_config_versions
  SET effective_to = transaction_timestamp()
  WHERE radar_id IN (
      SELECT id FROM public.radars
      WHERE key IN ('capufe_oportunidades', 'imss_morelos', 'imss_bienestar_morelos', 'habitat_morelos')
    )
    AND effective_to IS NULL
    AND version_key = 'legacy_pre_20260813';

  UPDATE public.radars SET is_active = false, updated_at = now();

  UPDATE public.radars
  SET name = 'CAPUFE — Nacional',
      description = 'CAPUFE por dependencia/siglas estructuradas, sin restricción estatal.',
      is_active = true,
      priority = 1,
      config_json = '{"focus":"capufe_national","strategy":"structured_dependency","siglas":["CAPUFE"]}'::jsonb,
      updated_at = now()
  WHERE key = 'capufe_oportunidades';

  UPDATE public.radars
  SET name = 'IMSS — Morelos',
      description = 'IMSS por dependencia estructurada y entidad/unidad compradora de Morelos.',
      is_active = true,
      priority = 1,
      config_json = '{"focus":"imss_morelos","strategy":"structured_dependency_state","siglas":["IMSS"],"state":"MORELOS"}'::jsonb,
      updated_at = now()
  WHERE key = 'imss_morelos';

  UPDATE public.radars
  SET name = 'IMSS — Oaxtepec, Morelos',
      description = 'IMSS y unidad compradora 050GYR085 Centro Vacacional IMSS Oaxtepec.',
      is_active = true,
      priority = 1,
      config_json = '{"focus":"imss_oaxtepec","strategy":"structured_buying_unit","siglas":["IMSS"],"buying_unit_code":"050GYR085"}'::jsonb,
      updated_at = now()
  WHERE key = 'imss_bienestar_morelos';

  UPDATE public.radars
  SET name = 'Morelos — cualquier dependencia',
      description = 'Cualquier dependencia con entidad o unidad compradora estructurada de Morelos.',
      is_active = true,
      priority = 1,
      config_json = '{"focus":"morelos_general","strategy":"structured_state","state":"MORELOS"}'::jsonb,
      updated_at = now()
  WHERE key = 'habitat_morelos';

  INSERT INTO public.radar_config_versions (
    radar_id, version_number, version_key, radar_key, radar_name,
    radar_description, config_json, criteria_snapshot, effective_from
  )
  SELECT
    r.id,
    2,
    'operational_20260813',
    r.key,
    r.name,
    r.description,
    r.config_json,
    jsonb_build_object(
      'config_json', r.config_json,
      'rules', COALESCE((
        SELECT jsonb_agg(to_jsonb(rr) ORDER BY rr.created_at, rr.id)
        FROM public.radar_rules rr WHERE rr.radar_id = r.id
      ), '[]'::jsonb)
    ),
    transaction_timestamp()
  FROM public.radars r
  WHERE r.key IN ('capufe_oportunidades', 'imss_morelos', 'imss_bienestar_morelos', 'habitat_morelos')
  ON CONFLICT (radar_id, version_key) DO NOTHING;

  SELECT count(*) INTO after_count FROM public.radars;
  SELECT count(*) INTO active_count FROM public.radars WHERE is_active;
  IF after_count <> before_count OR after_count <> 12 THEN
    RAISE EXCEPTION 'La cantidad de radars cambió: antes %, después %', before_count, after_count;
  END IF;
  IF active_count <> 4 THEN
    RAISE EXCEPTION 'Se esperaban 4 focos activos; se encontraron %', active_count;
  END IF;
END $$;

ALTER TABLE public.radar_config_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.radar_config_versions FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.radar_config_versions FROM service_role;
GRANT SELECT ON public.radar_config_versions TO service_role;

-- La tabla alerts existente es la cola de entrega. Esta llave hace idempotente
-- una alerta nueva por procurement sin alterar ni deduplicar historia previa.
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS alerts_dedupe_key_unique_idx
  ON public.alerts (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.watchdog_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id uuid NOT NULL REFERENCES public.procurements(id),
  procedure_number text NOT NULL,
  comprasmx_uuid text NOT NULL,
  alias text NOT NULL,
  dependency text,
  active boolean NOT NULL DEFAULT true,
  activated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  last_checked_at timestamptz,
  last_snapshot_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchdog_targets_procurement_unique UNIQUE (procurement_id),
  CONSTRAINT watchdog_targets_procedure_unique UNIQUE (procedure_number)
);

ALTER TABLE public.watchdog_snapshots
  ADD COLUMN IF NOT EXISTS target_id uuid REFERENCES public.watchdog_targets(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'watchdog_targets_last_snapshot_id_fkey'
      AND conrelid = 'public.watchdog_targets'::regclass
  ) THEN
    ALTER TABLE public.watchdog_targets
      ADD CONSTRAINT watchdog_targets_last_snapshot_id_fkey
      FOREIGN KEY (last_snapshot_id) REFERENCES public.watchdog_snapshots(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS watchdog_targets_active_idx
  ON public.watchdog_targets (active, activated_at);
CREATE INDEX IF NOT EXISTS watchdog_snapshots_target_created_idx
  ON public.watchdog_snapshots (target_id, created_at DESC);

-- Cada procedimiento histórico obtiene identidad propia. Solo N-68 era la
-- vigilancia explícitamente vigente; la historia de los demás queda inactiva.
INSERT INTO public.watchdog_targets
  (procurement_id, procedure_number, comprasmx_uuid, alias, dependency, active,
   activated_at, deactivated_at, metadata)
SELECT DISTINCT ON (ws.numero_procedimiento)
  p.id,
  ws.numero_procedimiento,
  substring(p.source_url from '/detalle/([^/]+)/procedimiento'),
  CASE
    WHEN ws.numero_procedimiento = 'LA-09-J0U-009J0U001-N-68-2026' THEN 'CAPUFE · N-68'
    WHEN p.buying_unit ILIKE '%OAXTEPEC%' THEN 'IMSS · Oaxtepec'
    ELSE concat_ws(' · ', nullif(p.dependency_name, ''), ws.numero_procedimiento)
  END,
  p.dependency_name,
  ws.numero_procedimiento = 'LA-09-J0U-009J0U001-N-68-2026',
  min(ws.created_at) OVER (PARTITION BY ws.numero_procedimiento),
  CASE
    WHEN ws.numero_procedimiento = 'LA-09-J0U-009J0U001-N-68-2026' THEN null
    ELSE max(ws.created_at) OVER (PARTITION BY ws.numero_procedimiento)
  END,
  '{"migrated_from":"watchdog_snapshots"}'::jsonb
FROM public.watchdog_snapshots ws
JOIN public.procurements p
  ON ws.numero_procedimiento IN (p.procedure_number, p.licitation_number, p.external_id)
WHERE p.source_url ~ '/detalle/[^/]+/procedimiento'
ORDER BY ws.numero_procedimiento, p.last_seen_at DESC
ON CONFLICT (procedure_number) DO UPDATE SET
  procurement_id = EXCLUDED.procurement_id,
  comprasmx_uuid = EXCLUDED.comprasmx_uuid,
  updated_at = now();

UPDATE public.watchdog_snapshots ws
SET target_id = wt.id
FROM public.watchdog_targets wt
WHERE ws.target_id IS NULL
  AND wt.procedure_number = ws.numero_procedimiento;

UPDATE public.watchdog_targets wt
SET last_snapshot_id = (
      SELECT ws.id FROM public.watchdog_snapshots ws
      WHERE ws.target_id = wt.id ORDER BY ws.created_at DESC LIMIT 1
    ),
    last_checked_at = (
      SELECT ws.created_at FROM public.watchdog_snapshots ws
      WHERE ws.target_id = wt.id ORDER BY ws.created_at DESC LIMIT 1
    ),
    updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM public.watchdog_snapshots ws WHERE ws.target_id = wt.id
);

ALTER TABLE public.watchdog_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.watchdog_targets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.watchdog_targets TO service_role;
DROP POLICY IF EXISTS "service_role_all" ON public.watchdog_targets;
CREATE POLICY "service_role_all" ON public.watchdog_targets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
