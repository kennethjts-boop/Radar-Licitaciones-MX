# Alert Fixes & Morelos Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 10-alert cap, filter expired licitaciones by opening date, and create the morelos_general radar to catch backfilled Morelos records.

**Architecture:** Three orthogonal changes: (1) remove hardcoded alert cap in collect.job.ts; (2) add date expiry filter in time.ts + collect.job.ts; (3) fix navigator state field, create morelos_general radar, fix createAlert to store procurement UUID, and add one-time dedup pass in runRecheckJob for unchanged Morelos records.

**Tech Stack:** TypeScript, Supabase, node-telegram-bot-api, date-fns / date-fns-tz

---

## File Map

| File | Change |
|---|---|
| `apps/worker/src/jobs/collect.job.ts` | Remove cap constant + overflow blocks; add date filter; pass procurement UUID to createAlert; dedup pass in runRecheckJob |
| `apps/worker/src/core/time.ts` | Add `isDateExpired()` helper |
| `apps/worker/src/collectors/comprasmx/comprasmx.navigator.ts` | Extract `entidad_federativa_contratacion` → state |
| `apps/worker/src/radars/morelos-general.radar.ts` | New radar file |
| `apps/worker/src/radars/index.ts` | Import + register morelos_general |
| `apps/worker/src/storage/match-alert.repo.ts` | Accept `dbProcurementId` param; store in alerts; add `hasExistingAlert()` |

---

## Task 1: Remove MAX_ALERTS_PER_CYCLE cap (Problema 1)

**Files:**
- Modify: `apps/worker/src/jobs/collect.job.ts:54` (constant)
- Modify: `apps/worker/src/jobs/collect.job.ts:656-667` (overflow block in runCollectJob)
- Modify: `apps/worker/src/jobs/collect.job.ts:864-874` (overflow block in runRecheckJob)

- [ ] **Step 1: Remove the constant and cap variables**

In `collect.job.ts`, delete line 54 (`const MAX_ALERTS_PER_CYCLE = 10;`) and remove the two tracking variables (`alertsSentThisCycle`, `alertsOverflowNotified`) from both `runCollectJob` and `runRecheckJob`.

Before (runCollectJob, ~line 552):
```typescript
let alertsSentThisCycle = 0;
let alertsOverflowNotified = false;
```
After: delete both lines.

Same in runRecheckJob (~line 801):
```typescript
let alertsSentThisCycle = 0;
let alertsOverflowNotified = false;
```
After: delete both lines.

- [ ] **Step 2: Remove the overflow check block in runCollectJob**

Replace this block (~line 655):
```typescript
// ── Anti-spam: máximo MAX_ALERTS_PER_CYCLE alertas por ciclo ──
if (alertsSentThisCycle >= MAX_ALERTS_PER_CYCLE) {
  if (!alertsOverflowNotified) {
    alertsOverflowNotified = true;
    const overflowMsg =
      `⚠️ Límite de alertas alcanzado: se detectaron más matches que no se enviaron. ` +
      `Revisa Supabase para ver todos.`;
    await sendTelegramMessage(overflowMsg, "HTML").catch(() => {});
    log.warn({ alertsSentThisCycle, MAX_ALERTS_PER_CYCLE }, "Límite de alertas por ciclo alcanzado");
  }
  await markAlertFailed(alertId);
  continue;
}

const msgId = await sendMatchAlert(enriched);

if (msgId) {
  alertsSentThisCycle++;
  await markAlertSent(alertId, msgId);
} else {
  await markAlertFailed(alertId);
}
```

With:
```typescript
const msgId = await sendMatchAlert(enriched);

if (msgId) {
  await markAlertSent(alertId, msgId);
} else {
  await markAlertFailed(alertId);
}
```

- [ ] **Step 3: Remove the overflow check block in runRecheckJob**

Replace equivalent block in runRecheckJob (~line 864):
```typescript
if (alertsSentThisCycle >= MAX_ALERTS_PER_CYCLE) {
  if (!alertsOverflowNotified) {
    alertsOverflowNotified = true;
    const overflowMsg =
      `⚠️ Límite de alertas alcanzado: se detectaron más matches que no se enviaron. ` +
      `Revisa Supabase para ver todos.`;
    await sendTelegramMessage(overflowMsg, "HTML").catch(() => {});
  }
  await markAlertFailed(alertId);
  continue;
}

const msgId = await sendMatchAlert(enriched);
if (msgId) {
  alertsSentThisCycle++;
  await markAlertSent(alertId, msgId);
} else {
  await markAlertFailed(alertId);
}
```

With:
```typescript
const msgId = await sendMatchAlert(enriched);
if (msgId) {
  await markAlertSent(alertId, msgId);
} else {
  await markAlertFailed(alertId);
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npx tsc --noEmit
```
Expected: zero errors.

---

