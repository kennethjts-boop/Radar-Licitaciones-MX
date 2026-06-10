# Variables de Entorno — Radar Licitaciones MX

## Archivo de ejemplo: `.env`

Copiar este archivo como `.env` en `apps/worker/`.
**NUNCA commitear `.env` a GitHub.** Solo `.env.example`.

---

## Variables Requeridas

```env
# ── Runtime ──────────────────────────────────────────────────────────────────
NODE_ENV=development
# Valores: development | production | test
# En Railway: production

LOG_LEVEL=info
# Valores: trace | debug | info | warn | error | fatal
# Usar 'debug' en desarrollo, 'info' en producción

RADAR_DEBUG_CANDIDATES=false
# Diagnóstico controlado. Si es true, agrega detalle de candidatos descartados
# en logs y /debug_resumen. No envía alertas extra ni guarda basura como lead real.

# ── Supabase ─────────────────────────────────────────────────────────────────
SUPABASE_URL=https://XXXXXXXXXXXXXXXX.supabase.co
# Obtener de: Supabase Dashboard → Project Settings → API → Project URL

SUPABASE_SERVICE_ROLE_KEY=eyJXXXXXXXXXXXXXXXXXXXXXXX
# Obtener de: Supabase Dashboard → Project Settings → API → service_role (secret)
# CRÍTICO: Esta key bypasea Row Level Security — NO exponer nunca

# ── Telegram ──────────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=1234567890:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
# Crear bot con @BotFather en Telegram
# Comando: /newbot → sigue instrucciones → copia el token

TELEGRAM_CHAT_ID=-1001234567890
# El chat ID del grupo o canal donde se enviarán las alertas
# Para grupos: normalmente negativo (e.g. -1001234567890)
# Para canales: @nombrecanal o ID numérico
# Para obtener el ID: usar @userinfobot o la API de Telegram

TELEGRAM_COMMAND_BOT_ENABLED=true
TELEGRAM_COMMANDS_ENABLED=true
TELEGRAM_POLLING_ENABLED=true
# Los tres deben estar en true para escuchar comandos por polling.
# En servicios o réplicas secundarias de Railway, usar TELEGRAM_POLLING_ENABLED=false
# para evitar 409 Conflict por múltiples getUpdates con el mismo token.

# ── Playwright ────────────────────────────────────────────────────────────────
PLAYWRIGHT_HEADLESS=true
# En Railway debe ser true (sin display)
# En desarrollo local puede ser false para debug visual

# ── Scheduler ────────────────────────────────────────────────────────────────
COLLECT_INTERVAL_MINUTES=30
# Cada cuántos minutos corre la colección principal
# Mínimo recomendado: 15, máximo útil: 60

DAILY_SUMMARY_HOUR=7
# Hora en México City (0-23) a la que se envía el resumen diario
# 7 = 7:00 AM

# ── App ───────────────────────────────────────────────────────────────────────
APP_TIMEZONE=America/Mexico_City
# No cambiar — toda la lógica temporal asume esta zona

# ── Fondos Internacionales ───────────────────────────────────────────────────
FONDOS_ENABLED=true
# Valores: "true" | "false"
# Default: "true" — el collector de fondos internacionales corre cada 6h
# Setear en "false" para PAUSAR el collector de fondos sin redeploy.
# No afecta comprasmx, dof, institutional_sites ni fallback_search.
# Cambiar en Railway Variables UI → el scheduler detecta el valor al arrancar.

# ── External Leads OSINT ─────────────────────────────────────────────────────
ENABLE_EXTERNAL_LEADS_OSINT=false
# Default seguro: false. Si no existe o está false, no consulta fuentes externas,
# no crea leads y no envía alertas OSINT.

EXTERNAL_LEADS_DRY_RUN=true
# Default seguro: true. Detecta, calcula score y registra logs/estado, pero no
# guarda en Supabase ni envía Telegram.

EXTERNAL_LEADS_MAX_RESULTS_PER_RUN=5
# Límite máximo de leads procesados/alertados por ciclo.

EXTERNAL_LEADS_MIN_SCORE=60
# Score mínimo 0-100 para guardar/alertar leads externos.

EXTERNAL_LEADS_LOOKBACK_DAYS=180
# Ventana temporal usada por el scoring conservador.

EXTERNAL_LEADS_MORELOS_ONLY=true
# Mantener true por defecto. Si se desactiva, CAPUFE nacional solo se acepta
# cuando aparezca con señales de desierta, oportunidad, baja competencia,
# sin participantes o condiciones similares.

EXTERNAL_LEADS_TARGET_LOCATIONS=
# Lista opcional separada por comas. Si existe, reemplaza el filtro territorial
# de EXTERNAL_LEADS_MORELOS_ONLY. Ejemplo:
# morelos,jalisco,guadalajara,cdmx,estado-de-mexico

EXTERNAL_LEADS_TELEGRAM_ENABLED=false
# Control independiente de alertas Telegram OSINT. Si es false, el módulo guarda
# leads pero no manda mensajes.

COMMERCIAL_MATCHING_ENABLED=true
# Activa el motor unico de inteligencia comercial para ComprasMX y External OSINT.

COMMERCIAL_MATCHING_MIN_SCORE=60
# Score minimo 0-100 para considerar una oportunidad comercial alertable.

COMMERCIAL_MATCHING_REQUIRE_TERRITORY=true
# Si es true, exige Morelos, Guadalajara/Jalisco, CDMX o Edomex; nacional queda
# como "Nacional / posible" con penalizacion.

COMMERCIAL_MATCHING_DEBUG=true
# Guarda telemetria de descartes y candidatos comerciales en /debug_resumen.

EXTERNAL_LEADS_DISCOVERY_MODE=true
# Se ignora y se reporta como false cuando ENABLE_EXTERNAL_LEADS_OSINT=false.
# Modo de inspección seguro: registra telemetría completa, muestra descartes y
# fuerza Telegram apagado para External OSINT.

EXTERNAL_LEADS_DEBUG_DISCARDS=true
# Incluye topDiscardedCandidates sanitizados en system_state y healthcheck.

EXTERNAL_LEADS_SAVE_LOW_SCORE_CANDIDATES=false
# Si es true, guarda candidatos debajo del score mínimo como diagnostic_low_score.
# No envía Telegram ni los cuenta como alertas reales.

EXTERNAL_LEADS_MAX_RAW_RESULTS_PER_SOURCE=50
# Límite de resultados crudos por adapter/fuente por ciclo.

EXTERNAL_LEADS_SOURCE_TIMEOUT_MS=15000
# Timeout HTTP por fuente/adaptador.

La migración `docs/migrations/12_external_leads_osint.sql` debe ejecutarse una
vez antes de pasar `EXTERNAL_LEADS_DRY_RUN=false`. El runtime opera por Supabase
REST; `SUPABASE_DB_URL` no es dependencia normal del módulo OSINT.

# ── Railway (automático en deploy) ───────────────────────────────────────────
RAILWAY_ENVIRONMENT=production
# Railway inyecta esta variable automáticamente en producción
```

