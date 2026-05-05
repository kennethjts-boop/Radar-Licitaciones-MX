-- Tabla para cachear los análisis on-demand generados por el Consultor IA SaaS
-- Esto evita cobrar tokens al usuario si ya se analizó la misma licitación

CREATE TABLE IF NOT EXISTS saas_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id uuid NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  analysis_json jsonb NOT NULL,
  model_used text NOT NULL DEFAULT 'gpt-4o-mini',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (procurement_id)
);

-- Índice para búsqueda rápida por licitación
CREATE INDEX IF NOT EXISTS idx_saas_analyses_procurement_id ON saas_analyses(procurement_id);

-- RLS: solo el service_role puede escribir; anon puede leer si la licitación es pública
ALTER TABLE saas_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON saas_analyses
  FOR ALL
  USING (true)
  WITH CHECK (true);