## Task 2: Add date expiry filter (Problema 2)

**Files:**
- Modify: `apps/worker/src/core/time.ts` (add helper)
- Modify: `apps/worker/src/jobs/collect.job.ts` (apply filter before evaluateAllRadars in both modes)

- [ ] **Step 1: Add `isDateExpired` to time.ts**

Append to `apps/worker/src/core/time.ts` after the `hasElapsedMinutes` function:

```typescript
/**
 * Retorna true si la fecha dada ya pasó (< hoy en México).
 * Acepta ISO-8601 (2026-04-15T10:00:00) o formato DD/MM/YYYY.
 * Retorna false si la fecha es nula, vacía o no se puede parsear
 * (conservador: si no sabemos la fecha, dejamos pasar).
 */
export function isDateExpired(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;

  let parsed: Date | null = null;

  // Intento 1: ISO-8601
  const isoParsed = parseISO(dateStr);
  if (isValid(isoParsed)) {
    parsed = isoParsed;
  }

  // Intento 2: DD/MM/YYYY o DD/MM/YYYY HH:MM:SS
  if (!parsed) {
    const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      const attempt = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
      if (isValid(attempt)) parsed = attempt;
    }
  }

  if (!parsed) return false; // no se pudo parsear → no filtrar

  const todayStr = formatInTimeZone(new Date(), MX_TIMEZONE, "yyyy-MM-dd");
  const todayStart = parseISO(todayStr);
  return parsed < todayStart;
}
```

Note: `formatInTimeZone` is already imported at the top of `time.ts`.

- [ ] **Step 2: Apply filter in runCollectJob before evaluateAllRadars**

In `collect.job.ts`, add this import at the top with other time imports:
```typescript
import { nowISO, formatDuration, isDateExpired } from "../core/time";
```

Then, in `runCollectJob`, after the upsert block and before the `evaluateAllRadars` call (~line 602), add:

```typescript
// Filtrar licitaciones vencidas: no generar alertas si ya pasó la fecha de apertura
if (isDateExpired(item.openingDate)) {
  log.debug(
    { externalId: item.externalId, openingDate: item.openingDate },
    "Licitación con fecha de apertura vencida, omitiendo match",
  );
  continue;
}
```

This goes **after** the `processAttachmentsForProcurement` call block and **before** `const matches = evaluateAllRadars(...)`.

- [ ] **Step 3: Apply same filter in runRecheckJob**

In `runRecheckJob`, after the upsert + status check and **before** `evaluateAllRadars`, add:

```typescript
// Filtrar licitaciones vencidas
if (isDateExpired(item.openingDate)) {
  log.debug(
    { externalId: item.externalId, openingDate: item.openingDate },
    "Licitación vencida omitida en recheck",
  );
  continue;
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npx tsc --noEmit
```
Expected: zero errors.

---

## Task 3: Fix navigator state field (Problema 3a)

**Files:**
- Modify: `apps/worker/src/collectors/comprasmx/comprasmx.navigator.ts`

The API response contains `entidad_federativa_contratacion` (captured in the generic `[key: string]: unknown`). This field has the real state (e.g., "Morelos"), while `caracter` only says "NACIONAL"/"INTERNACIONAL".

- [ ] **Step 1: Update `apiRegistroToRawInput` to use real state**

In `comprasmx.navigator.ts`, replace the `state` line in `apiRegistroToRawInput`:

```typescript
// Before:
state: item.caracter ?? null,                    // NACIONAL / INTERNACIONAL
```

With:
```typescript
// Prefer entidad_federativa_contratacion (real state) over caracter (NACIONAL/INTERNACIONAL)
state: (item.entidad_federativa_contratacion as string | null | undefined)
  ?? (item.entidad_federativa as string | null | undefined)
  ?? item.caracter
  ?? null,
```

Also update the comment in `rawJson`:
```typescript
rawJson: item as Record<string, unknown>,
```
(no change needed there — `rawJson` already captures everything)

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npx tsc --noEmit
```
Expected: zero errors.

---

## Task 4: Create morelos_general radar (Problema 3b)

**Files:**
- Create: `apps/worker/src/radars/morelos-general.radar.ts`
- Modify: `apps/worker/src/radars/index.ts`

The radar must match on the `state` field = "Morelos" OR geographic terms in canonical text. Both rules marked as `any_of` so that either path triggers. Priority 2 (second tier, after IMSS-Morelos which is priority 1).

- [ ] **Step 1: Create the radar file**

Create `apps/worker/src/radars/morelos-general.radar.ts`:

```typescript
/**
 * RADAR: morelos_general
 * Captura CUALQUIER licitación cuyo estado de contratación sea Morelos.
 * Filtro geográfico amplio — cubre entidades públicas estatales y municipales.
 */
import type { RadarConfig } from "../types/procurement";

