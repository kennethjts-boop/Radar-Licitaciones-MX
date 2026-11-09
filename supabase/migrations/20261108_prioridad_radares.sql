-- Focos de prioridad (versión prioridad_20261108): BIRMEX nacional, DIFEM, Junta de
-- Caminos y Salud estatal (SSEM/ISEM). Conserva los 15 radares previos sin cambios
-- y no modifica matches ni alertas existentes.
BEGIN;

INSERT INTO public.radars
  (key, name, description, is_active, priority, schedule_minutes, config_json)
VALUES
  ('birmex_prioridad_20261108', 'BIRMEX — Prioridad máxima nacional',
   'Toda licitación de Laboratorios de Biológicos y Reactivos de México (UC 012NEF001): compras consolidadas, servicios, software y logística', true, 1, 30,
   '{"focus":"birmex","matcher":"edomex_2026_v1","priority":"max","any_amount":true}'),
  ('edomex_difem_20261108', 'EDOMEX — DIFEM estatal',
   'Procedimientos del DIF del Estado de México (no DIF municipal ni DIF Nacional), cualquier monto', true, 1, 30,
   '{"focus":"edomex_difem","matcher":"edomex_2026_v1","any_amount":true}'),
  ('edomex_jcem_20261108', 'EDOMEX — Junta de Caminos (JCEM)',
   'Toda convocatoria de la Junta de Caminos del Estado de México aunque no publique monto; destaca > $100 MDP', true, 1, 30,
   '{"focus":"edomex_jcem","matcher":"edomex_2026_v1","any_amount":true,"highlight_amount_mxn":100000000}'),
  ('edomex_salud_20261108', 'EDOMEX — Salud estatal (SSEM/ISEM)',
   'Procedimientos de la Secretaría de Salud estatal y del ISEM, cualquier monto', true, 1, 30,
   '{"focus":"edomex_salud","matcher":"edomex_2026_v1","any_amount":true}')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true,
    priority = EXCLUDED.priority, schedule_minutes = EXCLUDED.schedule_minutes,
    config_json = EXCLUDED.config_json, updated_at = now();

INSERT INTO public.radar_config_versions
  (radar_id, version_number, version_key, radar_key, radar_name,
   radar_description, config_json, criteria_snapshot, effective_from)
SELECT r.id,
       COALESCE((SELECT max(v.version_number) FROM public.radar_config_versions v WHERE v.radar_id = r.id), 0) + 1,
       'prioridad_20261108', r.key, r.name, r.description, r.config_json,
       jsonb_build_object(
         'config_json', r.config_json,
         'matcher', 'edomex-focus.matcher.ts:classifyPriorityProcurement',
         'sources', jsonb_build_array('comprasmx', 'secogem_edomex'),
         'birmex_identifiers', 'BIRMEX, Laboratorios de Biológicos y Reactivos de México, UC 012NEF001',
         'publication_lookback', '30 días desde 2026-11-08 (corte 2026-10-09)',
         'amount_rules', jsonb_build_array(
           'Cualquier monto; el monto sólo se afirma si consta explícito',
           'Sin monto: por verificar')
       ),
       transaction_timestamp()
FROM public.radars r
WHERE r.key IN ('birmex_prioridad_20261108', 'edomex_difem_20261108',
                'edomex_jcem_20261108', 'edomex_salud_20261108')
ON CONFLICT (radar_id, version_key) DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM public.radar_config_versions v
    JOIN public.radars r ON r.id = v.radar_id
    WHERE r.is_active AND v.effective_to IS NULL AND v.version_key = 'prioridad_20261108'
  ) <> 4 THEN
    RAISE EXCEPTION 'Cada foco de prioridad necesita su versión vigente';
  END IF;
  IF (
    SELECT count(*) FROM public.radar_config_versions v
    JOIN public.radars r ON r.id = v.radar_id
    WHERE r.is_active AND v.effective_to IS NULL AND v.version_key IN ('operational_20261014', 'edomex_20261025')
  ) <> 15 THEN
    RAISE EXCEPTION 'Los quince focos previos deben conservarse activos';
  END IF;
  IF (SELECT count(*) FROM public.radars WHERE is_active) <> 19 THEN
    RAISE EXCEPTION 'Se esperaban exactamente 19 radares activos';
  END IF;
END $$;

COMMIT;
