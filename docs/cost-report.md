# Reporte diario de gastos (worker)

Módulo: `apps/worker/src/modules/cost-report/`. Envía a las 08:00 America/Mexico_City
el gasto del día anterior (00:00–24:00 MX = 06:00Z → 06:00Z) al chat **privado**
que Radar ya usa. Formato determinista, sin IA. Vista previa: `npm run cost-report:preview`.

## Fuentes por proveedor

| Proveedor | Gasto real (proveedor) | Estimación | Notas |
|---|---|---|---|
| OpenAI | Costs API `/v1/organization/costs` (requiere `OPENAI_ADMIN_KEY`) | `ai_usage_events` × tarifa pública | La API sólo agrupa por **día UTC**: se muestra como referencia y no entra al total confirmado. Sin `OPENAI_PROJECT_ID` = organización completa, no atribuible a Radar. |
| OpenRouter | `GET /api/v1/key` → contador `usage` (USD). Primer corte de cada día MX con hora real y huella `sha256:` (16 hex) de la clave; día = diferencia de cortes de la misma clave | `usage.cost` de cada respuesta (registro Radar) | Confirmado sólo si ambos cortes caen ≤60 s tras las 00:00 MX **y** `OPENROUTER_KEY_DEDICATED=true`. Corte tardío → referencia con el periodo real. Claves distintas o contador que baja → no disponible, nunca $0. |
| Railway | No disponible | No | La consulta `usage` existe (changelog 2023-02-17) pero su esquema y unidades no tienen documentación oficial: sólo se muestran valores crudos del servicio, sin costo; Railway queda fuera de totales y anomalías. |
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
| `RAILWAY_API_TOKEN` | — | Opcional: métricas crudas de Railway, sin costo (`RAILWAY_PROJECT_ID`/`RAILWAY_SERVICE_ID` los inyecta Railway) |

## Un solo envío por día

Estado en `system_state` (`cost_report:YYYY-MM-DD`). Primer intento = `INSERT`
(la PK rechaza duplicados entre instancias); reintento sólo desde `failed`
con compare-and-set. El envío es de un solo intento (sin reintentos internos).

- Sólo un fallo **antes** de llamar a Telegram, o un rechazo explícito de la
  API de Telegram, deja `failed` (reintentable, máximo `COST_REPORT_MAX_ATTEMPTS`).
- Entrega confirmada → `sent`; timeout o error de red ambiguo → `uncertain`.
  Ninguno de los dos vuelve a `failed`.
- Si falla guardar `sent`/`uncertain` (3 intentos), la fila queda en
  `claimed`, que nunca se reenvía, y el proceso además recuerda la fecha en
  memoria. El reporte siguiente avisa que el día anterior quedó en ese estado.

## Comparaciones

"Ayer" es la fecha calendario exacta anterior; si no hay reporte de ese día
se muestra "sin datos". El promedio usa sólo D-1…D-7 por fecha.

## Registro de consumo de IA

Tabla `ai_usage_events` (migración `20261024_ai_usage_events.sql`): proveedor,
modelo, operación, fecha, tokens, estado, intento, costo informado/estimado y
tipo de error. No guarda prompts, respuestas ni claves. Embeddings: entrada =
`prompt_tokens` (o `total_tokens`), salida = 0. Los reintentos internos
del SDK de OpenAI no son visibles; los del pool de modelos sí (`attempt>1`).