export const morelosGeneralRadar: RadarConfig = {
  key: "morelos_general",
  name: "Morelos — General (todas las dependencias)",
  description:
    "Captura licitaciones de cualquier dependencia radicada en Morelos o cuyo ámbito " +
    "geográfico de contratación sea el estado de Morelos. " +
    "Filtro de primera red para el pipeline geográfico.",
  isActive: true,
  priority: 2,
  scheduleMinutes: 30,
  minScore: 0.3,

  includeTerms: [
    "morelos",
    "cuernavaca",
    "cuautla",
    "jiutepec",
    "temixco",
    "jojutla",
    "zacatepec",
    "yautepec",
    "puente de ixtla",
    "emiliano zapata",
    "xochitepec",
    "ayala",
    "tlaltizapan",
    "tlaltizapán",
    "jantetelco",
    "jonacatepec",
    "ocuituco",
    "temoac",
    "tlaquiltenango",
    "tepalcingo",
    "coatlán del río",
    "coatlan del rio",
  ],

  excludeTerms: [],

  geoTerms: [
    "morelos",
    "cuernavaca",
    "cuautla",
    "jiutepec",
    "temixco",
    "jojutla",
    "zacatepec",
    "yautepec",
    "puente de ixtla",
  ],

  entityTerms: [],

  rules: [
    {
      // Regla 1: estado de contratación = Morelos (campo state del API)
      ruleType: "geo",
      fieldName: "state",
      operator: "contains",
      value: "morelos",
      weight: 0.6,
      isRequired: false,
    },
    {
      // Regla 2: texto canónico menciona Morelos o municipios
      ruleType: "geo",
      fieldName: "canonical_text",
      operator: "any_of",
      value: [
        "morelos",
        "cuernavaca",
        "cuautla",
        "jiutepec",
        "temixco",
        "jojutla",
        "zacatepec",
        "yautepec",
        "puente de ixtla",
        "emiliano zapata",
        "xochitepec",
        "ayala",
      ],
      weight: 0.4,
      isRequired: false,
    },
  ],
};
```

Note: Both rules have `isRequired: false`. The radar fires if EITHER rule passes (because `includeTerms` already requires at least one term from the list to match — see matcher logic). With `minScore: 0.3`, a record matching any geographic term will exceed the threshold.

- [ ] **Step 2: Register the radar in index.ts**

In `apps/worker/src/radars/index.ts`:

Add import at top with other imports:
```typescript
import { morelosGeneralRadar } from "./morelos-general.radar";
```

Add to `RADARS` array (after the existing Morelos-specific radars, before acciones):
```typescript
export const RADARS: RadarConfig[] = [
  capufeEmergenciaRadar,
  capufeMantenimientoEquiposRadar,
  capufePeajeRadar,
  capufeOportunidadesRadar,
  isssteoOficinasCentralesRadar,
  conaviFederalRadar,
  imssMorelosRadar,
  imssBienestarMorelosRadar,
  habitatMorelosRadar,
  morelosGeneralRadar,       // ← add here
  // Inversión y Oportunidades Especiales
  accionesRadar,
  apuestasRadar,
  petroleoRadar,
  // Fondos internacionales para donatarias autorizadas
  fondosSaludRadar,
  fondosDeporteRadar,
  fondosCulturaRadar,
];
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npx tsc --noEmit
```
Expected: zero errors.

---

## Task 5: Fix dedup and Mode 2 backfill catch-up (Problema 3c)

**Files:**
- Modify: `apps/worker/src/storage/match-alert.repo.ts`
- Modify: `apps/worker/src/jobs/collect.job.ts`

The 86 Morelos records have never had alerts sent (they were backfilled directly in Supabase). Mode 2 skips unchanged records due to the fingerprint gate. The fix: store `procurement_id` (DB UUID) in alert records, and in `runRecheckJob`, run a secondary evaluation pass for unchanged records that have no existing sent alert.

- [ ] **Step 1: Fix `createAlert` to store procurement UUID**

In `apps/worker/src/storage/match-alert.repo.ts`, update `createAlert` signature and body:

```typescript
export async function createAlert(
  enrichedAlert: EnrichedAlert,
  dbProcurementId?: string,
): Promise<string> {
  const db = getSupabaseClient();
  const id = uuidv4();
  const now = nowISO();

  const record: DbAlert = {
    id,
    radar_id: null,
    procurement_id: dbProcurementId ?? null,    // ← store UUID when available
    alert_type: enrichedAlert.alertType,
    telegram_message: enrichedAlert.telegramMessage,
    telegram_status: "pending",
    telegram_message_id: null,
    sent_at: null,
    created_at: now,
  };

  const { error } = await db.from("alerts").insert(record);
  if (error) {
    throw new StorageError(
      `Error creando alerta: ${error.message}`,
      "create_alert",
    );
  }

  return id;
}
```

- [ ] **Step 2: Add `hasExistingAlert` helper to match-alert.repo.ts**

Append to `match-alert.repo.ts`:

```typescript
/**
 * Retorna true si ya existe una alerta enviada (telegram_status = 'sent')
 * para este procurement (por UUID de DB).
 */
