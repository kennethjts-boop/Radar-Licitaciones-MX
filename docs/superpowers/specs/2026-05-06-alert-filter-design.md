# Spec: Alert Eligibility Filter — Radar Licitaciones MX

**Fecha:** 2026-05-06  
**Rama:** `feature/filter-active-new-tenders`  
**Autor:** brainstorming session

---

## Problema

El radar recolecta ~250 licitaciones por ciclo de recheck diario (Modo 2). Muchas son de meses anteriores, ya adjudicadas, canceladas o vencidas. Esto genera ruido masivo en Telegram. El usuario recibe 250 mensajes donde solo ~20 son accionables.

## Objetivo

Agregar una capa de filtrado (`alert-filter`) que decida si una licitación debe enviarse por Telegram. El scraper sigue recolectando todo; Telegram solo recibe lo útil.

---

## Decisiones de diseño

| Pregunta | Decisión |
|---|---|
| ¿Quién envía alertas? | Solo Modo 1 (colección incremental en tiempo real) |
| ¿Qué hace Modo 2? | Solo cuenta y registra métricas; nunca llama `sendMatchAlert()` |
| ¿Cómo detectar "nueva"? | `isNew=true` en el ciclo actual (Modo 1) |
| ¿Cómo alertar activas ya en DB? | Solo si `isTenderStillActionable=true` (fechas futuras + estado activo) |
| ¿Cómo tratar desiertas? | Alerta si `publicationDate`/`created_at` dentro de `ALERT_DESIERTA_LOOKBACK_DAYS` |
| ¿Categorías de elegibilidad? | Solo `ALERTABLE` / `NOT_ALERTABLE` (sin intermedios) |
| ¿Resumen diario? | Reconstruido con secciones activas; Modo 2 alimenta métricas |

---

## Arquitectura

### Módulo nuevo: `src/modules/alert-filter/`

```
types.ts            — NormalizedTenderStatus, AlertEligibility, AlertClassification
status-normalizer.ts — normalizeTenderStatus(rawStatus) → NormalizedTenderStatus
date-utils.ts       — extractTenderDates(), isTenderStillActionable()
eligibility.ts      — classifyAlert() — función central
summary-filter.ts   — buildSummaryData() — secciones del resumen diario
sample-data.ts      — fixture 250 licitaciones simuladas
sample-runner.ts    — script npm run alert-filter:sample
index.ts            — re-exporta API pública
```

### Archivos modificados (cambios quirúrgicos)

| Archivo | Cambio |
|---|---|
| `jobs/collect.job.ts` | Insertar `classifyAlert()` antes de `sendMatchAlert()` en Modo 1; eliminar `sendMatchAlert()` de Modo 2 |
| `jobs/daily-summary.job.ts` | Reemplazar lógica con `buildSummaryData()` |
| `alerts/telegram.alerts.ts` | Nuevo `formatDailySummaryMessage()` con secciones |
| `config/env.ts` | Añadir 7 variables al schema Zod |
| `.env.example` | Documentar variables con defaults |
| `package.json` | Añadir script `alert-filter:sample` |

### Archivos NO tocados

- `financial-ceiling-radar` (cualquier módulo relacionado)
- `normalizers/`, `matchers/`, `storage/`, `types/procurement.ts`
- Collectors

---

## Tipos centrales

```typescript
export type NormalizedTenderStatus =
  | 'ACTIVE'
  | 'DESIERTA'
  | 'CLOSED'
  | 'AWARDED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN';

export type AlertEligibility = 'ALERTABLE' | 'NOT_ALERTABLE';

export type AlertExclusionReason =
  | 'new_but_closed'
  | 'new_but_awarded'
  | 'new_but_cancelled'
  | 'new_but_expired'
  | 'old_no_future_dates'
  | 'old_closed_status'
  | 'desierta_too_old'
  | 'unknown_status_old';

export type AlertInclusionReason =
  | 'new_active'
  | 'new_desierta'
  | 'active_with_future_dates'
  | 'recent_desierta';

export interface AlertClassification {
  decision: AlertEligibility;
  reason: AlertInclusionReason | AlertExclusionReason;
  normalizedStatus: NormalizedTenderStatus;
  hasActionableDates: boolean;
}
```

---

## `normalizeTenderStatus`

Mapea `item.status` (string libre, puede tener acentos, mayúsculas, variantes) a `NormalizedTenderStatus`.

