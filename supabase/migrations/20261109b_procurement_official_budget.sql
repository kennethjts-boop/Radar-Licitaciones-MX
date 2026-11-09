-- Presupuesto oficial del procedimiento, con enlace y página del documento donde consta.
CREATE TABLE IF NOT EXISTS public.procurement_official_budget (
  procurement_id UUID PRIMARY KEY REFERENCES public.procurements(id) ON DELETE CASCADE,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'MXN',
  document_url TEXT NOT NULL,
  document_name TEXT,
  page_number INTEGER,
  label TEXT NOT NULL,
  excerpt TEXT,
  source_kind TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.procurement_official_budget ENABLE ROW LEVEL SECURITY;
