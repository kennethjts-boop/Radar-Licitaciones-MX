# Railway Deploy Checklist — Radar-Social-MX

## Objetivo

Preparar RSmx para desplegarse en Railway como servicio separado, sin usar ni modificar el servicio actual de Radar-Licitaciones-MX.

## Servicio

- Crear nuevo servicio Railway separado para RSmx.
- Usar como root directory: `apps/rsmx`.
- No usar el servicio actual de licitaciones.
- No modificar Railway, Procfile, README ni configuracion raiz del repo.
- No subir `.env`.

## Servicios recomendados

- Servicio 1: `rsmx-api`
- Servicio 2 posterior: `rsmx-worker`

## API start command

Comando esperado:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Este comando esta configurado en:

- `apps/rsmx/Procfile`
- `apps/rsmx/railway.json`

## Health check

Health check esperado:

```text
/health
```

Respuesta esperada:

```json
{"status":"ok","service":"Radar-Social-MX"}
```

## Variables Railway RSMX_

Configurar solo variables con prefijo `RSMX_`:

```text
RSMX_SUPABASE_URL
RSMX_SUPABASE_SERVICE_ROLE_KEY
RSMX_SUPABASE_ANON_KEY
RSMX_TELEGRAM_BOT_TOKEN
RSMX_TELEGRAM_DEFAULT_CHAT_ID
RSMX_ENABLE_TELEGRAM_ALERTS=false
RSMX_ENABLE_RSS_COLLECTOR=true
RSMX_ENABLE_GDELT_COLLECTOR=true
RSMX_ENABLE_OFFICIAL_COLLECTOR=true
RSMX_MONITOR_INTERVAL_SECONDS=60
RSMX_DEFAULT_MIN_ALERT_SCORE=75
RSMX_DEFAULT_REGION=morelos
```

## Telegram

- No configurar webhook de Telegram todavia hasta validar URL publica.
- Mantener `RSMX_ENABLE_TELEGRAM_ALERTS=false` durante la primera validacion de deploy.
- No activar alertas automaticas hasta terminar pruebas con fuentes reales y falsos positivos.

## Worker

- No activar worker continuo todavia si no esta separado como servicio worker.
- Validar primero `rsmx-api` con `/health`.
- Crear `rsmx-worker` posteriormente como servicio separado si se requiere proceso continuo.

## Validacion antes de deploy

Desde `apps/rsmx`:

```bash
pytest
ruff check .
```

Resultado esperado:

- `pytest`: 6 passed
- `ruff check .`: All checks passed

## Veredicto

Listo para configurar Railway como servicio separado cuando se confirme que se usara `apps/rsmx` como root directory y variables `RSMX_` exclusivas.