```
ACTIVE   → publicada, vigente, activa, abierta, en_proceso, en curso, convocatoria,
           recepción de proposiciones, junta de aclaraciones, fallo pendiente
DESIERTA → desierta, declarada desierta, sin adjudicación, procedimiento desierto
CLOSED   → cerrada, concluida, terminada, finalizada
AWARDED  → adjudicada, contrato adjudicado, fallo adjudicado
CANCELLED → cancelada, suspendida, anulada
EXPIRED  → vencida, fecha límite vencida, presentación vencida
UNKNOWN  → cualquier otra cosa
```

Normalización: `toLowerCase()` + eliminar acentos antes de comparar.

---

## `extractTenderDates`

Lee `item` (NormalizedProcurement) y extrae:

```typescript
interface TenderDates {
  publicationDate: Date | null;   // item.publicationDate
  openingDate: Date | null;       // item.openingDate
  rulingDate: Date | null;        // item.rawJson.fecha_fallo
  clarificationDate: Date | null; // item.rawJson.fecha_aclaraciones
  firstSeenAt: Date | null;       // item.fetchedAt (proxy de created_at en Modo 1)
}
```

---

## `isTenderStillActionable`

```typescript
function isTenderStillActionable(dates: TenderDates, now: Date): boolean
```

Retorna `true` si al menos una de estas fechas es futura:
- `openingDate`
- `rulingDate`
- `clarificationDate`

Si todas son `null` y el status es `ACTIVE` → retorna `true` (beneficio de la duda).  
Si todas son pasadas y el status es `CLOSED/AWARDED/CANCELLED/EXPIRED` → retorna `false`.

---

## `classifyAlert` — árbol de decisión

```
Input: item (NormalizedProcurement), match (MatchResult), upsertResult (UpsertProcurementResult)

1. normalizedStatus = normalizeTenderStatus(item.status)
2. dates = extractTenderDates(item)
3. now = new Date()

CASO A — isNew=true en este ciclo:
  si CLOSED/AWARDED/CANCELLED/EXPIRED → NOT_ALERTABLE (razón: new_but_<status>)
  si DESIERTA:
    publicationAge = now - (dates.publicationDate ?? dates.firstSeenAt ?? now)
    si publicationAge <= ALERT_DESIERTA_LOOKBACK_DAYS → ALERTABLE (new_desierta)
    si no → NOT_ALERTABLE (desierta_too_old)
  si ACTIVE o UNKNOWN:
    → ALERTABLE (new_active)

CASO B — isNew=false (ya estaba en DB):
  si CLOSED/AWARDED/CANCELLED/EXPIRED → NOT_ALERTABLE (old_closed_status)
  si DESIERTA:
    firstSeenAge = now - dates.firstSeenAt
    si firstSeenAge <= ALERT_DESIERTA_LOOKBACK_DAYS → ALERTABLE (recent_desierta)
    si no → NOT_ALERTABLE (desierta_too_old)
  si ACTIVE:
    si isTenderStillActionable(dates, now) → ALERTABLE (active_with_future_dates)
    si no → NOT_ALERTABLE (old_no_future_dates)
  si UNKNOWN → NOT_ALERTABLE (unknown_status_old)
```

---

## Integración en `collect.job.ts`

### Modo 1 — antes de alertar (cambio ~6 líneas):

```typescript
// Antes de: const enriched = await enrichMatch(...)
const classification = classifyAlert(item, match, upsertResult);

if (classification.decision === 'NOT_ALERTABLE') {
  log.debug(
    { externalId: item.externalId, reason: classification.reason, status: item.status },
    '[alert-filter] excluded'
  );
  cycleMetrics.excluded++;
  // upsertMatch() ya ocurrió — los datos quedan en DB para métricas
  continue;
}

log.debug(
  { externalId: item.externalId, reason: classification.reason },
  '[alert-filter] alertable'
);
cycleMetrics.alertable++;
// ... resto del flujo existente (enrichMatch, createAlert, sendMatchAlert)
```

### Modo 2 (`runRecheckJob`) — eliminar envío:

Reemplazar el bloque que llama `sendMatchAlert` por solo `upsertMatch`. No se llama `createAlert` ni `sendMatchAlert`. Solo se acumulan conteos para métricas.

---

## Variables de entorno

