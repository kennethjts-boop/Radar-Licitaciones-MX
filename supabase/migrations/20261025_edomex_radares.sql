-- Focos del Estado de México (versión edomex_20261025). Conserva los once
-- focos de octubre sin cambios y no modifica matches ni alertas previas.
BEGIN;

INSERT INTO public.sources (key, name, type, base_url, is_active)
VALUES ('secogem_edomex', 'SECOGEM — Convocatorias del Estado de México', 'web_scraper',
        'https://portal.secogem.gob.mx/', true)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name, base_url = EXCLUDED.base_url, is_active = true, updated_at = now();

INSERT INTO public.radars
  (key, name, description, is_active, priority, schedule_minutes, config_json)
VALUES
  ('edomex_issemym_20261025', 'EDOMEX — ISSEMyM',
   'Cualquier licitación nueva del ISSEMyM, de cualquier giro y monto', true, 1, 30,
   '{"focus":"edomex_issemym","matcher":"edomex_2026_v1","min_amount_mxn":null}'),
  ('edomex_carreteras_20261025', 'EDOMEX — Carreteras > $100 MDP',
   'Rehabilitación, conservación, pavimentación y bacheo carretero superiores a 100 MDP', true, 1, 30,
   '{"focus":"edomex_carreteras","matcher":"edomex_2026_v1","min_amount_mxn":100000000,"amount_rule":"strictly_greater"}'),
  ('edomex_sitramytem_20261025', 'EDOMEX — SITRAMyTEM vial y mantenimiento',
   'Trabajos viales y mantenimiento acotado; sin proyectos integrales ni concesiones', true, 1, 30,
   '{"focus":"edomex_sitramytem","matcher":"edomex_2026_v1","highway_min_amount_mxn":100000000}'),
  ('edomex_oportunidades_20261025', 'EDOMEX — Dependencias y municipios alto monto',
   'Obras, tecnología, equipamiento, vehículos, limpieza, seguridad y suministros desde 20 MDP', true, 1, 30,
   '{"focus":"edomex_oportunidades","matcher":"edomex_2026_v1","min_amount_mxn":20000000}')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true,
    priority = EXCLUDED.priority, schedule_minutes = EXCLUDED.schedule_minutes,
    config_json = EXCLUDED.config_json, updated_at = now();

INSERT INTO public.radar_config_versions
  (radar_id, version_number, version_key, radar_key, radar_name,
   radar_description, config_json, criteria_snapshot, effective_from)
SELECT r.id,
       COALESCE((SELECT max(v.version_number) FROM public.radar_config_versions v WHERE v.radar_id = r.id), 0) + 1,
       'edomex_20261025', r.key, r.name, r.description, r.config_json,
       jsonb_build_object(
         'config_json', r.config_json,
         'matcher', 'edomex-focus.matcher.ts:edomex_2026_v1',
         'sources', jsonb_build_array('secogem_edomex', 'comprasmx'),
         'comprasmx_buyers', 'UC estatal 915xxxxxx, municipal 815xxxxxx/074xxx, ISSEMyM, SITRAMyTEM, JCEM',
         'official_publication_cutoff', '2026-10-25T00:00:00 America/Mexico_City',
         'amount_rules', jsonb_build_array(
           'Sólo presupuesto o monto explícito del contrato',
           'Capital contable, costo de bases e inversión global no son monto contractual',
           'Sin monto confirmado: candidata pendiente de revisión',
           'Convocatoria agrupada: sin monto individual'),
         'exclusions', 'concesiones, llave en mano, teleféricos, viaductos, túneles, proyectos integrales Mexibús/Mexicable'
       ),
       transaction_timestamp()
FROM public.radars r
WHERE r.key IN ('edomex_issemym_20261025', 'edomex_carreteras_20261025',
                'edomex_sitramytem_20261025', 'edomex_oportunidades_20261025')
ON CONFLICT (radar_id, version_key) DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM public.radar_config_versions v
    JOIN public.radars r ON r.id = v.radar_id
    WHERE r.is_active AND v.effective_to IS NULL AND v.version_key = 'operational_20261014'
  ) <> 11 THEN
    RAISE EXCEPTION 'Los once focos de octubre deben conservarse activos';
  END IF;
  IF (
    SELECT count(*) FROM public.radar_config_versions v
    JOIN public.radars r ON r.id = v.radar_id
    WHERE r.is_active AND v.effective_to IS NULL AND v.version_key = 'edomex_20261025'
  ) <> 4 THEN
    RAISE EXCEPTION 'Cada foco Edomex necesita su versión vigente';
  END IF;
  IF (SELECT count(*) FROM public.radars WHERE is_active) <> 15 THEN
    RAISE EXCEPTION 'Se esperaban exactamente 15 radares activos';
  END IF;
END $$;

COMMIT;
