# Alert Eligibility Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una capa de filtrado `alert-filter` que evita enviar licitaciones viejas, cerradas o históricas a Telegram — solo pasan nuevas, activas con fechas futuras, y desiertas recientes.

**Architecture:** El módulo `src/modules/alert-filter/` expone `classifyAlert()`, una función pura que clasifica cada licitación como `ALERTABLE` o `NOT_ALERTABLE`. En Modo 1 (`collect.job.ts`), se llama antes de `sendMatchAlert`. El Modo 2 (`runRecheckJob`) se silencia completamente — solo hace `upsertMatch` para métricas. El resumen diario se reconstruye con secciones activas usando `buildSummaryData()`.

**Tech Stack:** TypeScript, date-fns, date-fns-tz, Jest, Zod, Supabase, pino

---

## File Map

| Acción | Archivo | Responsabilidad |
|---|---|---|
| Crear | `src/modules/alert-filter/types.ts` | Todos los tipos del módulo |
| Crear | `src/modules/alert-filter/status-normalizer.ts` | `normalizeTenderStatus()` |
| Crear | `src/modules/alert-filter/date-utils.ts` | `extractTenderDates()`, `isTenderStillActionable()`, `isWithinDays()` |
| Crear | `src/modules/alert-filter/eligibility.ts` | `classifyAlert()` — función central |
| Crear | `src/modules/alert-filter/summary-filter.ts` | `buildSummaryData()` para resumen diario |
| Crear | `src/modules/alert-filter/sample-data.ts` | Fixture de 250 licitaciones simuladas |
| Crear | `src/modules/alert-filter/sample-runner.ts` | Script `npm run alert-filter:sample` |
| Crear | `src/modules/alert-filter/index.ts` | Re-exporta API pública |
| Crear | `src/modules/alert-filter/__tests__/status-normalizer.test.ts` | Tests del normalizador |
| Crear | `src/modules/alert-filter/__tests__/date-utils.test.ts` | Tests de utilidades de fecha |
| Crear | `src/modules/alert-filter/__tests__/eligibility.test.ts` | Tests de `classifyAlert()` |
| Modificar | `src/config/env.ts` | +7 variables Zod |
| Modificar | `.env.example` | Documentar nuevas variables |
| Modificar | `src/jobs/collect.job.ts` | Insertar `classifyAlert()` en Modo 1; silenciar Modo 2 |
| Modificar | `src/jobs/daily-summary.job.ts` | Usar `buildSummaryData()` |
| Modificar | `src/alerts/telegram.alerts.ts` | Nuevo `formatEnhancedDailySummaryMessage()` |
| Modificar | `package.json` | Script `alert-filter:sample` |

---

## Task 1: Crear rama y estructura de directorios

**Files:**
- Create: `src/modules/alert-filter/` (directorio)

- [ ] **Step 1: Crear rama**

```bash
cd /path/to/Radar-Licitaciones-MX
git checkout -b feature/filter-active-new-tenders
```

Expected: `Switched to a new branch 'feature/filter-active-new-tenders'`

- [ ] **Step 2: Crear directorio del módulo**

```bash
mkdir -p apps/worker/src/modules/alert-filter/__tests__
```

- [ ] **Step 3: Commit inicial de rama**

```bash
git commit --allow-empty -m "chore: inicia rama feature/filter-active-new-tenders"
```

---

## Task 2: Tipos centrales del módulo

**Files:**
- Create: `src/modules/alert-filter/types.ts`

- [ ] **Step 1: Crear `types.ts`**

```typescript
// src/modules/alert-filter/types.ts

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

export type AlertReason = AlertInclusionReason | AlertExclusionReason;

export interface AlertClassification {
  decision: AlertEligibility;
  reason: AlertReason;
  normalizedStatus: NormalizedTenderStatus;
  hasActionableDates: boolean;
}

export interface TenderDates {
  publicationDate: Date | null;
  openingDate: Date | null;
  rulingDate: Date | null;
  clarificationDate: Date | null;
  firstSeenAt: Date | null;
}

export interface AlertFilterOptions {
  desertaLookbackDays: number;
  activeMaxAgeDays: number;
}

export interface CycleMetrics {
  found: number;
  alertable: number;
  sent: number;
  excluded: number;
  excludedClosed: number;
  excludedOld: number;
}

export interface SummarySection {
  title: string;
  externalId: string;
  dependencyName: string | null;
  openingDate: string | null;
  matchScore: number;
  sourceUrl: string;
  status: string;
}

export interface SummaryData {
  summaryDate: string;
  newActive: SummarySection[];
  recentDesierta: SummarySection[];
  soonExpiring: SummarySection[];
  highScore: SummarySection[];
  totalSeen: number;
  totalNew: number;
  totalAlerts: number;
  excludedCount: number;
  technicalIncidents: string[];
}
```

- [ ] **Step 2: Commit**

```bash
cd apps/worker
git add src/modules/alert-filter/types.ts
git commit -m "feat(alert-filter): tipos centrales del módulo"
```

---

## Task 3: Normalizador de estado (TDD)

**Files:**
- Create: `src/modules/alert-filter/status-normalizer.ts`
- Create: `src/modules/alert-filter/__tests__/status-normalizer.test.ts`

- [ ] **Step 1: Escribir el test**

```typescript
// src/modules/alert-filter/__tests__/status-normalizer.test.ts
import { normalizeTenderStatus } from '../status-normalizer';

describe('normalizeTenderStatus', () => {
  it('retorna ACTIVE para "publicada"', () => {
    expect(normalizeTenderStatus('publicada')).toBe('ACTIVE');
  });
  it('retorna ACTIVE para "VIGENTE" (mayúsculas)', () => {
    expect(normalizeTenderStatus('VIGENTE')).toBe('ACTIVE');
  });
  it('retorna ACTIVE para "en_proceso"', () => {
    expect(normalizeTenderStatus('en_proceso')).toBe('ACTIVE');
  });
  it('retorna DESIERTA para "desierta"', () => {
    expect(normalizeTenderStatus('desierta')).toBe('DESIERTA');
  });
  it('retorna DESIERTA para "Declarada Desierta" (mayúsculas + acentos)', () => {
    expect(normalizeTenderStatus('Declarada Desierta')).toBe('DESIERTA');
  });
  it('retorna AWARDED para "adjudicada"', () => {
    expect(normalizeTenderStatus('adjudicada')).toBe('AWARDED');
  });
  it('retorna CANCELLED para "cancelada"', () => {
    expect(normalizeTenderStatus('cancelada')).toBe('CANCELLED');
  });
  it('retorna CLOSED para "cerrada"', () => {
    expect(normalizeTenderStatus('cerrada')).toBe('CLOSED');
  });
  it('retorna CLOSED para "concluida"', () => {
    expect(normalizeTenderStatus('concluida')).toBe('CLOSED');
  });
  it('retorna EXPIRED para "vencida"', () => {
    expect(normalizeTenderStatus('vencida')).toBe('EXPIRED');
  });
  it('retorna UNKNOWN para string vacío', () => {
    expect(normalizeTenderStatus('')).toBe('UNKNOWN');
  });
  it('retorna UNKNOWN para null', () => {
    expect(normalizeTenderStatus(null)).toBe('UNKNOWN');
  });
  it('retorna UNKNOWN para undefined', () => {
    expect(normalizeTenderStatus(undefined)).toBe('UNKNOWN');
  });
  it('retorna UNKNOWN para string sin mapeo conocido', () => {
    expect(normalizeTenderStatus('estado_raro_xyz')).toBe('UNKNOWN');
  });
  it('DESIERTA tiene prioridad sobre CLOSED si el string contiene ambos', () => {
    expect(normalizeTenderStatus('procedimiento desierto cerrado')).toBe('DESIERTA');
  });
});
```

