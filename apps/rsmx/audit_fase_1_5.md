# Auditoria Fase 1.5 — Radar-Social-MX

## Contexto

Rama auditada: `feature/rsmx-isolated-module`

Objetivo: validar localmente que `apps/rsmx` funciona como modulo aislado, sin tocar `main`, sin deploy, sin migraciones y sin conectar Supabase o Telegram reales.

## Resultado ejecutivo

- FastAPI: OK
- `/health`: OK
- pytest: OK, 6 passed
- ruff: OK, All checks passed
- worker: OK
- Supabase: pendiente por credenciales reales
- Telegram: pendiente por credenciales reales
- aislamiento: OK
- veredicto: APROBADO LOCALMENTE

## Entorno

Se ejecuto desde:

```bash
cd apps/rsmx
```

Se uso un entorno virtual temporal fuera del repositorio:

```bash
/private/tmp/rsmx-venv
```

No se creo `.venv` dentro del repo y no se modificaron dependencias del proyecto principal.

## Dependencias

Comando:

```bash
/private/tmp/rsmx-venv/bin/pip install -r requirements.txt
```

Resultado: OK. Todas las dependencias ya estaban satisfechas en el venv temporal.

## Pruebas

Comando:

```bash
/private/tmp/rsmx-venv/bin/pytest
```

Resultado:

```text
collected 6 items
tests/test_processing.py .....                                           [ 83%]
tests/test_telegram.py .                                                 [100%]
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

## Imports

Comando:

```bash
/private/tmp/rsmx-venv/bin/python -m compileall app scripts tests
```

Resultado: OK.

Se encontro y corrigio un error real en `scripts/run_worker.py`: al ejecutarse como archivo con `python scripts/run_worker.py`, Python no encontraba el paquete local `app` porque `sys.path` apuntaba a `scripts/`. Se corrigio dentro de `apps/rsmx` agregando resolucion explicita del project root.

## FastAPI

Comando:

```bash
/private/tmp/rsmx-venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Resultado: OK.

Nota: el primer intento de bind fue bloqueado por el sandbox local con `operation not permitted`. Al ejecutar con permiso para abrir puerto local, Uvicorn arranco correctamente.

## Health

Comando:

```bash
curl -sS http://127.0.0.1:8765/health
```

Resultado:

```json
{"status":"ok","service":"Radar-Social-MX"}
```

Tambien se validaron endpoints de lectura:

```bash
curl -sS http://127.0.0.1:8765/sources
curl -sS http://127.0.0.1:8765/events/recent
```

Resultados:

- `/sources`: OK, devolvio fuentes configurables.
- `/events/recent`: OK, devolvio lista vacia local.

## Worker

Comando:

```bash
/private/tmp/rsmx-venv/bin/python scripts/run_worker.py
```

Resultado:

```text
RSmx Supabase no configurado; usando modo local sin persistencia remota.
RSmx Telegram no configurado; omitiendo envio de alertas externas.
RSmx worker listo. Eventos procesados en arranque: 1
```

Veredicto worker: OK.

El worker inicia sin credenciales reales y falla de forma controlada para integraciones externas: no intenta persistir en Supabase ni enviar Telegram si faltan credenciales.

## Variables RSMX

Se reviso `.env.example`.

Variables presentes:

- `RSMX_PROJECT_NAME`
- `RSMX_APP_SHORT_NAME`
- `RSMX_ENVIRONMENT`
- `RSMX_SUPABASE_URL`
- `RSMX_SUPABASE_SERVICE_ROLE_KEY`
- `RSMX_SUPABASE_ANON_KEY`
- `RSMX_TELEGRAM_BOT_TOKEN`
- `RSMX_TELEGRAM_WEBHOOK_URL`
- `RSMX_TELEGRAM_DEFAULT_CHAT_ID`
- `RSMX_ENABLE_TELEGRAM_ALERTS`
- `RSMX_ENABLE_RSS_COLLECTOR`
- `RSMX_ENABLE_GDELT_COLLECTOR`
- `RSMX_ENABLE_OFFICIAL_COLLECTOR`
- `RSMX_MONITOR_INTERVAL_SECONDS`
- `RSMX_DEFAULT_MIN_ALERT_SCORE`
- `RSMX_DEFAULT_REGION`
- `RSMX_LOG_LEVEL`

Resultado: OK.

## Supabase

Estado: pendiente por credenciales reales.

Validacion local:

- No se conecto Supabase real.
- La configuracion sin `RSMX_SUPABASE_URL` y `RSMX_SUPABASE_SERVICE_ROLE_KEY` se detecta como no configurada.
- El worker continua en modo local sin persistencia remota.

## Telegram

Estado: pendiente por credenciales reales.

Validacion local:

- No se conecto Telegram real.
- La ausencia de `RSMX_TELEGRAM_BOT_TOKEN` y `RSMX_TELEGRAM_DEFAULT_CHAT_ID` se detecta como no configurada.
- El worker omite envio de alertas externas.

## SQL

Rutas revisadas:

- `apps/rsmx/sql/001_init.sql`
- `apps/rsmx/sql/002_seed_sources.sql`
- `infra/supabase/rsmx/001_init.sql`
- `infra/supabase/rsmx/002_seed_sources.sql`

Resultado: OK para ejecucion en Supabase separado.

Confirmacion:

- Todas las tablas usan prefijo `rsmx_`.
- Los inserts apuntan a `public.rsmx_sources`.
- No se detectaron tablas genericas como `sources`, `events` o `alerts`.

## Aislamiento

Resultado: OK.

Validaciones:

- No hay imports desde `apps/worker`.
- No hay imports desde `apps/api`.
- No hay dependencia del radar de licitaciones en codigo runtime de RSmx.
- Las referencias a Radar-Licitaciones-MX encontradas estan en documentacion de aislamiento, no en imports runtime.

## Archivos modificados

Durante Fase 1.5 se modificaron/crearon solo archivos dentro de `apps/rsmx`:

- `apps/rsmx/scripts/run_worker.py`
- `apps/rsmx/audit_fase_1_5.md`

No se modifico Radar-Licitaciones-MX.

## Riesgos encontrados

- Falta prueba real con Supabase separado.
- Falta prueba real con Telegram separado.
- Falta prueba real del worker con fuentes reales.
- Falta validar Railway como servicio separado.
- Falta medir falsos positivos con fuentes publicas reales.
- El bind local de Uvicorn requiere permiso fuera del sandbox de ejecucion.

## Veredicto

APROBADO LOCALMENTE.

RSmx funciona en local como modulo aislado para API, `/health`, pruebas, lint, imports y worker sin credenciales reales. No esta aprobado aun para merge/deploy productivo hasta completar pruebas reales de Supabase, Telegram, fuentes y Railway separado.
