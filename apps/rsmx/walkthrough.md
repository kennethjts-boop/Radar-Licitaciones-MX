# RSmx Walkthrough

## 1. Que se creo

Se agrego Radar-Social-MX, abreviado RSmx, como proyecto Python/FastAPI autocontenido para monitoreo OSINT/SOCMINT publico y legal.

Incluye:

- API FastAPI con endpoints `/health`, `/telegram/webhook`, `/events/recent`, `/events/top` y `/sources`.
- Router basico de comandos Telegram RSmx.
- Normalizer, classifier, deduplicator, scoring engine y alert formatter.
- Worker aislado de procesamiento.
- SQL propio con tablas prefijadas `rsmx_`.
- Pruebas unitarias para clasificacion, scoring, deduplicacion y formato Telegram.
- Configuracion Railway y Procfile exclusivos dentro de `apps/rsmx/`.

## 2. Rutas creadas

- `apps/rsmx/`
- `docs/rsmx/`
- `infra/supabase/rsmx/`

## 3. Confirmacion de aislamiento

No se modifico Radar-Licitaciones-MX.

No se tocaron:

- `apps/worker/`
- `apps/api/`
- `src/`
- `package.json`
- lockfiles JS
- README raiz
- Railway o Procfile raiz
- `.env` o `.env.example` raiz
- `supabase/` existente
- imports, scheduler, Telegram, worker o DB del radar de licitaciones

## 4. Resultado de pruebas

Comandos ejecutados:

```bash
pytest
ruff check .
```

Resultado en PATH global: no disponible porque `pytest` y `ruff` no estaban instalados.

Validacion ejecutada con entorno temporal fuera del repo:

```bash
/private/tmp/rsmx-venv/bin/pytest
/private/tmp/rsmx-venv/bin/ruff check .
```

Resultado:

- `pytest`: 6 passed.
- `ruff check`: All checks passed.

No se creo `.venv` dentro del repositorio.

## 5. Comando git diff --name-only

```bash
git diff --name-only
```

Salida:

```text
```

Nota: la salida esta vacia porque los archivos nuevos aun estan no trackeados. Para auditar los archivos nuevos se ejecuto:

```bash
git status --short --untracked-files=all
```

Salida relevante:

```text
?? apps/rsmx/.env.example
?? apps/rsmx/Procfile
?? apps/rsmx/README.md
?? apps/rsmx/app/__init__.py
?? apps/rsmx/app/api/__init__.py
?? apps/rsmx/app/api/routes.py
?? apps/rsmx/app/bot/__init__.py
?? apps/rsmx/app/bot/commands.py
?? apps/rsmx/app/bot/telegram.py
?? apps/rsmx/app/collectors/__init__.py
?? apps/rsmx/app/collectors/gdelt.py
?? apps/rsmx/app/collectors/official.py
?? apps/rsmx/app/collectors/rss.py
?? apps/rsmx/app/config.py
?? apps/rsmx/app/database.py
?? apps/rsmx/app/main.py
?? apps/rsmx/app/models/__init__.py
?? apps/rsmx/app/models/schemas.py
?? apps/rsmx/app/processing/__init__.py
?? apps/rsmx/app/processing/classifier.py
?? apps/rsmx/app/processing/deduplicator.py
?? apps/rsmx/app/processing/normalizer.py
?? apps/rsmx/app/processing/scoring.py
?? apps/rsmx/app/processing/text.py
?? apps/rsmx/app/services/__init__.py
?? apps/rsmx/app/services/alert_engine.py
?? apps/rsmx/app/services/event_store.py
?? apps/rsmx/app/workers/__init__.py
?? apps/rsmx/app/workers/monitor.py
?? apps/rsmx/pyproject.toml
?? apps/rsmx/railway.json
?? apps/rsmx/requirements.txt
?? apps/rsmx/scripts/run_worker.py
?? apps/rsmx/sql/001_init.sql
?? apps/rsmx/sql/002_seed_sources.sql
?? apps/rsmx/tests/test_processing.py
?? apps/rsmx/tests/test_telegram.py
?? apps/rsmx/walkthrough.md
?? docs/rsmx/README.md
?? infra/supabase/rsmx/001_init.sql
?? infra/supabase/rsmx/002_seed_sources.sql
```

## 6. Confirmacion de rutas permitidas

Todos los archivos nuevos estan dentro de:

- `apps/rsmx/`
- `docs/rsmx/`
- `infra/supabase/rsmx/`

No aparece ningun archivo prohibido en el estado final.

## 8. Validacion de stage

Comandos previstos antes de commit:

```bash
git add apps/rsmx docs/rsmx infra/supabase/rsmx
git diff --cached --name-only
git diff --cached --name-only | grep -vE '^(apps/rsmx/|docs/rsmx/|infra/supabase/rsmx/)'
```

Resultado:

`git diff --cached --name-only` mostro solo archivos bajo rutas permitidas:

```text
apps/rsmx/.env.example
apps/rsmx/Procfile
apps/rsmx/README.md
apps/rsmx/app/__init__.py
apps/rsmx/app/api/__init__.py
apps/rsmx/app/api/routes.py
apps/rsmx/app/bot/__init__.py
apps/rsmx/app/bot/commands.py
apps/rsmx/app/bot/telegram.py
apps/rsmx/app/collectors/__init__.py
apps/rsmx/app/collectors/gdelt.py
apps/rsmx/app/collectors/official.py
apps/rsmx/app/collectors/rss.py
apps/rsmx/app/config.py
apps/rsmx/app/database.py
apps/rsmx/app/main.py
apps/rsmx/app/models/__init__.py
apps/rsmx/app/models/schemas.py
apps/rsmx/app/processing/__init__.py
apps/rsmx/app/processing/classifier.py
apps/rsmx/app/processing/deduplicator.py
apps/rsmx/app/processing/normalizer.py
apps/rsmx/app/processing/scoring.py
apps/rsmx/app/processing/text.py
apps/rsmx/app/services/__init__.py
apps/rsmx/app/services/alert_engine.py
apps/rsmx/app/services/event_store.py
apps/rsmx/app/workers/__init__.py
apps/rsmx/app/workers/monitor.py
apps/rsmx/pyproject.toml
apps/rsmx/railway.json
apps/rsmx/requirements.txt
apps/rsmx/scripts/run_worker.py
apps/rsmx/sql/001_init.sql
apps/rsmx/sql/002_seed_sources.sql
apps/rsmx/tests/test_processing.py
apps/rsmx/tests/test_telegram.py
apps/rsmx/walkthrough.md
docs/rsmx/README.md
infra/supabase/rsmx/001_init.sql
infra/supabase/rsmx/002_seed_sources.sql
```

El filtro:

```bash
git diff --cached --name-only | grep -vE '^(apps/rsmx/|docs/rsmx/|infra/supabase/rsmx/)'
```

no produjo salida.

## 9. Commit

El hash exacto del commit se reporta con `git rev-parse HEAD` despues de crearlo. No se incrusta el hash dentro del mismo commit porque eso haria el commit autorreferencial y cambiaria su hash.

## 7. Siguiente paso recomendado

Crear la base RSmx ejecutando `apps/rsmx/sql/001_init.sql` y `apps/rsmx/sql/002_seed_sources.sql` en un proyecto Supabase separado o en un schema controlado, configurar variables `RSMX_` en un servicio Railway independiente y levantar RSmx desde `apps/rsmx/`.
