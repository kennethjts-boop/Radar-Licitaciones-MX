# Reporte diario de gastos (worker)

Módulo: `apps/worker/src/modules/cost-report/`. Envía a las 08:00 America/Mexico_City
el gasto del día anterior (00:00–24:00 MX = 06:00Z → 06:00Z) al chat **privado**
que Radar ya usa. Formato determinista, sin IA. Vista previa: `npm run cost-report:preview`.

## Cobertura de la medición

`system_state.cost_coverage:ai_usage` guarda **desde cuándo** existe medición
confiable: lo escribe una sola vez (INSERT) el primer worker con esta
instrumentación que confirma acceso a `ai_usage_events`. Cada día MX se clasifica:

| Estado | Regla | En el reporte |
|---|---|---|
| sin cobertura | el día terminó antes del marcador, o no hay marcador | "sin datos"; no se consulta la tabla, nunca US$0.00 |
| parcial | el marcador cae dentro del día, o `cost_coverage:gaps:<día>` registra eventos perdidos | valores con "medición parcial" |
| completo | marcador ≤ 00:00 MX y sin huecos | normal |

Sólo los días **completos** entran a "vs ayer", promedio 7 d y anomalías de
métricas de IA (total estimado, estimados por proveedor, solicitudes, errores,
reintentos). Reportes guardados antes de esta versión no traen cobertura y
quedan fuera (el US$0.00 del 22/10 ya no contamina promedios). Las cifras que
no dependen del registro (contador OpenRouter, total confirmado) sí se comparan.

Pérdidas: si un INSERT falla, la fila se reintenta en memoria (cada 60 s,
máx. 30 veces, máx. 500 filas). Al agotarse o desbordarse se suma al hueco del
día → parcial. Límite conocido: filas pendientes al terminar el proceso se
pierden sin marcar el hueco.

## Llamadas instrumentadas

| Operación | Archivo | Proveedor | Intentos HTTP |
|---|---|---|---|
| `analyze_tender` (incl. pool de modelos, `attempt`) | `ai/openai.service.ts` | OpenAI u OpenRouter | medidos (`observedFetch`) |
| `abusive_clauses` | `ai/openai.service.ts` | OpenAI u OpenRouter | medidos |
| `embedding` | `ai/openai.service.ts` | OpenAI u OpenRouter | medidos |
| `deep_analysis` | `agent/deep-analysis.service.ts` | OpenAI | medidos |
| `watchdog_narrator` | `watchdog-narrator/ai-narrator.ts` | OpenRouter | 1 (fetch directo, sin reintentos); cualquier fallo tras enviar se registra una vez |

Una fila = una **solicitud observada**. `attempt>1` = reintento con otro
modelo del pool. `http_attempts` = intentos HTTP que hizo el SDK (los
reintentos internos 408/429/5xx/timeout se cuentan pasando un `fetch` que
sólo observa); NULL = no medible (filas previas o migración pendiente). Un
reintento tras timeout pudo consumir tokens que ninguna respuesta reporta:
eso sólo lo revela el contraste con el proveedor.

## Fuentes por proveedor

| Proveedor | Consumo medido | Costo | Contraste / pendiente |
|---|---|---|---|
| OpenAI | `ai_usage_events`: solicitudes, tokens por modelo | Estimado = tokens × tarifa pública. Real: Costs API (sólo día UTC → referencia) | Usage API `/organization/usage/{completions,embeddings}` con `bucket_width=1h` = día MX exacto por modelo; con `OPENAI_PROJECT_ID` sólo el proyecto de Radar. Se muestra la diferencia de solicitudes y tokens vs el registro |
| OpenRouter | `usage.cost` de cada respuesta + huella `key_id` | Real: diferencia de cortes del contador `/api/v1/key` (confirmado sólo alineado a 00:00 MX y `OPENROUTER_KEY_DEDICATED=true`) | Contador vs suma de `usage.cost` de la **misma clave** en el **periodo real** de los cortes; respuestas de otras claves se excluyen |
| Railway | API `usage` del servicio, valores crudos | No disponible por API documentada; **no se convierte** | Fuente oficial: CLI `railway usage projects --project <Radar>` (desglose por servicio) o Workspace → Usage; acumulado del periodo |
| Supabase | Horas de cómputo del proyecto | Estimado = 24 h × tarifa horaria del tamaño declarado en `SUPABASE_COMPUTE_SIZE` (cómputo se cobra por proyecto y por hora) | Plan Pro (US$25) y créditos de cómputo (US$10) son de la organización → no se atribuyen. Disco/egreso por proyecto: página Usage filtrando Radar |

## Permisos mínimos (no se crean ni configuran desde el worker)

| Para | Permiso mínimo | Variable |
|---|---|---|
| Gasto real y contraste OpenAI | Admin key de la organización (la crea un Owner); el worker sólo hace GET a `/organization/usage` y `/organization/costs` | `OPENAI_ADMIN_KEY`, y `OPENAI_PROJECT_ID` de un proyecto dedicado a Radar |
| Atribuir OpenRouter a Radar | Clave de inferencia usada sólo por Radar (declaración del dueño) | `OPENROUTER_KEY_DEDICATED=true` |
| Costo Railway por servicio | Acceso al workspace para `railway usage` (panel o CLI); no integrado | — |
| Supabase cómputo | Ninguno: el dueño declara el tamaño (Project Settings → Compute and Disk) | `SUPABASE_COMPUTE_SIZE` |
| Supabase uso/facturas | Rol **Developer** en la organización (Read-only sólo existe en Team) | — |

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
| `SUPABASE_COMPUTE_SIZE` | — | Tamaño de cómputo del proyecto Radar (`micro`, `small`…), para estimar su cómputo |

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

Tabla `ai_usage_events` (migración `20261024_ai_usage_events.sql`, más
`20261025_ai_usage_coverage.sql` con `http_attempts` y `key_id`): proveedor,
modelo, operación, fecha, tokens, estado, intento, intentos HTTP, huella de
clave, costo informado/estimado y tipo de error. No guarda prompts,
respuestas ni claves. Sin la segunda migración el worker sigue registrando
(omite esas columnas) y el reporte lo indica. Embeddings: entrada =
`prompt_tokens` (o `total_tokens`), salida = 0.

Vista previa: `npm run cost-report:preview [-- parcial | sin-datos]`.
