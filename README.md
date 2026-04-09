# Radar Licitaciones MX

> Motor OSINT 24/7 de scraping y monitoreo de licitaciones públicas en México.
> Sin frontend. Sin SaaS. Base técnica de producción.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 20+ / TypeScript |
| Scraping | Playwright (Chromium headless) |
| Base de datos | Supabase (PostgreSQL) |
| Alertas | Telegram Bot API |
| Deploy | Railway 24/7 |
| Repositorio | GitHub |

---

## Arquitectura en un vistazo

```
[Scheduler 30min]
      │
      ▼
[Collector] → [Normalizer] → [Storage: upsert]
                                    │
                                    ▼
                              [Matcher] → [Enricher] → [Alert → Telegram]
                                    │
                              [Daily Summary 7AM]
```

Ver [docs/architecture.md](docs/architecture.md) para detalle completo.

---

## Radares Activos (Fase 0)

| Radar | Dependencia | Prioridad |
|-------|-------------|-----------|
| `capufe_emergencia` | CAPUFE | 1 |
| `capufe_peaje` | CAPUFE | 1 |
| `capufe_oportunidades` | CAPUFE | 2 |
| `issste_oficinas_centrales` | ISSSTE | 1 |
| `conavi_federal` | CONAVI | 2 |
| `imss_morelos` | IMSS OOAD Morelos | 1 |
| `imss_bienestar_morelos` | IMSS-Bienestar Morelos | 1 |
| `habitat_morelos` | SEDATU/Hábitat Morelos | 3 |

---

## Estructura del Proyecto

```
/radar-licitaciones-mx
  /apps/worker/
    /src/
      /core/           logger, fingerprints, text, time, errors, healthcheck, lock
      /collectors/     comprasmx/, dof/, institutional_sites/, fallback_search/
      /normalizers/    procurement.normalizer.ts
      /matchers/       matcher.ts
      /helpers/entities/
      /radars/         *.radar.ts + index.ts
      /enrichers/      match.enricher.ts
      /alerts/         telegram.alerts.ts
      /commands/       telegram.commands.ts
      /storage/        client.ts + *.repo.ts
      /jobs/           scheduler.ts + *.job.ts
      /types/          procurement.ts + database.ts
      /config/         env.ts
    .env.example
    Dockerfile
    package.json
    tsconfig.json
  /docs/
    architecture.md
    data-model.md
    radars.md
    telegram-alerts.md
    scheduler.md
    roadmap.md
    supabase-schema.sql
    env-vars.md
  /.github/workflows/  ci.yml
  railway.toml
  .gitignore
```

---

## Checklist para Fase 1 — Infraestructura Viva

### Paso 1: GitHub
```bash
# Desde la raíz del proyecto
git init
git add .
git commit -m "chore: Phase 0 — base técnica completa"
gh repo create radar-licitaciones-mx --private
git remote add origin https://github.com/TU_USUARIO/radar-licitaciones-mx.git
git push -u origin main
```

### Paso 2: Supabase
1. Crear proyecto en [supabase.com](https://supabase.com)
2. Ir a **SQL Editor** → pegar y ejecutar `docs/supabase-schema.sql`
3. Ir a **Settings → API** → copiar:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

### Paso 3: Telegram Bot
1. Abrir Telegram → buscar `@BotFather`
2. `/newbot` → seguir instrucciones → copiar `TELEGRAM_BOT_TOKEN`
3. Agregar el bot al grupo/canal de alertas
4. Obtener `TELEGRAM_CHAT_ID`:
   - Enviar un mensaje al grupo
   - Visitar: `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Buscar `"chat": {"id": ...}` en la respuesta

### Paso 4: Railway
1. Crear proyecto en [railway.app](https://railway.app)
2. Conectar con el repositorio GitHub
3. En **Variables** → agregar todas las variables de `docs/env-vars.md`
4. Railway auto-detectará `railway.toml` y usará el Dockerfile
5. Deploy automático

### Paso 5: Verificación
1. Esperar que Railway build y arranque el worker
2. En Telegram → enviar `/prueba` al bot
3. Respuesta esperada: Worker OK, DB OK (cuando Supabase conecte)

---

## Comandos Locales

```bash
cd apps/worker

# Instalar dependencias
npm install

# Verificar tipos
npm run typecheck

# Desarrollo con hot-reload
# (antes copiar .env.example a .env y completar variables)
npm run dev
```

---

## Documentación

| Documento | Descripción |
|-----------|-------------|
| [architecture.md](docs/architecture.md) | Flujo y módulos |
| [data-model.md](docs/data-model.md) | Contrato de datos |
| [radars.md](docs/radars.md) | Configuración de radares |
| [telegram-alerts.md](docs/telegram-alerts.md) | Formatos de alerta |
| [scheduler.md](docs/scheduler.md) | Estrategia de ejecución |
| [roadmap.md](docs/roadmap.md) | Fases del proyecto |
| [env-vars.md](docs/env-vars.md) | Variables de entorno |
| [supabase-schema.sql](docs/supabase-schema.sql) | SQL completo de Supabase |

---

## Estado

**Fase 0 — COMPLETADA** ✅

Base técnica lista. Próximo paso: [Fase 1 — Infraestructura Viva](docs/roadmap.md).
