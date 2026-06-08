# Auditoria Supabase Real — Radar-Social-MX

## Contexto

Rama: `feature/rsmx-isolated-module`

Objetivo: probar conexion real de `apps/rsmx` con Supabase separado usando exclusivamente variables `RSMX_`, sin tocar Radar-Licitaciones-MX, sin merge, sin deploy, sin Telegram real y sin exponer secretos.

## Resultado ejecutivo

- Supabase: OK
- Tablas `rsmx_`: OK
- Lectura de `rsmx_sources`: OK
- Fuentes sembradas: 4
- Worker con Supabase real configurado: OK
- Telegram: desactivado intencionalmente
- Secrets: no expuestos
- Veredicto: APROBADO SUPABASE

## Proteccion de secrets

Se verifico que `apps/rsmx/.env` existe y esta protegido por Git:

```text
.gitignore:2:.env apps/rsmx/.env
```

No se imprimieron valores secretos. No se commiteo `.env`.

## Configuracion efectiva

Validacion ejecutada sin mostrar secretos:

```text
{
  'supabase_url_present': True,
  'service_role_present': True,
  'anon_key_present': True,
  'telegram_alerts_enabled': False
}
```

Se ajusto localmente la bandera no secreta `RSMX_ENABLE_TELEGRAM_ALERTS=false` dentro de `apps/rsmx/.env`. El archivo esta ignorado por Git y no debe subirse.

## Pruebas locales

Comando:

```bash
/private/tmp/rsmx-venv/bin/pytest
```

Resultado:

```text
6 passed in 0.18s
```

## Ruff

Comando:

```bash
/private/tmp/rsmx-venv/bin/ruff check .
```

Resultado:

```text
All checks passed!
```

## Conexion real Supabase

Comando ejecutado con red habilitada y sin imprimir secretos:

```bash
/private/tmp/rsmx-venv/bin/python -c "<validacion supabase rsmx>"
```

Resultado:

```text
tables_ok:
- rsmx_sources
- rsmx_raw_items
- rsmx_events
- rsmx_event_sources
- rsmx_alerts
- rsmx_telegram_requests
- rsmx_user_settings

table_counts:
- rsmx_sources: 4
- rsmx_raw_items: 0
- rsmx_events: 0
- rsmx_event_sources: 0
- rsmx_alerts: 0
- rsmx_telegram_requests: 0
- rsmx_user_settings: 0

sources_count: 4
source_keys:
- gdelt
- rss_public_media
- official_morelos
- official_federal
```

## Lectura de rsmx_sources

Resultado: OK.

Fuentes sembradas encontradas: 4.

## Worker

Comando:

```bash
/private/tmp/rsmx-venv/bin/python scripts/run_worker.py
```

Resultado:

```text
RSmx Telegram desactivado por RSMX_ENABLE_TELEGRAM_ALERTS=false.
RSmx worker listo. Eventos procesados en arranque: 1
```

Worker: OK.

Telegram no se intento usar porque `RSMX_ENABLE_TELEGRAM_ALERTS=false`.

## SQL RSmx

Rutas revisadas:

- `apps/rsmx/sql/001_init.sql`
- `apps/rsmx/sql/002_seed_sources.sql`
- `infra/supabase/rsmx/001_init.sql`
- `infra/supabase/rsmx/002_seed_sources.sql`

Resultado: OK.

Confirmacion:

- Las tablas usan prefijo `rsmx_`.
- Los inserts usan `public.rsmx_sources`.
- No se detectaron `CREATE TABLE` ni `INSERT INTO` sobre tablas publicas sin prefijo `rsmx_`.

## Archivos modificados

Durante esta auditoria se modificaron/crearon solo archivos dentro de `apps/rsmx`:

- `apps/rsmx/scripts/run_worker.py`
- `apps/rsmx/audit_supabase_real.md`
- `apps/rsmx/.env` local ignorado por Git, solo para ajustar la bandera no secreta `RSMX_ENABLE_TELEGRAM_ALERTS=false`

No se modifico Radar-Licitaciones-MX.

## Riesgos encontrados

- Falta prueba real con Telegram en bot/chat separado.
- Falta prueba real del worker con fuentes reales y volumen bajo.
- Falta validar Railway como servicio separado.
- Falta medir falsos positivos con datos publicos reales.
- El worker actual procesa muestra local; todavia no persiste eventos reales en Supabase.

## Veredicto

APROBADO SUPABASE.

La conexion real a Supabase separado funciona, las tablas `rsmx_` existen, `rsmx_sources` contiene 4 fuentes sembradas, las pruebas pasan, Ruff pasa, el worker inicia y Telegram queda desactivado intencionalmente con `RSMX_ENABLE_TELEGRAM_ALERTS=false`.
