-- Snapshots inmutables del watchdog de licitaciones específicas.
-- Aplicar antes de desplegar el worker que consulta esta tabla.

CREATE TABLE IF NOT EXISTS public.watchdog_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_procedimiento text NOT NULL,
  snapshot_hash text NOT NULL CHECK (length(snapshot_hash) = 64),
  snapshot_json jsonb NOT NULL,
  detected_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS watchdog_snapshots_numero_created_idx
  ON public.watchdog_snapshots (numero_procedimiento, created_at DESC);

CREATE INDEX IF NOT EXISTS watchdog_snapshots_numero_hash_idx
  ON public.watchdog_snapshots (numero_procedimiento, snapshot_hash);

ALTER TABLE public.watchdog_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON public.watchdog_snapshots FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchdog_snapshots TO service_role;

DROP POLICY IF EXISTS "service_role_all" ON public.watchdog_snapshots;
CREATE POLICY "service_role_all" ON public.watchdog_snapshots
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

SELECT pg_notify('pgrst', 'reload schema');