- [ ] **Step 2: Ejecutar — debe fallar**

```bash
cd apps/worker && npx jest src/modules/alert-filter/__tests__/status-normalizer.test.ts --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module '../status-normalizer'`

- [ ] **Step 3: Implementar `status-normalizer.ts`**

```typescript
// src/modules/alert-filter/status-normalizer.ts
import type { NormalizedTenderStatus } from './types';

/** Elimina acentos y convierte a minúsculas para comparar */
const n = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Orden de evaluación importa: DESIERTA antes que CLOSED/EXPIRED
const TERM_MAP: Array<[NormalizedTenderStatus, string[]]> = [
  ['DESIERTA', ['desierta', 'declarada desierta', 'sin adjudicacion', 'procedimiento desierto']],
  ['CANCELLED', ['cancelada', 'suspendida', 'anulada']],
  ['EXPIRED', ['vencida', 'fecha limite vencida', 'presentacion vencida', 'apertura vencida']],
  ['AWARDED', ['adjudicada', 'contrato adjudicado', 'fallo adjudicado', 'con ganador']],
  ['CLOSED', ['cerrada', 'concluida', 'terminada', 'finalizada']],
  [
    'ACTIVE',
    [
      'publicada', 'vigente', 'activa', 'abierta', 'en_proceso', 'en proceso',
      'convocatoria', 'recepcion de proposiciones', 'junta de aclaraciones',
      'fallo pendiente', 'apertura pendiente',
    ],
  ],
];

export function normalizeTenderStatus(
  rawStatus: string | null | undefined,
): NormalizedTenderStatus {
  if (!rawStatus) return 'UNKNOWN';
  const normalized = n(rawStatus);
  for (const [status, terms] of TERM_MAP) {
    if (terms.some((t) => normalized.includes(n(t)))) return status;
  }
  return 'UNKNOWN';
}
```

- [ ] **Step 4: Ejecutar — debe pasar**

```bash
cd apps/worker && npx jest src/modules/alert-filter/__tests__/status-normalizer.test.ts --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 15 passed`

- [ ] **Step 5: Commit**

```bash
git add src/modules/alert-filter/status-normalizer.ts src/modules/alert-filter/__tests__/status-normalizer.test.ts
git commit -m "feat(alert-filter): normalizeTenderStatus con tests"
```

---

## Task 4: Utilidades de fecha (TDD)

**Files:**
- Create: `src/modules/alert-filter/date-utils.ts`
- Create: `src/modules/alert-filter/__tests__/date-utils.test.ts`

- [ ] **Step 1: Escribir el test**

```typescript
// src/modules/alert-filter/__tests__/date-utils.test.ts
import { extractTenderDates, isTenderStillActionable, isWithinDays } from '../date-utils';
import type { NormalizedProcurement } from '../../../types/procurement';

function makeProcurement(overrides: Partial<NormalizedProcurement> = {}): NormalizedProcurement {
  return {
    source: 'comprasmx',
    sourceUrl: 'https://example.com',
    externalId: 'TEST-001',
    expedienteId: null,
    licitationNumber: null,
    procedureNumber: null,
    title: 'Test',
    description: null,
    dependencyName: null,
    buyingUnit: null,
    procedureType: 'licitacion_publica',
    status: 'activa',
    publicationDate: null,
    openingDate: null,
    awardDate: null,
    state: null,
    municipality: null,
    amount: null,
    currency: null,
    attachments: [],
    canonicalText: 'test',
    canonicalFingerprint: 'abc',
    lightweightFingerprint: null,
    canonicalHash: null,
    rawJson: {},
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('extractTenderDates', () => {
  it('extrae openingDate del campo directo', () => {
    const item = makeProcurement({ openingDate: '2026-06-01T10:00:00' });
    const dates = extractTenderDates(item);
    expect(dates.openingDate).not.toBeNull();
  });

  it('extrae rulingDate de rawJson.fecha_fallo', () => {
    const item = makeProcurement({ rawJson: { fecha_fallo: '2026-06-15T10:00:00' } });
    const dates = extractTenderDates(item);
    expect(dates.rulingDate).not.toBeNull();
  });

  it('extrae clarificationDate de rawJson.fecha_aclaraciones', () => {
    const item = makeProcurement({ rawJson: { fecha_aclaraciones: '2026-05-20T10:00:00' } });
    const dates = extractTenderDates(item);
    expect(dates.clarificationDate).not.toBeNull();
  });

  it('retorna null para campos ausentes', () => {
    const item = makeProcurement();
    const dates = extractTenderDates(item);
    expect(dates.publicationDate).toBeNull();
    expect(dates.openingDate).toBeNull();
    expect(dates.rulingDate).toBeNull();
    expect(dates.clarificationDate).toBeNull();
  });
});

describe('isTenderStillActionable', () => {
  const now = new Date('2026-05-06T12:00:00Z');

  it('retorna true si openingDate es futura', () => {
    const dates = {
      publicationDate: null,
      openingDate: new Date('2026-06-01T10:00:00Z'),
      rulingDate: null,
      clarificationDate: null,
      firstSeenAt: null,
    };
    expect(isTenderStillActionable(dates, now)).toBe(true);
  });

  it('retorna true si rulingDate es futura aunque openingDate pasó', () => {
    const dates = {
      publicationDate: null,
      openingDate: new Date('2026-04-01T10:00:00Z'), // pasada
      rulingDate: new Date('2026-06-01T10:00:00Z'),   // futura
      clarificationDate: null,
      firstSeenAt: null,
    };
    expect(isTenderStillActionable(dates, now)).toBe(true);
  });

  it('retorna false si todas las fechas ya pasaron', () => {
    const dates = {
      publicationDate: null,
      openingDate: new Date('2026-03-01T10:00:00Z'),
      rulingDate: new Date('2026-03-15T10:00:00Z'),
      clarificationDate: new Date('2026-02-20T10:00:00Z'),
      firstSeenAt: null,
    };
    expect(isTenderStillActionable(dates, now)).toBe(false);
  });

  it('retorna true si no hay ninguna fecha (beneficio de la duda)', () => {
    const dates = {
      publicationDate: null,
      openingDate: null,
      rulingDate: null,
      clarificationDate: null,
      firstSeenAt: null,
    };
    expect(isTenderStillActionable(dates, now)).toBe(true);
  });
});

describe('isWithinDays', () => {
  const now = new Date('2026-05-06T12:00:00Z');

  it('retorna true si la fecha está dentro de la ventana', () => {
    const date = new Date('2026-05-04T12:00:00Z'); // hace 2 días
    expect(isWithinDays(date, 10, now)).toBe(true);
  });

  it('retorna false si la fecha está fuera de la ventana', () => {
    const date = new Date('2026-04-01T12:00:00Z'); // hace 35 días
    expect(isWithinDays(date, 10, now)).toBe(false);
  });

  it('retorna false para null', () => {
    expect(isWithinDays(null, 10, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar — debe fallar**

```bash
cd apps/worker && npx jest src/modules/alert-filter/__tests__/date-utils.test.ts --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module '../date-utils'`

- [ ] **Step 3: Implementar `date-utils.ts`**

```typescript
// src/modules/alert-filter/date-utils.ts
import { parseISO, isValid } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import type { NormalizedProcurement } from '../../types/procurement';
import type { TenderDates } from './types';

const MX_TZ = 'America/Mexico_City';

/**
 * Parsea un string de fecha naive (sin timezone) como hora México → UTC Date.
 * Si ya tiene timezone explícito, lo parsea directo.
 */
