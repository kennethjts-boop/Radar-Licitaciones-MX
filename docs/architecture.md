# Arquitectura — Radar Licitaciones MX

## Visión General

Sistema OSINT de monitoreo continuo de licitaciones públicas en México.
Motor 24/7 corriendo en Railway. Sin frontend. Sin SaaS.

---

## Flujo Operativo End-to-End

```
[SCHEDULER: cada 30 min]
        │
        ▼
[COLLECTOR — comprasmx]
   Playwright → Compras MX
   Paginación → Detalle → Adjuntos
        │
        ▼
[NORMALIZER]
   RawInput → NormalizedProcurement
   Fingerprint canónico calculado
        │
        ▼
[STORAGE: upsert_procurement]
   ¿Nuevo?       → INSERT + versión 1
   ¿Cambió?      → UPDATE + versión N + changed_fields
   ¿Sin cambio?  → update last_seen_at solamente
        │
        ▼
[MATCHER — evaluateAllRadars]
   Para cada radar activo:
   → findMatchingTerms()
   → evaluateRules()
   → score + level + explanation
        │ (si score ≥ minScore)
        ▼
[ENRICHER]
   Match + historial → EnrichedAlert
   Construye mensaje Telegram HTML
        │
        ▼
[ALERTS → TELEGRAM]
   sendMatchAlert() → mensaje enviado
   markAlertSent()  → registrado en DB
        │
        ▼
[STORAGE: alerts, matches]
   Resultado guardado en Supabase
        │
   [cada 24h]
        ▼
[DAILY SUMMARY JOB]
   Agrega métricas del día
   Envía resumen a Telegram
```

---

## Módulos y Responsabilidades

### `/core`
Base técnica del sistema — no tiene dependencias de negocio.

| Archivo | Responsabilidad |
|---------|----------------|
| `logger.ts` | Logger singleton pino — JSON en prod, pretty en dev |
| `fingerprints.ts` | SHA-256 para deduplicación |
| `text.ts` | Normalización, tokenización, escape Telegram |
| `time.ts` | Zona horaria México, formateo, duración |
| `errors.ts` | Jerarquía de errores + withTimeout + withRetry |
| `healthcheck.ts` | Estado del sistema — leído por /prueba |
| `lock.ts` | Prevents scheduler overlap con lock en memoria |

### `/collectors`
Un subdirectorio por fuente. Interface uniforme: retorna `NormalizedProcurement[]`.

| Collector | Estado | Fase |
|-----------|--------|------|
| `comprasmx` | STUB | Fase 1 |
| `dof` | STUB | Fase 3 |
| `institutional_sites` | STUB | Fase 3 |
| `fallback_search` | STUB | Fase 3 |

### `/normalizers`
`procurement.normalizer.ts` — convierte `RawProcurementInput` → `NormalizedProcurement`.
- Normaliza status, procedure_type, amount
- Construye canonical_text y canonical_fingerprint

### `/matchers`
`matcher.ts` — lógica de scoring y explicabilidad.
- `evaluateProcurementAgainstRadar()` → score 0.0–1.0
- `evaluateAllRadars()` → lista de MatchResult

### `/radars`
Un archivo por radar. Registro central en `index.ts`.

### `/enrichers`
`match.enricher.ts` — construye `EnrichedAlert` con contexto histórico.

### `/alerts`
`telegram.alerts.ts` — formato HTML, envío vía node-telegram-bot-api.

### `/commands`
`telegram.commands.ts` — polling bot, handlers de comandos.

### `/storage`
Repositorios de Supabase, uno por entidad de negocio.

### `/jobs`
- `scheduler.ts` — cron 30 min + daily cron
- `collect.job.ts` — orquesta colección → upsert → match → alert
- `daily-summary.job.ts` — agrega y envía resumen

---

## Dependencias del Sistema

```
Railway (process host)
│
├── Supabase (PostgreSQL via @supabase/supabase-js)
├── Telegram (API via node-telegram-bot-api)
└── Playwright (Chromium headless para scraping)
```

---

## Principios de Diseño

1. **Fail fast**: La config valida en startup — no arranca si falta variable
2. **No overlap**: Lock en memoria previene corridas simultáneas
3. **Idempotencia**: Upsert con fingerprint — re-correr no duplica
4. **Explicabilidad**: Cada match incluye términos detectados y score
5. **Separación**: Collector → Normalizer → Matcher → Enricher → Alert — cada paso independiente
6. **Persistencia de raw**: Todo raw_json se guarda — nunca perder información original