```env
# Alert Filter
ALERT_NEW_LOOKBACK_HOURS=48
ALERT_ACTIVE_MAX_AGE_DAYS=21
ALERT_DESIERTA_LOOKBACK_DAYS=10
ALERT_INCLUDE_HISTORICAL=false
ALERT_MAX_PER_CYCLE=25
DAILY_SUMMARY_MAX_ITEMS=40
DAILY_SUMMARY_EXCLUDE_OLD_CLOSED=true
```

Todas opcionales con defaults en el schema Zod. Si no están en `.env`, el sistema funciona con defaults.

---

## Resumen diario — nuevas secciones

`buildSummaryData()` consulta la DB en las últimas 24h y construye:

```typescript
interface SummaryData {
  newActive: ProcurementRow[];        // created_at < 24h + status ACTIVE
  recentDesierta: ProcurementRow[];   // status desierta + created_at dentro de ventana
  soonExpiring: ProcurementRow[];     // opening_date entre hoy y hoy+5 días
  highScore: ProcurementRow[];        // matches con match_score >= 0.7
  excludedCount: number;              // todo lo que no cayó en las categorías anteriores
}
```

Mensaje Telegram resultante:
```
📊 RESUMEN RADAR — YYYY-MM-DD

✅ Nuevas vigentes: N
🏜 Desiertas recientes: N
⏳ Próximas a vencer: N
🔥 Alto score: N
🗑 Excluidas viejas/cerradas: N

🏆 Top oportunidades:
1. [título corto] — [dependencia] — apertura DD/MM
...
```

Máximo `DAILY_SUMMARY_MAX_ITEMS` en el top. Excluidas: solo número, nunca listado.

---

## Fixture de prueba (`sample-data.ts`)

250 licitaciones simuladas:
- 80 de marzo cerradas (status: cerrada, publicationDate: 2026-03-01 a 2026-03-31)
- 40 adjudicadas
- 30 canceladas
- 20 históricas (firstSeenAt > 30 días)
- 25 duplicadas (mismo externalId)
- 35 activas recientes con fechas futuras
- 10 desiertas recientes (dentro de ventana)
- 10 con fechas futuras claras

**Resultado esperado del sample runner:**
```
found: 250
alertable: ~45
sent (capped): <= 25  (ALERT_MAX_PER_CYCLE)
excludedOld: > 0
excludedClosed: > 0
excludedHistorical: > 0
excludedDuplicates: > 0
```

Script: `npm run alert-filter:sample`

---

## Métricas del ciclo

Al final de cada ciclo en Modo 1, loguear:

```json
{
  "found": 250,
  "alertable": 18,
  "sent": 18,
  "excludedOld": 120,
  "excludedClosed": 58,
  "excludedHistorical": 41,
  "excludedDuplicates": 13
}
```

Se guarda en `STATE_KEYS.LAST_COLLECT_RUN` (ya existe el mecanismo).

---

## Límite duro por ciclo

```typescript
if (alertsSentThisCycle >= ALERT_MAX_PER_CYCLE) {
  // log warning, no enviar, marcar en métricas
  break; // o continue según posición en el loop
}
```

Prioridad de envío cuando se acerca al límite:
1. Desiertas recientes
2. Nuevas activas con fecha próxima
3. Alto score

La priorización ocurre al ordenar los matches antes del loop (por score descendente).

---

## Validaciones

```bash
npm run alert-filter:sample   # debe imprimir métricas correctas
npm run lint
npm run typecheck
npm test
npm run financial:sample      # debe seguir pasando intacto
```

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Licitación activa sin fechas en rawJson → `isTenderStillActionable` retorna `false` y se excluye | Si `dates.openingDate` es null y status es ACTIVE, retornar `true` por defecto |
| `normalizeTenderStatus` no reconoce variante nueva de status → UNKNOWN | Licitaciones UNKNOWN nuevas (`isNew=true`) se alertan; UNKNOWN viejas se excluyen |
| Modo 2 deja de enviar alertas individualmente → puede perderse una licitación que entró mientras Modo 1 no corría | Aceptado por diseño; Modo 1 corre cada 30 min, ventana de pérdida mínima |
| Test de `canonicalHash` heredado falla | Documentar pero no corregir en esta rama |

---

## No hacer merge automático

Esta rama se trabaja aislada. Al terminar: push + PR. Merge solo con autorización explícita.
