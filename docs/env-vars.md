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
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
PLAYWRIGHT_HEADLESS=true
COLLECT_INTERVAL_MINUTES=30
DAILY_SUMMARY_HOUR=7
APP_TIMEZONE=America/Mexico_City
RAILWAY_ENVIRONMENT=
```
