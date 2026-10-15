-- Estrategia desde 2026-10-14 CDMX. No modifica matches ni snapshots previos.
BEGIN;

INSERT INTO public.system_state (key, value_json, updated_at)
SELECT 'radar_config_snapshot_pre_20261014',
       jsonb_agg(to_jsonb(r) ORDER BY r.key), now()
FROM public.radars r
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.radars WHERE key = 'imss_bienestar_morelos') THEN
    RAISE EXCEPTION 'Falta el radar histórico de IMSS Oaxtepec';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.radar_config_version_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Existen matches históricos sin versión';
  END IF;
END $$;

-- Cerrar versiones anteriores antes de cambiar configuraciones.
UPDATE public.radar_config_versions
SET effective_to = transaction_timestamp()
WHERE effective_to IS NULL
  AND radar_id IN (
    SELECT id FROM public.radars
    WHERE is_active OR key IN (
      'capufe_oportunidades', 'imss_morelos',
      'imss_bienestar_morelos', 'habitat_morelos'
    )
  );

UPDATE public.radars SET is_active = false, updated_at = now();

INSERT INTO public.radars
  (key, name, description, is_active, priority, schedule_minutes, config_json)
VALUES
  ('capufe_seguridad_20261014', 'CAPUFE — Seguridad y vigilancia', 'Guardias y vigilancia presencial', true, 1, 30, '{"focus":"capufe_security","matcher":"october_2026_v1"}'),
  ('capufe_emergencia_vehiculos_20261014', 'CAPUFE — Vehículos de emergencia y auxilio vial', 'Vehículos de rescate y auxilio', true, 1, 30, '{"focus":"capufe_emergency_vehicles","matcher":"october_2026_v1"}'),
  ('capufe_vehiculos_administrativos_20261014', 'CAPUFE — Vehículos administrativos', 'Flota administrativa', true, 1, 30, '{"focus":"capufe_administrative_vehicles","matcher":"october_2026_v1"}'),
  ('capufe_limpieza_general_20261014', 'CAPUFE — Limpieza integral general', 'Servicios generales de limpieza', true, 1, 30, '{"focus":"capufe_general_cleaning","matcher":"october_2026_v1"}'),
  ('capufe_mobiliario_20261014', 'CAPUFE — Mobiliario y equipamiento', 'Adquisición de mobiliario', true, 1, 30, '{"focus":"capufe_furniture","matcher":"october_2026_v1"}'),
  ('capufe_limpieza_especial_nacional_20261014', 'CAPUFE — Limpieza especial nacional', 'Limpieza especial con cobertura nacional', true, 1, 30, '{"focus":"capufe_special_national_cleaning","matcher":"october_2026_v1"}'),
  ('imss_limpieza_20261014', 'IMSS — Limpieza nacional', 'Servicios de limpieza', true, 1, 30, '{"focus":"imss_cleaning","matcher":"october_2026_v1"}'),
  ('imss_seguridad_20261014', 'IMSS — Seguridad y vigilancia nacional', 'Guardias y vigilancia presencial', true, 1, 30, '{"focus":"imss_security","matcher":"october_2026_v1"}'),
  ('imss_laboratorio_clinico_20261014', 'IMSS — Estudios de laboratorio clínico', 'Servicio médico integral de laboratorio', true, 1, 30, '{"focus":"imss_clinical_laboratory","matcher":"october_2026_v1"}'),
  ('imss_banco_sangre_20261014', 'IMSS — Banco de sangre', 'Servicio médico integral de banco de sangre', true, 1, 30, '{"focus":"imss_blood_bank","matcher":"october_2026_v1"}')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    priority = EXCLUDED.priority,
    schedule_minutes = EXCLUDED.schedule_minutes,
    config_json = EXCLUDED.config_json,
    updated_at = now();

UPDATE public.radars
SET name = 'IMSS — Oaxtepec, Morelos',
    description = 'Todas las nuevas convocatorias de la unidad compradora 050GYR085',
    config_json = '{"focus":"imss_oaxtepec","matcher":"october_2026_v1","buying_unit_code":"050GYR085"}',
    is_active = true, priority = 2, updated_at = now()
WHERE key = 'imss_bienestar_morelos';

INSERT INTO public.radar_config_versions
  (radar_id, version_number, version_key, radar_key, radar_name,
   radar_description, config_json, criteria_snapshot, effective_from)
SELECT r.id,
       COALESCE((SELECT max(v.version_number) FROM public.radar_config_versions v WHERE v.radar_id = r.id), 0) + 1,
       'operational_20261014', r.key, r.name, r.description, r.config_json,
       jsonb_build_object(
         'config_json', r.config_json,
         'matcher', 'operational-focus.matcher.ts:october_2026_v1',
         'source', 'comprasmx',
         'official_publication_cutoff', '2026-10-14T00:00:00 America/Mexico_City',
         'rules', COALESCE((
           SELECT jsonb_agg(to_jsonb(rr) ORDER BY rr.created_at, rr.id)
           FROM public.radar_rules rr WHERE rr.radar_id = r.id
         ), '[]'::jsonb)
       ),
       transaction_timestamp()
FROM public.radars r
WHERE r.is_active
ON CONFLICT (radar_id, version_key) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.radars WHERE is_active) <> 11 THEN
    RAISE EXCEPTION 'Se esperaban exactamente 11 focos activos';
  END IF;
  IF (
    SELECT count(*) FROM public.radar_config_versions v
    JOIN public.radars r ON r.id = v.radar_id
    WHERE r.is_active AND v.effective_to IS NULL AND v.version_key = 'operational_20261014'
  ) <> 11 THEN
    RAISE EXCEPTION 'Cada foco activo necesita su versión de octubre';
  END IF;
END $$;

COMMIT;
