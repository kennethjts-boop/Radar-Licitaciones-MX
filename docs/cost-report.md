# Reporte diario de gastos (worker)

Módulo: `apps/worker/src/modules/cost-report/`. Envía a las 08:00 America/Mexico_City
el gasto del día anterior (00:00–24:00 MX = 06:00Z → 06:00Z) al chat **privado**
que Radar ya usa. Formato determinista, sin IA. Vista previa: `npm run cost-report:preview`.

## Fuentes por proveedor

| Proveedor | Gasto real (proveedor) | Estimación | Notas |
|---|---|---|---|
| OpenAI | Costs API `/v1/organization/costs` (requiere `OPENAI_ADMIN_KEY`) | `ai_usage_events` × tarifa pública | La API sólo agrupa por **día UTC**: se muestra como referencia y no entra al total confirmado. Sin `OPENAI_PROJECT_ID` = organización completa, no atribuible a Radar. |
| OpenRouter | `GET /api/v1/key` → contador `usage` (USD). Corte a las 00:00 MX; día = diferencia de cortes | `usage.cost` de cada respuesta (registro Radar) | Cuenta como confirmado sólo con `OPENROUTER_KEY_DEDICATED=true`. Si falta un corte (reinicio a medianoche) → "no disponible", nunca $0. |
| Railway | No hay monto facturado diario en la API pública | GraphQL `usage` (CPU, RAM, egress del servicio) × tarifa por minuto | Uso bruto, sin créditos del plan. Unidades asumidas vCPU·min / GB·min: validar contra la factura la primera semana. |
| Supabase | No disponible: factura mensual por organización (Pro) con 2 proyectos | No | No atribuible a Radar. |

MXN: sin conversión (no hay fuente de tipo de cambio configurada).

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `COST_REPORT_ENABLED` | `true` | Activa el job |
| `COST_REPORT_HOUR` | `8` | Hora MX del primer intento |
| `COST_REPORT_CHAT_ID` | — | Chat destino; si no, `TELEGRAM_CHAT_ID` y luego admins. Sólo se envía si Telegram confirma `type=private` |
| `COST_REPORT_MAX_ATTEMPTS` | `3` | Reintentos (uno por hora) sólo si es seguro que no se entregó |
| `COST_ANOMALY_PCT` / `COST_ANOMALY_MIN_USD` / `COST_ANOMALY_MIN_DAYS` | `50` / `1` / `3` | Umbral de revisión de gasto |
| `COST_ANOMALY_MIN_REQUESTS` / `COST_ANOMALY_MIN_ERRORS` | `20` / `5` | Umbral de picos de solicitudes / errores y reintentos |
| `OPENAI_ADMIN_KEY`, `OPENAI_PROJECT_ID` | — | Gasto real OpenAI |
| `OPENROUTER_KEY_DEDICATED` | `false` | Declara que la clave es exclusiva de Radar |
| `RAILWAY_API_TOKEN` | — | Estimación Railway (`RAILWAY_PROJECT_ID`/`RAILWAY_SERVICE_ID` los inyecta Railway) |

## Un solo envío por día

Estado en `system_state` (`cost_report:YYYY-MM-DD`). Primer intento = `INSERT`
(la PK rechaza duplicados entre instancias); reintento sólo desde `failed`
con compare-and-set. `uncertain` (timeout de Telegram) y `claimed` nunca se
reenvían. El envío es de un solo intento (sin reintentos internos).

## Registro de consumo de IA

Tabla `ai_usage_events` (migración `20261024_ai_usage_events.sql`): proveedor,
modelo, operación, fecha, tokens, estado, intento, costo informado/estimado y
tipo de error. No guarda prompts, respuestas ni claves. Los reintentos internos
del SDK de OpenAI no son visibles; los del pool de modelos sí (`attempt>1`).
