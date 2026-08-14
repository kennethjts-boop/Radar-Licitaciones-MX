BEGIN;

-- El primer ciclo operativo del 13/08/2026 encontró estos expedientes mientras
-- el selector de fecha devolvía el pie de página. Reabrimos únicamente su
-- fingerprint para que el worker corregido vuelva a evaluar la fecha oficial.
-- La regla temporal sigue decidiendo si corresponde crear una alerta.
DO $$
DECLARE
  affected_count integer;
BEGIN
  SELECT count(DISTINCT p.id)
  INTO affected_count
  FROM public.procurements p
  JOIN public.matches m ON m.procurement_id = p.id
  JOIN public.radar_config_versions rcv ON rcv.id = m.radar_config_version_id
  WHERE p.publication_date IS NULL
    AND p.created_at >= timestamptz '2026-08-13T06:00:00.000Z'
    AND rcv.version_key = 'operational_20260813'
    AND p.lightweight_fingerprint NOT LIKE 'publication-date-recheck:%';

  IF affected_count NOT IN (0, 17) THEN
    RAISE EXCEPTION
      'Recuperación de fecha esperaba 17 expedientes o 0 al reejecutar; encontró %',
      affected_count;
  END IF;
END $$;

UPDATE public.procurements p
SET lightweight_fingerprint = 'publication-date-recheck:' || p.lightweight_fingerprint,
    canonical_fingerprint = 'publication-date-recheck:' || p.canonical_fingerprint,
    updated_at = now()
WHERE p.publication_date IS NULL
  AND p.created_at >= timestamptz '2026-08-13T06:00:00.000Z'
  AND p.lightweight_fingerprint NOT LIKE 'publication-date-recheck:%'
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.radar_config_versions rcv ON rcv.id = m.radar_config_version_id
    WHERE m.procurement_id = p.id
      AND rcv.version_key = 'operational_20260813'
  );

COMMIT;