export async function hasExistingAlert(dbProcurementId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("alerts")
    .select("id")
    .eq("procurement_id", dbProcurementId)
    .eq("telegram_status", "sent")
    .limit(1);

  if (error) return false; // en caso de error, asumir que no existe (seguro para no suprimir)
  return (data ?? []).length > 0;
}
```

- [ ] **Step 3: Update imports in collect.job.ts**

In `collect.job.ts`, add `hasExistingAlert` to the import from match-alert.repo:

```typescript
import {
  createAlert,
  markAlertSent,
  markAlertFailed,
  hasExistingAlert,
} from "../storage/match-alert.repo";
```

- [ ] **Step 4: Pass `dbProcurementId` to `createAlert` in runCollectJob**

In `runCollectJob`, find the `createAlert(enriched)` call (~line 653) and update:

```typescript
const alertId = await createAlert(enriched, upsertResult.procurementId);
```

- [ ] **Step 5: Update runRecheckJob to handle unchanged records with dedup**

In `runRecheckJob`, replace the gate:

```typescript
if (!upsertResult.isNew && !upsertResult.isUpdated) continue;
```

With:

```typescript
const isPristine = !upsertResult.isNew && !upsertResult.isUpdated;

// Para registros sin cambios, solo evaluar si no hay alerta enviada previa
// Esto cubre el caso de records backfilleados en Supabase (ej: Morelos)
if (isPristine) {
  const alreadyAlerted = await hasExistingAlert(upsertResult.procurementId);
  if (alreadyAlerted) continue;
}
```

- [ ] **Step 6: Pass `dbProcurementId` to `createAlert` in runRecheckJob**

In `runRecheckJob`, update the `createAlert(enriched)` call:

```typescript
const alertId = await createAlert(enriched, upsertResult.procurementId);
```

- [ ] **Step 7: TypeScript check**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npx tsc --noEmit
```
Expected: zero errors.

---

## Task 6: Build, commit, and push

- [ ] **Step 1: Full build**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npm run build
```
Expected: `dist/index.js` created, zero errors.

- [ ] **Step 2: Commit**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX
git add apps/worker/src/jobs/collect.job.ts \
        apps/worker/src/core/time.ts \
        apps/worker/src/collectors/comprasmx/comprasmx.navigator.ts \
        apps/worker/src/radars/morelos-general.radar.ts \
        apps/worker/src/radars/index.ts \
        apps/worker/src/storage/match-alert.repo.ts
git commit -m "$(cat <<'EOF'
fix: eliminar cap de alertas, filtrar vencidas, crear radar morelos_general

- Elimina MAX_ALERTS_PER_CYCLE=10 (hardcoded); todas las licitaciones que
  hagan match ahora llegan a Telegram sin límite artificial
- Agrega isDateExpired() y filtro pre-match: licitaciones con
  openingDate < hoy (México) no generan alertas
- Extrae entidad_federativa_contratacion del API response para mapear
  correctamente el campo state (antes solo venía NACIONAL/INTERNACIONAL)
- Crea radar morelos_general (priority 2, isActive=true) con filtro
  geográfico por estado y texto canónico
- Fix createAlert: almacena procurement_id (UUID) en alerts table
- runRecheckJob: registros sin cambios que nunca han generado alerta
  ahora se evalúan contra radares (cubre los 86 records del backfill)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX
git push origin main
```

---

## Self-Review

### Spec Coverage

| Problema | Task | Status |
|---|---|---|
| Límite de 10 alertas hardcodeado | Task 1 | ✅ |
| Alertas de licitaciones vencidas | Task 2 | ✅ |
| morelos_general radar existe | Task 4 | ✅ |
| Navigator usa estado real | Task 3 | ✅ |
| Mode 2 procesa 86 records backfill | Task 5 | ✅ |
| Nada bloquea las 86 alertas | Task 1 + Task 5 | ✅ |

### Placeholder Scan
- All code blocks are complete and compilable.
- No "TBD" or "TODO" markers.

### Type Consistency
- `isDateExpired` added to `time.ts` and imported correctly.
- `createAlert(enrichedAlert, dbProcurementId?)` — optional param, backward compatible. No other callers need to change (but the two main callers in collect.job.ts are updated in Task 5).
- `hasExistingAlert` returns `Promise<boolean>`, used with `await` in `runRecheckJob`.
- `morelosGeneralRadar` exported as named const, imported and added to RADARS array.
- Both `runCollectJob` overflow blocks removed completely — no lingering references to deleted variables.