---

## Notas de Seguridad

- `SUPABASE_SERVICE_ROLE_KEY` tiene acceso completo a la DB — **solo para backend**
- `TELEGRAM_BOT_TOKEN` — almacenar en Railway Secrets, no en variables plaintext
- Usar Railway Variables UI para setear en producción, nunca en el repositorio

## Cómo configurar en Railway

1. Railway Dashboard → tu proyecto → Variables
2. Agregar cada variable del listado anterior
3. Railway inyecta automáticamente en el proceso

## .env.example (lo que sí va al repo)

```env
NODE_ENV=development
LOG_LEVEL=info
RADAR_DEBUG_CANDIDATES=false
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_COMMAND_BOT_ENABLED=true
TELEGRAM_COMMANDS_ENABLED=true
TELEGRAM_POLLING_ENABLED=true
PLAYWRIGHT_HEADLESS=true
COLLECT_INTERVAL_MINUTES=30
DAILY_SUMMARY_HOUR=7
ENABLE_EXTERNAL_LEADS_OSINT=false
EXTERNAL_LEADS_DRY_RUN=true
EXTERNAL_LEADS_MAX_RESULTS_PER_RUN=5
EXTERNAL_LEADS_MIN_SCORE=60
EXTERNAL_LEADS_LOOKBACK_DAYS=180
EXTERNAL_LEADS_MORELOS_ONLY=true
EXTERNAL_LEADS_TARGET_LOCATIONS=
EXTERNAL_LEADS_TELEGRAM_ENABLED=false
COMMERCIAL_MATCHING_ENABLED=true
COMMERCIAL_MATCHING_MIN_SCORE=60
COMMERCIAL_MATCHING_REQUIRE_TERRITORY=true
COMMERCIAL_MATCHING_DEBUG=true
EXTERNAL_LEADS_DISCOVERY_MODE=true
EXTERNAL_LEADS_DEBUG_DISCARDS=true
EXTERNAL_LEADS_SAVE_LOW_SCORE_CANDIDATES=false
EXTERNAL_LEADS_MAX_RAW_RESULTS_PER_SOURCE=50
EXTERNAL_LEADS_SOURCE_TIMEOUT_MS=15000
APP_TIMEZONE=America/Mexico_City
RAILWAY_ENVIRONMENT=
```