function parseMexicoDate(raw: string | null | undefined): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)
      ? fromZonedTime(raw, MX_TZ)
      : parseISO(raw);
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

export function extractTenderDates(item: NormalizedProcurement): TenderDates {
  const raw = item.rawJson as Record<string, unknown>;
  return {
    publicationDate: parseMexicoDate(item.publicationDate),
    openingDate: parseMexicoDate(item.openingDate),
    rulingDate: parseMexicoDate(raw.fecha_fallo as string | null),
    clarificationDate: parseMexicoDate(raw.fecha_aclaraciones as string | null),
    firstSeenAt: parseMexicoDate(item.fetchedAt),
  };
}

/**
 * Retorna true si hay al menos una fecha de acción futura.
 * Si no hay ninguna fecha → true (beneficio de la duda para licitaciones sin cronograma).
 */
export function isTenderStillActionable(dates: TenderDates, now: Date): boolean {
  const actionableDates = [dates.openingDate, dates.rulingDate, dates.clarificationDate].filter(
    (d): d is Date => d !== null,
  );
  if (actionableDates.length === 0) return true;
  return actionableDates.some((d) => d > now);
}

/**
 * Retorna true si `date` está dentro de los últimos `days` días desde `now`.
 */
export function isWithinDays(date: Date | null, days: number, now: Date): boolean {
  if (!date) return false;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return date >= cutoff;
}
```

- [ ] **Step 4: Ejecutar — debe pasar**

```bash
cd apps/worker && npx jest src/modules/alert-filter/__tests__/date-utils.test.ts --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 10 passed`

- [ ] **Step 5: Commit**

```bash
git add src/modules/alert-filter/date-utils.ts src/modules/alert-filter/__tests__/date-utils.test.ts
git commit -m "feat(alert-filter): extractTenderDates e isTenderStillActionable con tests"
```

---

## Task 5: Función central `classifyAlert` (TDD)

**Files:**
- Create: `src/modules/alert-filter/eligibility.ts`
- Create: `src/modules/alert-filter/__tests__/eligibility.test.ts`

- [ ] **Step 1: Escribir el test**

```typescript
// src/modules/alert-filter/__tests__/eligibility.test.ts
import { classifyAlert } from '../eligibility';
import type { NormalizedProcurement } from '../../../types/procurement';
import type { UpsertProcurementResult } from '../../../storage/procurement.repo';
import type { AlertFilterOptions } from '../types';

const OPTIONS: AlertFilterOptions = { desertaLookbackDays: 10, activeMaxAgeDays: 21 };

const NOW = new Date('2026-05-06T12:00:00Z');
const FUTURE = '2026-06-01T10:00:00';
const PAST = '2026-03-01T10:00:00';
const RECENT = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(); // hace 3 días
const OLD = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(); // hace 40 días

function makeItem(
  status: string,
  openingDate: string | null = null,
  fetchedAt = RECENT,
  rawJson: Record<string, unknown> = {},
): NormalizedProcurement {
  return {
    source: 'comprasmx', sourceUrl: 'https://example.com', externalId: 'X-001',
    expedienteId: null, licitationNumber: null, procedureNumber: null,
    title: 'Test', description: null, dependencyName: null, buyingUnit: null,
    procedureType: 'licitacion_publica', status: status as any,
    publicationDate: null, openingDate, awardDate: null,
    state: null, municipality: null, amount: null, currency: null,
    attachments: [], canonicalText: 'test', canonicalFingerprint: 'abc',
    lightweightFingerprint: null, canonicalHash: null, rawJson, fetchedAt,
  };
}

function makeUpsert(isNew: boolean): UpsertProcurementResult {
  return { isNew, isUpdated: !isNew, procurementId: 'uuid-1', changedFields: {}, versionNumber: 1 };
}

