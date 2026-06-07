CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.rsmx_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rss', 'api', 'official', 'public_channel')),
  url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  region TEXT NOT NULL DEFAULT 'morelos',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rsmx_raw_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES public.rsmx_sources(id) ON DELETE SET NULL,
  source_key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  raw_text TEXT NOT NULL DEFAULT '',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  canonical_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.rsmx_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'morelos',
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'candidate',
  occurred_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);

CREATE TABLE IF NOT EXISTS public.rsmx_event_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.rsmx_events(id) ON DELETE CASCADE,
  raw_item_id UUID REFERENCES public.rsmx_raw_items(id) ON DELETE SET NULL,
  source_id UUID REFERENCES public.rsmx_sources(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rsmx_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.rsmx_events(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'telegram',
  chat_id TEXT,
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rsmx_telegram_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_update_id BIGINT,
  chat_id TEXT,
  command TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rsmx_user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL UNIQUE,
  alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  region TEXT NOT NULL DEFAULT 'morelos',
  min_alert_score INTEGER NOT NULL DEFAULT 75,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rsmx_events_score ON public.rsmx_events(score DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsmx_events_category_region ON public.rsmx_events(category, region, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsmx_raw_items_collected_at ON public.rsmx_raw_items(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsmx_alerts_status ON public.rsmx_alerts(status, created_at DESC);
