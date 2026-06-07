INSERT INTO public.rsmx_sources (source_key, name, kind, url, region)
VALUES
  ('gdelt', 'GDELT', 'api', 'https://api.gdeltproject.org/api/v2/doc/doc', 'mexico'),
  ('rss_public_media', 'RSS medios publicos configurables', 'rss', NULL, 'mexico'),
  ('official_morelos', 'Fuentes oficiales Morelos configurables', 'official', NULL, 'morelos'),
  ('official_federal', 'Fuentes oficiales federales configurables', 'official', NULL, 'mexico')
ON CONFLICT (source_key) DO UPDATE
SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  url = EXCLUDED.url,
  region = EXCLUDED.region,
  updated_at = now();
