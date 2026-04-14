-- =============================================================================
-- MIGRACIÓN 10: Registrar fuentes de fondos/convocatorias internacionales
-- para donatarias autorizadas en México (sectores: salud, deporte, cultura).
--
-- Ejecutar en el SQL Editor de Supabase antes de desplegar esta versión.
-- =============================================================================

INSERT INTO sources (key, name, type, base_url) VALUES
  (
    'fondos_inah',
    'INAH — Procuración de Fondos (Convocatorias)',
    'web_scraper',
    'https://procuraciondefondos.inah.gob.mx/publico/convocatorias.php'
  ),
  (
    'fondos_concausa',
    'ConCausa — Difusión de Convocatorias OSC',
    'web_scraper',
    'https://difusionconcausa.com/convocatorias/'
  ),
  (
    'fondos_gestionandote',
    'GestionandoTe — Subvenciones y Fondos OSC',
    'web_scraper',
    'https://www.gestionandote.org/category/subvenciones/'
  ),
  (
    'fondos_cecani',
    'CECANI — Convocatorias Permanentes de Apoyo Económico para OSC',
    'web_scraper',
    'https://cecani.org/home/announcement/convocatorias-permanentes-de-apoyo-economico-para-osc'
  ),
  (
    'fondos_coprev',
    'COPREV — Financiamiento para OSC',
    'web_scraper',
    'https://coprev.com.mx/financiamiento/'
  ),
  (
    'fondos_montepiedad',
    'Nacional Monte de Piedad — Inversión Social Convocatorias',
    'web_scraper',
    'https://inversionsocial.montepiedad.com.mx/convocatorias/'
  )
ON CONFLICT (key) DO NOTHING;
