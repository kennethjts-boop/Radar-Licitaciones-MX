# Scheduler Audit + Radar Morelos General Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify 30-min cron is functional and add a new `morelos_general` radar that captures any Morelos-state licitación via keyword matching.

**Architecture:** The scheduler is confirmed correct — no code changes needed. The new radar uses `includeTerms` on `canonical_text` (the only field that contains geographic text in the current normalizer design, since `state` stores "NACIONAL/INTERNACIONAL" not the geographic entity). Alert prefix achieved via `name` field in the radar config.

**Tech Stack:** TypeScript, `node-cron`, `node-telegram-bot-api`, `RadarConfig` type.

---

## Audit Findings — Scheduler (no changes required)

- `scheduler.ts` line 34: `*/30 * * * *` with `{ timezone: "America/Mexico_City" }` ✅
- Calls `runCollectJob()` which runs the full pipeline: Playwright scan → upsert → `evaluateAllRadars` → `enrichMatch` → `createAlert` → `sendMatchAlert` ✅
- Error is caught and logged — worker keeps running on job failure ✅
- `setTimeout(runCollectJob, 10_000)` fires an immediate first cycle 10 s after start ✅
- **No fix needed.**

## Important design note — `state` field in ComprasMX

`apiRegistroToRawInput` maps `item.caracter` → `state`, which is "NACIONAL" or "INTERNACIONAL" (scope), not the geographic entity. `entidad_federativa_contratacion` is NOT in the listing API response. `canonical_text` is built from title + description + dependencyName + buyingUnit only — it does NOT include the state field. Therefore the only way to detect Morelos-specific procurements in existing and future records is via keyword matching on `canonical_text`.

---

## File Structure

| Action | Path |
|--------|------|
| Create | `apps/worker/src/radars/morelos-general.radar.ts` |
| Modify | `apps/worker/src/radars/index.ts` (import + add to RADARS array) |

---

### Task 1: Create morelos-general.radar.ts

**Files:**
- Create: `apps/worker/src/radars/morelos-general.radar.ts`

- [ ] **Step 1: Create the radar file**

```typescript
/**
 * RADAR: morelos_general
 * Captura CUALQUIER licitación donde el texto del expediente mencione
 * Morelos o municipios del estado. Diseñado como net amplio geográfico
 * sin filtro por institución ni tipo de procedimiento.
 *
 * Nota técnica: canonical_text no incluye el campo state (que almacena
 * "NACIONAL/INTERNACIONAL"), por lo que se usa keyword matching sobre
 * el texto de título, descripción y dependencia.
 */
import type { RadarConfig } from "../types/procurement";

export const morelosGeneralRadar: RadarConfig = {
  key: "morelos_general",
  name: "🏔️ MORELOS — Radar General",
  description:
    "Captura cualquier licitación relacionada con el estado de Morelos: " +
    "detecta por nombre del estado y municipios en título, descripción o dependencia.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 0.4,

  includeTerms: [
    // El estado
    "morelos",
    "estado de morelos",
    // Municipios con mayor actividad licitatoria
    "cuernavaca",
    "cuautla",
    "jiutepec",
    "temixco",
    "jojutla",
    "zacatepec",
    "yautepec",
    "puente de ixtla",
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

  rules: [],
};
```

- [ ] **Step 2: Verify score math**

  With 9 `includeTerms`: denominator = `max(9 * 0.1, 1) = 1.0`, so a single matching term gives `termRatio = 1/1 = 1.0` → `score = 1.0 * 0.5 = 0.5` → `totalWeight = 0.5` → `finalScore = 1.0`. Any procurement that mentions "morelos" or a listed city scores **1.0**, which is above `minScore: 0.4`. A procurement with none of these terms scores 0.0 and is excluded. No rules means no `totalWeight` contribution from rules — only term weight of 0.5.

---

### Task 2: Register radar in index.ts

**Files:**
- Modify: `apps/worker/src/radars/index.ts`

- [ ] **Step 1: Add import**

  In `apps/worker/src/radars/index.ts`, add after line 15 (`import { habitatMorelosRadar }`):

  ```typescript
  import { morelosGeneralRadar } from "./morelos-general.radar";
  ```

- [ ] **Step 2: Add to RADARS array**

  In the `RADARS` array, append `morelosGeneralRadar` as the last entry:

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
    morelosGeneralRadar,  // ← nuevo
  ];
  ```

---

### Task 3: Typecheck + Build + Commit + Push

- [ ] **Step 1: Typecheck**

  ```bash
  cd apps/worker && npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 2: Build**

  ```bash
  npm run build
  ```
  Expected: exits 0.

- [ ] **Step 3: Commit and push**

  ```bash
  git add apps/worker/src/radars/morelos-general.radar.ts \
          apps/worker/src/radars/index.ts
  git commit -m "feat: radar morelos_general — captura cualquier licitación del estado de Morelos"
  git push origin main
  ```

---

## Self-Review

1. **Spec coverage:**
   - ✅ Sin filtro de keywords — `includeTerms` lists geographic terms only (not institution-specific)
   - ✅ Filtro geográfico — "morelos" + 8 municipios
   - ✅ Prioridad alta — `priority: 1`
   - ✅ Alerta con prefijo 🏔️ MORELOS — `name: "🏔️ MORELOS — Radar General"` appears in `formatMatchAlert` line 239
   - ✅ Registrado en radars/index.ts

2. **Placeholder scan:** No placeholders present.

3. **Type consistency:** `morelosGeneralRadar` exports `RadarConfig` — matches import in index.ts. All fields present per `RadarConfig` interface.