describe('classifyAlert — CASO A: isNew=true', () => {
  it('ALERTABLE para nueva activa sin fechas', () => {
    const result = classifyAlert(makeItem('activa'), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('new_active');
  });

  it('ALERTABLE para nueva publicada con fecha futura', () => {
    const result = classifyAlert(makeItem('publicada', FUTURE), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('new_active');
  });

  it('NOT_ALERTABLE para nueva pero adjudicada', () => {
    const result = classifyAlert(makeItem('adjudicada'), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('new_but_awarded');
  });

  it('NOT_ALERTABLE para nueva pero cancelada', () => {
    const result = classifyAlert(makeItem('cancelada'), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('new_but_cancelled');
  });

  it('NOT_ALERTABLE para nueva pero cerrada', () => {
    const result = classifyAlert(makeItem('cerrada'), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('new_but_closed');
  });

  it('ALERTABLE para nueva desierta reciente', () => {
    const item = makeItem('desierta', null, RECENT);
    const result = classifyAlert(item, makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('new_desierta');
  });

  it('NOT_ALERTABLE para nueva desierta pero vieja', () => {
    const item = makeItem('desierta', null, OLD);
    const result = classifyAlert(item, makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('desierta_too_old');
  });
});

describe('classifyAlert — CASO B: isNew=false', () => {
  it('ALERTABLE para activa con fecha de apertura futura', () => {
    const result = classifyAlert(makeItem('activa', FUTURE), makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('active_with_future_dates');
  });

  it('ALERTABLE para activa con fecha_fallo futura en rawJson', () => {
    const item = makeItem('activa', PAST, RECENT, { fecha_fallo: FUTURE });
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('active_with_future_dates');
  });

  it('NOT_ALERTABLE para activa con todas las fechas pasadas', () => {
    const item = makeItem('activa', PAST, OLD, { fecha_fallo: PAST });
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('old_no_future_dates');
  });

  it('NOT_ALERTABLE para adjudicada vieja', () => {
    const result = classifyAlert(makeItem('adjudicada', PAST, OLD), makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('old_closed_status');
  });

  it('ALERTABLE para desierta reciente (por fetchedAt)', () => {
    const item = makeItem('desierta', PAST, RECENT);
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('recent_desierta');
  });

  it('NOT_ALERTABLE para desierta con fetchedAt viejo', () => {
    const item = makeItem('desierta', PAST, OLD);
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('desierta_too_old');
  });

  it('NOT_ALERTABLE para UNKNOWN vieja', () => {
    const result = classifyAlert(makeItem('unknown', PAST, OLD), makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('unknown_status_old');
  });
});
```

- [ ] **Step 2: Ejecutar — debe fallar**

```bash
cd apps/worker && npx jest src/modules/alert-filter/__tests__/eligibility.test.ts --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module '../eligibility'`

- [ ] **Step 3: Implementar `eligibility.ts`**

```typescript
// src/modules/alert-filter/eligibility.ts
import type { NormalizedProcurement } from '../../types/procurement';
import type { UpsertProcurementResult } from '../../storage/procurement.repo';
import type { AlertClassification, AlertFilterOptions, NormalizedTenderStatus } from './types';
import { normalizeTenderStatus } from './status-normalizer';
import { extractTenderDates, isTenderStillActionable, isWithinDays } from './date-utils';

const DEFAULT_OPTIONS: AlertFilterOptions = {
  desertaLookbackDays: 10,
  activeMaxAgeDays: 21,
};

const CLOSED_STATUSES: NormalizedTenderStatus[] = ['CLOSED', 'AWARDED', 'CANCELLED', 'EXPIRED'];

const CLOSED_REASON_MAP: Partial<Record<NormalizedTenderStatus, string>> = {
  CLOSED: 'new_but_closed',
  AWARDED: 'new_but_awarded',
  CANCELLED: 'new_but_cancelled',
  EXPIRED: 'new_but_expired',
};

/**
 * Clasifica si una licitación debe enviarse por Telegram.
 * Función pura — sin efectos secundarios ni logging.
 *
 * @param item - La licitación normalizada
 * @param upsertResult - Resultado del upsert en DB (determina si es nueva)
 * @param options - Ventanas de tiempo configurables
 * @param now - Instante actual (inyectable para tests)
 */
export function classifyAlert(
  item: NormalizedProcurement,
  upsertResult: UpsertProcurementResult,
  options: AlertFilterOptions = DEFAULT_OPTIONS,
  now: Date = new Date(),
): AlertClassification {
  const normalizedStatus = normalizeTenderStatus(item.status);
  const dates = extractTenderDates(item);
  const hasActionableDates = isTenderStillActionable(dates, now);

  // ── CASO A: Nueva en este ciclo ───────────────────────────────────────────
  if (upsertResult.isNew) {
    if (CLOSED_STATUSES.includes(normalizedStatus)) {
      const reason = (CLOSED_REASON_MAP[normalizedStatus] ?? 'new_but_closed') as any;
      return { decision: 'NOT_ALERTABLE', reason, normalizedStatus, hasActionableDates };
    }

    if (normalizedStatus === 'DESIERTA') {
      const refDate = dates.publicationDate ?? dates.firstSeenAt;
      if (refDate && !isWithinDays(refDate, options.desertaLookbackDays, now)) {
        return { decision: 'NOT_ALERTABLE', reason: 'desierta_too_old', normalizedStatus, hasActionableDates };
      }
      return { decision: 'ALERTABLE', reason: 'new_desierta', normalizedStatus, hasActionableDates };
    }

    // ACTIVE o UNKNOWN nueva → siempre alertar
    return { decision: 'ALERTABLE', reason: 'new_active', normalizedStatus, hasActionableDates };
  }

  // ── CASO B: Ya estaba en DB ───────────────────────────────────────────────
  if (CLOSED_STATUSES.includes(normalizedStatus)) {
    return { decision: 'NOT_ALERTABLE', reason: 'old_closed_status', normalizedStatus, hasActionableDates };
  }

  if (normalizedStatus === 'DESIERTA') {
    if (isWithinDays(dates.firstSeenAt, options.desertaLookbackDays, now)) {
      return { decision: 'ALERTABLE', reason: 'recent_desierta', normalizedStatus, hasActionableDates };
    }
    return { decision: 'NOT_ALERTABLE', reason: 'desierta_too_old', normalizedStatus, hasActionableDates };
  }

  if (normalizedStatus === 'ACTIVE') {
    if (hasActionableDates) {
      return { decision: 'ALERTABLE', reason: 'active_with_future_dates', normalizedStatus, hasActionableDates };
    }
    return { decision: 'NOT_ALERTABLE', reason: 'old_no_future_dates', normalizedStatus, hasActionableDates };
  }

  // UNKNOWN vieja → no alertar
  return { decision: 'NOT_ALERTABLE', reason: 'unknown_status_old', normalizedStatus, hasActionableDates };
}
```

- [ ] **Step 4: Ejecutar — debe pasar**

```bash
cd apps/worker && npx jest src/modules/alert-filter/__tests__/eligibility.test.ts --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 14 passed`

- [ ] **Step 5: Commit**

```bash
git add src/modules/alert-filter/eligibility.ts src/modules/alert-filter/__tests__/eligibility.test.ts
git commit -m "feat(alert-filter): classifyAlert con árbol de decisión completo y tests"
```

---

## Task 6: Fixture de 250 licitaciones simuladas

**Files:**
- Create: `src/modules/alert-filter/sample-data.ts`

- [ ] **Step 1: Crear `sample-data.ts`**

```typescript
// src/modules/alert-filter/sample-data.ts
import type { NormalizedProcurement } from '../../types/procurement';
import type { UpsertProcurementResult } from '../../storage/procurement.repo';

export interface SampleEntry {
  item: NormalizedProcurement;
  upsertResult: UpsertProcurementResult;
  category: string;
}

const NOW = new Date();
const future = (days: number) =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString().replace('Z', '');
const past = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString().replace('Z', '');

let _seq = 0;
function makeEntry(
  category: string,
  status: string,
  isNew: boolean,
  openingDate: string | null,
  fetchedAt: string,
  rawJson: Record<string, unknown> = {},
): SampleEntry {
  _seq++;
  return {
    category,
    item: {
      source: 'comprasmx',
      sourceUrl: `https://example.com/${_seq}`,
      externalId: `EXT-${_seq.toString().padStart(4, '0')}`,
      expedienteId: null,
      licitationNumber: `LIC-${_seq}`,
      procedureNumber: null,
      title: `Licitación de prueba ${_seq} — ${category}`,
      description: null,
      dependencyName: `Dependencia ${_seq % 10}`,
      buyingUnit: null,
      procedureType: 'licitacion_publica',
      status: status as any,
      publicationDate: fetchedAt,
      openingDate,
      awardDate: null,
      state: 'Morelos',
      municipality: null,
      amount: 100_000 + _seq * 1_000,
      currency: 'MXN',
      attachments: [],
      canonicalText: `licitacion prueba ${_seq}`,
      canonicalFingerprint: `fp-${_seq}`,
      lightweightFingerprint: null,
      canonicalHash: null,
      rawJson,
      fetchedAt,
    },
    upsertResult: {
      isNew,
      isUpdated: !isNew,
      procurementId: `uuid-${_seq}`,
      changedFields: {},
      versionNumber: 1,
    },
  };
}

export function generateSampleData(): SampleEntry[] {
  const entries: SampleEntry[] = [];

  // 80 cerradas de marzo (viejas, isNew=false)
  for (let i = 0; i < 80; i++) {
    entries.push(makeEntry('old_closed_march', 'cerrada', false, past(60 + i), past(60 + i)));
  }

  // 40 adjudicadas (isNew=false)
  for (let i = 0; i < 40; i++) {
    entries.push(makeEntry('awarded', 'adjudicada', false, past(45 + i), past(45 + i)));
  }

  // 30 canceladas (isNew=false)
  for (let i = 0; i < 30; i++) {
    entries.push(makeEntry('cancelled', 'cancelada', false, past(30 + i), past(30 + i)));
  }

  // 20 históricas activas pero viejas sin fechas futuras (isNew=false)
  for (let i = 0; i < 20; i++) {
    entries.push(makeEntry('historical', 'activa', false, past(35), past(35)));
  }

  // 25 duplicadas (mismo externalId que las primeras 25 — se maneja en runner)
  for (let i = 0; i < 25; i++) {
    const dup = { ...entries[i] };
    dup.category = 'duplicate';
    entries.push(dup);
  }

  // 35 activas recientes nuevas con fechas futuras
  for (let i = 0; i < 35; i++) {
    entries.push(makeEntry('new_active', 'activa', true, future(3 + i), past(1)));
  }

  // 10 desiertas recientes (dentro de ventana de 10 días)
  for (let i = 0; i < 10; i++) {
    entries.push(makeEntry('recent_desierta', 'desierta', false, past(60), past(5 + i)));
  }

  // 10 activas ya en DB con fechas futuras (no nuevas)
  for (let i = 0; i < 10; i++) {
    entries.push(makeEntry('active_future_dates', 'activa', false, future(7 + i), past(3)));
  }

  return entries;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/alert-filter/sample-data.ts
git commit -m "feat(alert-filter): fixture de 250 licitaciones simuladas"
```

---

## Task 7: Script de muestra + npm script

**Files:**
- Create: `src/modules/alert-filter/sample-runner.ts`
- Modify: `package.json`

- [ ] **Step 1: Crear `sample-runner.ts`**

```typescript
// src/modules/alert-filter/sample-runner.ts
/**
 * Ejecuta el filtro de alertas contra 250 licitaciones simuladas e imprime métricas.
 * No requiere DB ni Telegram. Ejecutar con: npm run alert-filter:sample
 */
import { generateSampleData } from './sample-data';
import { classifyAlert } from './eligibility';
import type { AlertFilterOptions, CycleMetrics } from './types';

const OPTIONS: AlertFilterOptions = {
  desertaLookbackDays: 10,
  activeMaxAgeDays: 21,
};

const ALERT_MAX_PER_CYCLE = 25;

function run(): void {
  const entries = generateSampleData();
  const seenIds = new Set<string>();

  const metrics: CycleMetrics = {
    found: entries.length,
    alertable: 0,
    sent: 0,
    excluded: 0,
    excludedClosed: 0,
    excludedOld: 0,
  };

  let excludedDuplicates = 0;

  for (const { item, upsertResult, category } of entries) {
    // Dedup por externalId
    if (seenIds.has(item.externalId)) {
      excludedDuplicates++;
      continue;
    }
    seenIds.add(item.externalId);

    const classification = classifyAlert(item, upsertResult, OPTIONS);

    if (classification.decision === 'NOT_ALERTABLE') {
      metrics.excluded++;
      if (['old_closed_status', 'new_but_closed', 'new_but_awarded', 'new_but_cancelled', 'new_but_expired'].includes(classification.reason)) {
        metrics.excludedClosed++;
      } else {
        metrics.excludedOld++;
      }
      continue;
    }

    metrics.alertable++;

    if (metrics.sent < ALERT_MAX_PER_CYCLE) {
      metrics.sent++;
    }
  }

  console.log('\n📊 RESULTADO alert-filter:sample');
  console.log('─────────────────────────────────');
  console.log(`found:              ${metrics.found}`);
  console.log(`alertable:          ${metrics.alertable}`);
  console.log(`sent (capped):      ${metrics.sent}  (límite: ${ALERT_MAX_PER_CYCLE})`);
  console.log(`excluded total:     ${metrics.excluded}`);
  console.log(`  excludedClosed:   ${metrics.excludedClosed}`);
  console.log(`  excludedOld:      ${metrics.excludedOld}`);
  console.log(`excludedDuplicates: ${excludedDuplicates}`);
  console.log('─────────────────────────────────');

  // Validaciones básicas
  const ok = (cond: boolean, msg: string) => {
    if (!cond) { console.error(`❌ FALLO: ${msg}`); process.exit(1); }
    console.log(`✅ ${msg}`);
  };

  ok(metrics.found === 250, `found === 250 (got ${metrics.found})`);
  ok(metrics.sent <= ALERT_MAX_PER_CYCLE, `sent <= ${ALERT_MAX_PER_CYCLE}`);
  ok(metrics.excludedClosed > 0, 'excludedClosed > 0');
  ok(metrics.excludedOld > 0, 'excludedOld > 0');
  ok(excludedDuplicates > 0, 'excludedDuplicates > 0');
  ok(metrics.alertable <= 60, `alertable razonable (got ${metrics.alertable})`);

  console.log('\n🏁 Sample runner completado sin errores.\n');
}

run();
```

- [ ] **Step 2: Agregar script a `package.json`**

Abrir `apps/worker/package.json`, en la sección `"scripts"`, agregar ANTES del cierre `}`:

```json
"alert-filter:sample": "ts-node-dev --transpile-only src/modules/alert-filter/sample-runner.ts"
```

La sección scripts debe quedar (añadiendo la nueva línea):

```json
"scripts": {
  ...existing scripts...,
  "alert-filter:sample": "ts-node-dev --transpile-only src/modules/alert-filter/sample-runner.ts"
}
```

- [ ] **Step 3: Ejecutar el sample**

```bash
cd apps/worker && npm run alert-filter:sample
```

Expected output (aproximado):
```
found:              250
alertable:          <=60
sent (capped):      25
excludedClosed:     >0
excludedOld:        >0
excludedDuplicates: 25
✅ found === 250
✅ sent <= 25
...
🏁 Sample runner completado sin errores.
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/alert-filter/sample-runner.ts package.json
git commit -m "feat(alert-filter): sample runner con validaciones y script npm"
```

---

## Task 8: `index.ts` — re-exportar API pública

**Files:**
- Create: `src/modules/alert-filter/index.ts`

- [ ] **Step 1: Crear `index.ts`**

```typescript
// src/modules/alert-filter/index.ts
export { classifyAlert } from './eligibility';
export { normalizeTenderStatus } from './status-normalizer';
export { extractTenderDates, isTenderStillActionable, isWithinDays } from './date-utils';
export type {
  NormalizedTenderStatus,
  AlertEligibility,
  AlertReason,
  AlertClassification,
  AlertFilterOptions,
  CycleMetrics,
  SummaryData,
  SummarySection,
  TenderDates,
} from './types';
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/alert-filter/index.ts
git commit -m "feat(alert-filter): index.ts con re-exportaciones públicas"
```

---

## Task 9: Variables de entorno

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Agregar variables al schema Zod en `env.ts`**

Dentro del objeto `z.object({...})` en `envSchema`, agregar ANTES del cierre `})`:

```typescript
  // Alert Filter
  ALERT_NEW_LOOKBACK_HOURS: z.string().default('48').transform(Number),
  ALERT_ACTIVE_MAX_AGE_DAYS: z.string().default('21').transform(Number),
  ALERT_DESIERTA_LOOKBACK_DAYS: z.string().default('10').transform(Number),
  ALERT_INCLUDE_HISTORICAL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  ALERT_MAX_PER_CYCLE: z.string().default('25').transform(Number),
  DAILY_SUMMARY_MAX_ITEMS: z.string().default('40').transform(Number),
  DAILY_SUMMARY_EXCLUDE_OLD_CLOSED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
```

- [ ] **Step 2: Agregar al `.env.example`**

Al final del archivo `.env.example`, agregar:

```env

# Alert Filter — ventanas de tiempo y límites
ALERT_NEW_LOOKBACK_HOURS=48
ALERT_ACTIVE_MAX_AGE_DAYS=21
ALERT_DESIERTA_LOOKBACK_DAYS=10
ALERT_INCLUDE_HISTORICAL=false
ALERT_MAX_PER_CYCLE=25
DAILY_SUMMARY_MAX_ITEMS=40
DAILY_SUMMARY_EXCLUDE_OLD_CLOSED=true
```

- [ ] **Step 3: Verificar typecheck**

```bash
cd apps/worker && npm run typecheck 2>&1 | tail -10
```

Expected: sin errores nuevos

- [ ] **Step 4: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "feat(alert-filter): variables de entorno para ventanas de filtrado"
```

---

## Task 10: Integrar `classifyAlert` en Modo 1 (`collect.job.ts`)

**Files:**
- Modify: `src/jobs/collect.job.ts`

- [ ] **Step 1: Agregar import al inicio de `collect.job.ts`**

Después de la última línea de imports existentes, agregar:

```typescript
import { classifyAlert } from '../modules/alert-filter';
import type { CycleMetrics } from '../modules/alert-filter';
```

- [ ] **Step 2: Inicializar métricas del ciclo y opciones del filtro**

Dentro de `runCollectJob()`, justo después de `let totalMatches = 0;` (alrededor de línea 569), agregar:

```typescript
let alertsSentThisCycle = 0;
const cycleMetrics: CycleMetrics = {
  found: 0, alertable: 0, sent: 0, excluded: 0, excludedClosed: 0, excludedOld: 0,
};
const config = getConfig();
const alertFilterOptions = {
  desertaLookbackDays: config.ALERT_DESIERTA_LOOKBACK_DAYS,
  activeMaxAgeDays: config.ALERT_ACTIVE_MAX_AGE_DAYS,
};
```

Nota: agregar también `import { getConfig } from '../config/env';` si no está ya importado (verificar que no lo esté antes de añadirlo).

- [ ] **Step 3: Corregir excepción desierta en el filtro `isDateExpired` existente**

Localizar este bloque (alrededor de línea 627):

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

Reemplazarlo con:

```typescript
// Filtrar licitaciones vencidas: no generar alertas si ya pasó la fecha de apertura.
// Excepción: las DESIERTA siempre pasan (classifyAlert decidirá si son recientes).
const isDesiertaItem = item.status.toLowerCase().includes('desierta');
if (isDateExpired(item.openingDate) && !isDesiertaItem) {
  log.debug(
    { externalId: item.externalId, openingDate: item.openingDate },
    "Licitación con fecha de apertura vencida, omitiendo match",
  );
  continue;
}
```

- [ ] **Step 4: Insertar `classifyAlert` en el loop de matches**

Dentro del loop `for (const match of matches)`, localizar justo ANTES de:

```typescript
const enrichableMatch = {
  ...match,
  procurementId: upsertResult.procurementId,
};
```

Insertar:

```typescript
// ── Filtro de elegibilidad ────────────────────────────────────────────────
cycleMetrics.found++;
const classification = classifyAlert(item, upsertResult, alertFilterOptions);

if (classification.decision === 'NOT_ALERTABLE') {
  log.debug(
    {
      externalId: item.externalId,
      status: item.status,
      normalizedStatus: classification.normalizedStatus,
      reason: classification.reason,
    },
    '[alert-filter] excluded',
  );
  if (['old_closed_status','new_but_closed','new_but_awarded','new_but_cancelled','new_but_expired'].includes(classification.reason)) {
    cycleMetrics.excludedClosed++;
  } else {
    cycleMetrics.excludedOld++;
  }
  cycleMetrics.excluded++;
  // Persistir match para métricas de DB aunque no se alerte
  const _radarDbIdExcluded = radarDbIds.get(match.radarKey);
  const _excludedMatch = { ...match, procurementId: upsertResult.procurementId };
  if (_radarDbIdExcluded) {
    await upsertMatch(_excludedMatch, _radarDbIdExcluded).catch(() => {});
  }
  continue;
}

cycleMetrics.alertable++;

// Límite duro por ciclo
if (alertsSentThisCycle >= config.ALERT_MAX_PER_CYCLE) {
  log.warn(
    { limit: config.ALERT_MAX_PER_CYCLE, externalId: item.externalId },
    '[alert-filter] límite de ciclo alcanzado, alerta omitida',
  );
  continue;
}
```

- [ ] **Step 5: Registrar `sent` y loguear métricas al final del ciclo**

Localizar la línea `await markAlertSent(alertId, msgId);` dentro del loop de matches. Justo ANTES de ella, agregar:

```typescript
alertsSentThisCycle++;
cycleMetrics.sent++;
```

Luego, al final del bloque `finally` de `runCollectJob` (justo antes o después del log `"Ciclo Modo 1 completado"`), agregar:

```typescript
log.info(
  cycleMetrics,
  '[alert-filter] métricas del ciclo',
);
```

- [ ] **Step 6: Typecheck**

```bash
cd apps/worker && npm run typecheck 2>&1 | tail -10
```

Expected: sin errores

- [ ] **Step 7: Commit**

```bash
git add src/jobs/collect.job.ts
git commit -m "feat(alert-filter): integrar classifyAlert en Modo 1 con métricas de ciclo"
```

---

## Task 11: Silenciar Modo 2 (`runRecheckJob`)

**Files:**
- Modify: `src/jobs/collect.job.ts` (sección `runRecheckJob`)

- [ ] **Step 1: Eliminar envío de alertas del loop de Modo 2**

Dentro de `runRecheckJob`, localizar el bloque interno `for (const match of matches)`. Actualmente tiene esta estructura:

```typescript
for (const match of matches) {
  // Dedup: skip si el externalId ya aparece en mensajes recientes de Telegram
  const extId = normalized.externalId ?? "";
  if (extId && [...recentMessages].some(msg => msg.includes(extId))) continue;

  totalMatches++;

  try {
    const enrichableMatch = { ...match, procurementId: (row as DbProcurement).id };
    const radarDbId = radarDbIds.get(match.radarKey);

    if (radarDbId) {
      await upsertMatch(enrichableMatch, radarDbId);
    }

    const enriched = await enrichMatch(normalized, enrichableMatch);
    const alertId = await createAlert(enriched, (row as DbProcurement).id, radarDbId);

    if (alertsSentThisCycle >= MAX_ALERTS_PER_CYCLE) {
      if (!alertsOverflowNotified) {
        alertsOverflowNotified = true;
        await sendTelegramMessage(...).catch(() => {});
      }
      await markAlertFailed(alertId);
      continue;
    }

    const msgId = await sendMatchAlert(enriched);
    if (msgId) {
      alertsSentThisCycle++;
      await markAlertSent(alertId, msgId);
      if (enriched.telegramMessage) recentMessages.add(enriched.telegramMessage);
    } else {
      await markAlertFailed(alertId);
    }
  } catch (err) {
    log.error({ err }, "Error procesando match en recheck DB");
  }
}
```

Reemplazar TODO ese bloque con:

```typescript
for (const match of matches) {
  totalMatches++;
  try {
    const enrichableMatch = { ...match, procurementId: (row as DbProcurement).id };
    const radarDbId = radarDbIds.get(match.radarKey);
    // Modo 2: solo persiste el match para métricas. NO envía alertas a Telegram.
    if (radarDbId) {
      await upsertMatch(enrichableMatch, radarDbId);
    }
  } catch (err) {
    log.error({ err }, 'Error registrando match en recheck DB');
  }
}
```

- [ ] **Step 2: Eliminar variables de Modo 2 que ya no se usan**

Localizar y eliminar estas líneas al inicio de `runRecheckJob` (ya no hacen falta):

```typescript
let alertsSentThisCycle = 0;
let alertsOverflowNotified = false;
```

También eliminar las variables `cutoff` y `recentAlerts` / `recentMessages` si ya no se usan (son las que construían el set de mensajes recientes para dedup). Confirmar que solo se usaban en el bloque que acabas de eliminar.

Eliminar también los imports que ya no se usan en `collect.job.ts` si el typecheck los reporta: `enrichMatch`, `createAlert`, `markAlertSent`, `markAlertFailed` pueden seguir en uso desde Modo 1 — verificar antes de eliminar.

- [ ] **Step 3: Typecheck**

```bash
cd apps/worker && npm run typecheck 2>&1 | tail -15
```

Expected: sin errores. Si hay unused imports, eliminarlos.

- [ ] **Step 4: Commit**

```bash
git add src/jobs/collect.job.ts
git commit -m "feat(alert-filter): silenciar Modo 2 — solo upsertMatch, sin alertas Telegram"
```

---

## Task 12: `summary-filter.ts` — construir secciones del resumen

**Files:**
- Create: `src/modules/alert-filter/summary-filter.ts`

- [ ] **Step 1: Crear `summary-filter.ts`**

```typescript
// src/modules/alert-filter/summary-filter.ts
import { getSupabaseClient } from '../../storage/client';
import { getConfig } from '../../config/env';
import { todayMexicoStr } from '../../core/time';
import { createModuleLogger } from '../../core/logger';
import type { SummaryData, SummarySection } from './types';

const log = createModuleLogger('summary-filter');

const ACTIVE_STATUSES = ['publicada', 'activa', 'en_proceso'];

/**
 * Construye los datos estructurados del resumen diario consultando la DB.
 * Ventana de tiempo: últimas 24 horas.
 */
export async function buildSummaryData(): Promise<SummaryData> {
  const db = getSupabaseClient();
  const config = getConfig();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString();
  const in5days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const desertaCutoff = new Date(
    Date.now() - config.ALERT_DESIERTA_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const technicalIncidents: string[] = [];

  // 1. Nuevas activas (created en últimas 24h, status activo)
  const { data: newActiveRows, error: e1 } = await db
    .from('procurements')
    .select('title, external_id, dependency_name, opening_date, source_url, status')
    .gte('created_at', yesterday)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(config.DAILY_SUMMARY_MAX_ITEMS);

  if (e1) {
    log.warn({ err: e1 }, 'Error consultando nuevas activas');
    technicalIncidents.push('Error al consultar nuevas activas');
  }

  const newActive: SummarySection[] = (newActiveRows ?? []).map((r) => ({
    title: r.title,
    externalId: r.external_id,
    dependencyName: r.dependency_name,
    openingDate: r.opening_date,
    matchScore: 0,
    sourceUrl: r.source_url,
    status: r.status,
  }));

  // 2. Desiertas recientes (status=desierta, created_at dentro de ventana)
  const { data: desertaRows, error: e2 } = await db
    .from('procurements')
    .select('title, external_id, dependency_name, opening_date, source_url, status')
    .eq('status', 'desierta')
    .gte('created_at', desertaCutoff)
    .order('created_at', { ascending: false })
    .limit(config.DAILY_SUMMARY_MAX_ITEMS);

  if (e2) {
    log.warn({ err: e2 }, 'Error consultando desiertas recientes');
    technicalIncidents.push('Error al consultar desiertas recientes');
  }

  const recentDesierta: SummarySection[] = (desertaRows ?? []).map((r) => ({
    title: r.title,
    externalId: r.external_id,
    dependencyName: r.dependency_name,
    openingDate: r.opening_date,
    matchScore: 0,
    sourceUrl: r.source_url,
    status: r.status,
  }));

  // 3. Próximas a vencer (opening_date entre hoy y +5 días, activas)
  const { data: expiringRows, error: e3 } = await db
    .from('procurements')
    .select('title, external_id, dependency_name, opening_date, source_url, status')
    .in('status', ACTIVE_STATUSES)
    .gte('opening_date', today)
    .lte('opening_date', in5days)
    .order('opening_date', { ascending: true })
    .limit(config.DAILY_SUMMARY_MAX_ITEMS);

  if (e3) {
    log.warn({ err: e3 }, 'Error consultando próximas a vencer');
    technicalIncidents.push('Error al consultar próximas a vencer');
  }

  const soonExpiring: SummarySection[] = (expiringRows ?? []).map((r) => ({
    title: r.title,
    externalId: r.external_id,
    dependencyName: r.dependency_name,
    openingDate: r.opening_date,
    matchScore: 0,
    sourceUrl: r.source_url,
    status: r.status,
  }));

  // 4. Alto score — matches recientes con score >= 0.7
  const { data: highScoreRows, error: e4 } = await db
    .from('matches')
    .select(`
      match_score,
      procurements!inner(title, external_id, dependency_name, opening_date, source_url, status)
    `)
    .gte('created_at', yesterday)
    .gte('match_score', 0.7)
    .order('match_score', { ascending: false })
    .limit(config.DAILY_SUMMARY_MAX_ITEMS);

  if (e4) {
    log.warn({ err: e4 }, 'Error consultando alto score');
    technicalIncidents.push('Error al consultar matches de alto score');
  }

  const highScore: SummarySection[] = (highScoreRows ?? []).map((r: any) => ({
    title: r.procurements?.title ?? 'Sin título',
    externalId: r.procurements?.external_id ?? '',
    dependencyName: r.procurements?.dependency_name ?? null,
    openingDate: r.procurements?.opening_date ?? null,
    matchScore: r.match_score,
    sourceUrl: r.procurements?.source_url ?? '',
    status: r.procurements?.status ?? '',
  }));

  // Conteos generales
  const { count: totalSeen } = await db
    .from('procurements')
    .select('*', { count: 'exact', head: true })
    .gte('last_seen_at', yesterday);

  const { count: totalNew } = await db
    .from('procurements')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', yesterday);

  const { count: totalAlerts } = await db
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', yesterday)
    .eq('telegram_status', 'sent');

  const alertableCount = newActive.length + recentDesierta.length + soonExpiring.length + highScore.length;
  const excludedCount = Math.max(0, (totalSeen ?? 0) - alertableCount);

  return {
    summaryDate: todayMexicoStr(),
    newActive,
    recentDesierta,
    soonExpiring,
    highScore,
    totalSeen: totalSeen ?? 0,
    totalNew: totalNew ?? 0,
    totalAlerts: totalAlerts ?? 0,
    excludedCount,
    technicalIncidents,
  };
}
```

- [ ] **Step 2: Actualizar `index.ts` para exportar `buildSummaryData`**

Agregar al final de `src/modules/alert-filter/index.ts`:

```typescript
export { buildSummaryData } from './summary-filter';
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/worker && npm run typecheck 2>&1 | tail -10
```

Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add src/modules/alert-filter/summary-filter.ts src/modules/alert-filter/index.ts
git commit -m "feat(alert-filter): buildSummaryData con secciones del resumen diario"
```

---

## Task 13: Nuevo formatter del resumen en `telegram.alerts.ts`

**Files:**
- Modify: `src/alerts/telegram.alerts.ts`

- [ ] **Step 1: Agregar import de `SummaryData`**

Al inicio de `telegram.alerts.ts`, agregar import:

```typescript
import type { SummaryData, SummarySection } from '../modules/alert-filter';
```

- [ ] **Step 2: Agregar función `formatEnhancedDailySummaryMessage`**

Al final del archivo (antes del cierre), agregar:

```typescript
/**
 * Formatea el resumen diario mejorado con secciones por categoría.
 * Reemplaza al formatDailySummaryMessage original para el job diario.
 */
export function formatEnhancedDailySummaryMessage(data: SummaryData): string {
  const config = getConfig();
  const maxItems = config.DAILY_SUMMARY_MAX_ITEMS;

  const fmtSection = (items: SummarySection[], max = 5): string => {
    return items
      .slice(0, max)
      .map((s, i) => {
        const dep = s.dependencyName ? escapeHtml(s.dependencyName.slice(0, 30)) : 'N/D';
        const date = s.openingDate ? fmtShortDate(s.openingDate) : '?';
        const title = escapeHtml(s.title.slice(0, 50));
        return `  ${i + 1}. ${title} — ${dep} — apertura ${date}`;
      })
      .join('\n');
  };

  const fmtShortDate = (d: string): string => {
    try {
      return formatMexicoDate(d, 'dd/MM');
    } catch {
      return d.slice(0, 10);
    }
  };

  const topItems = [
    ...data.recentDesierta,
    ...data.newActive,
    ...data.soonExpiring,
    ...data.highScore,
  ]
    .filter((s, i, arr) => arr.findIndex((x) => x.externalId === s.externalId) === i)
    .slice(0, maxItems);

  const lines: string[] = [
    `📊 <b>RESUMEN RADAR — ${escapeHtml(data.summaryDate)}</b>`,
    `<i>Radar Licitaciones MX</i>`,
    '',
    `✅ <b>Nuevas vigentes detectadas hoy:</b> ${data.newActive.length}`,
    `🏜 <b>Desiertas recientes:</b> ${data.recentDesierta.length}`,
    `⏳ <b>Próximas a vencer (≤5 días):</b> ${data.soonExpiring.length}`,
    `🔥 <b>Alto score (≥70%):</b> ${data.highScore.length}`,
    `🗑 <b>Excluidas viejas/cerradas:</b> ${data.excludedCount}`,
    '',
  ];

  if (topItems.length > 0) {
    lines.push('<b>🏆 Top oportunidades:</b>');
    lines.push(fmtSection(topItems, Math.min(10, maxItems)));
    lines.push('');
  }

  if (data.technicalIncidents.length > 0) {
    lines.push('<b>⚠️ Incidencias:</b>');
    data.technicalIncidents.forEach((inc) => lines.push(`  • ${escapeHtml(inc)}`));
    lines.push('');
  }

  return truncateForTelegram(lines.filter(Boolean).join('\n'));
}

export async function sendEnhancedDailySummary(
  data: SummaryData,
): Promise<number | null> {
  const message = formatEnhancedDailySummaryMessage(data);
  return sendTelegramMessage(message, 'HTML');
}
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/worker && npm run typecheck 2>&1 | tail -10
```

Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add src/alerts/telegram.alerts.ts
git commit -m "feat(alert-filter): formatEnhancedDailySummaryMessage con secciones"
```

---

## Task 14: Actualizar `daily-summary.job.ts`

**Files:**
- Modify: `src/jobs/daily-summary.job.ts`

- [ ] **Step 1: Reemplazar imports y lógica del job**

Reemplazar el archivo completo con:

```typescript
/**
 * DAILY SUMMARY JOB — Genera y envía el resumen de las últimas 24 horas.
 * Versión mejorada con secciones por categoría de alertabilidad.
 */
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../core/logger';
import { todayMexicoStr, nowISO } from '../core/time';
import { getSupabaseClient } from '../storage/client';
import { sendEnhancedDailySummary } from '../alerts/telegram.alerts';
import { buildSummaryData } from '../modules/alert-filter';
import { healthTracker } from '../core/healthcheck';

const log = createModuleLogger('daily-summary-job');

export async function runDailySummaryJob(): Promise<void> {
  log.info('Generando resumen diario mejorado');

  const today = todayMexicoStr();

  try {
    const summaryData = await buildSummaryData();

    const healthStatus = healthTracker.getStatus();
    if (healthStatus.services.database !== 'ok') {
      summaryData.technicalIncidents.push('DB con problemas de conectividad en algún ciclo');
    }

    // Guardar en DB (formato legado compatible)
    const db = getSupabaseClient();
    await db.from('daily_summaries').insert({
      id: uuidv4(),
      summary_date: today,
      total_seen: summaryData.totalSeen,
      total_new: summaryData.totalNew,
      total_updated: 0,
      total_matches: summaryData.highScore.length,
      total_alerts: summaryData.totalAlerts,
      summary_text: JSON.stringify(summaryData),
      created_at: nowISO(),
    });

    // Enviar a Telegram con nuevo formato de secciones
    await sendEnhancedDailySummary(summaryData);

    log.info(
      {
        today,
        newActive: summaryData.newActive.length,
        recentDesierta: summaryData.recentDesierta.length,
        soonExpiring: summaryData.soonExpiring.length,
        highScore: summaryData.highScore.length,
        excluded: summaryData.excludedCount,
      },
      'Resumen diario enviado',
    );
  } catch (err) {
    log.error({ err }, 'Error generando resumen diario');
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && npm run typecheck 2>&1 | tail -10
```

Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add src/jobs/daily-summary.job.ts
git commit -m "feat(alert-filter): daily summary con secciones activas — buildSummaryData"
```

---

## Task 15: Validación final

- [ ] **Step 1: Sample runner**

```bash
cd apps/worker && npm run alert-filter:sample
```

Expected:
```
found:              250
alertable:          <=60
sent (capped):      25
excludedClosed:     >0
...
🏁 Sample runner completado sin errores.
```

- [ ] **Step 2: Lint**

```bash
cd apps/worker && npm run lint 2>&1 | tail -20
```

Expected: sin errores. Si hay warnings de unused vars, corregirlos.

- [ ] **Step 3: Typecheck**

```bash
cd apps/worker && npm run typecheck 2>&1 | tail -10
```

Expected: `Found 0 errors.`

- [ ] **Step 4: Tests completos**

```bash
cd apps/worker && npm test 2>&1 | tail -20
```

Expected: tests del alert-filter pasan. Si hay algún test heredado fallando por `canonicalHash`, documentarlo en este commit pero no corregirlo.

- [ ] **Step 5: Verificar que financial:sample sigue pasando**

```bash
cd apps/worker && npm run financial:sample 2>&1 | tail -10
```

Expected: sin cambios respecto a antes de esta rama.

- [ ] **Step 6: Commit final y push**

```bash
git add -A
git commit -m "chore: validación final alert-filter — lint, typecheck, tests"
git push -u origin feature/filter-active-new-tenders
```

- [ ] **Step 7: Crear PR (si gh CLI disponible)**

```bash
gh pr create \
  --title "feat: alert-filter — solo licitaciones nuevas, activas y desiertas recientes" \
  --body "$(cat <<'EOF'
## Resumen

Implementa módulo `alert-filter` para eliminar ruido en Telegram.

## Cambios principales

- `src/modules/alert-filter/` — módulo nuevo con `classifyAlert()`, normalizador de estado, utilidades de fecha, resumen diario por secciones
- `collect.job.ts` Modo 1 — inserta `classifyAlert()` antes de enviar a Telegram; aplica límite `ALERT_MAX_PER_CYCLE`
- `collect.job.ts` Modo 2 — silenciado; solo `upsertMatch()`, sin alertas
- `daily-summary.job.ts` — reconstruido con `buildSummaryData()` y secciones
- Nuevas variables de entorno: `ALERT_MAX_PER_CYCLE`, `ALERT_DESIERTA_LOOKBACK_DAYS`, etc.

## Resultado esperado

- De ~250 licitaciones en el recheck, solo pasan ≤25 a Telegram
- Licitaciones de marzo/adjudicadas/canceladas quedan excluidas
- Resumen diario muestra secciones: nuevas, desiertas, próximas, alto score, excluidas

## Test plan

- [ ] `npm run alert-filter:sample` imprime métricas correctas
- [ ] `npm run typecheck` sin errores
- [ ] `npm run lint` sin errores  
- [ ] `npm test` pasa (o fallas heredadas documentadas)
- [ ] `npm run financial:sample` sigue pasando intacto
- [ ] **NO hacer merge automático**

🤖 Generated with Claude Code
EOF
)"
```

---

## Notas de riesgo

| Riesgo | Mitigación implementada |
|---|---|
| `isTenderStillActionable` excluye licitaciones sin fechas | Si `dates.openingDate/rulingDate/clarificationDate` son todos null → retorna `true` |
| `normalizeTenderStatus` no reconoce variante nueva | UNKNOWN+isNew=true siempre alerta; UNKNOWN+isNew=false se excluye |
| Modo 2 deja de enviar alertas individualmente | Aceptado por diseño — Modo 1 corre cada 30 min |
| Test `canonicalHash` heredado falla | Documentar en commit, no corregir en esta rama |
| `financial-ceiling-radar` | No se toca — cero imports desde/hacia ese módulo |
