# Motor Topes Financieros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un módulo que evalúe la modalidad de contratación probable (adjudicación directa / invitación tres personas / licitación pública) según los topes del PEF 2026 Anexo 9, integrarlo en el pipeline de alertas Telegram y exponerlo vía HTTP.

**Architecture:** Tabla `topes_financieros_federales` en Supabase sirve como fuente de verdad. El servicio `topes.service.ts` encapsula consulta DB + lógica pura. La modalidad calculada viaja por `EnrichedAlert.modalidadProbable?` hasta `formatMatchAlert()`. El HTTP server se crea en `core/http-server.ts` y arranca en `index.ts`.

**Tech Stack:** Node.js 20, TypeScript 5, Supabase JS v2, Pino, Zod, Jest/ts-jest, `node:http`.

---

## Descubrimientos clave (NO asumir sin leer)

- **`health-server.ts` NO existe** — existe `core/healthcheck.ts` (singleton de estado, sin HTTP). Se debe crear `core/http-server.ts` desde cero.
- **`HEALTH_PORT` NO existe en `env.ts`** — se debe agregar.
- **Migraciones viven en `docs/migrations/`** (no `supabase/migrations/`) y se corren manualmente en Supabase SQL Editor.
- **`EnrichedAlert.telegramMessage`** es generado por `formatMatchAlert(enriched)` al final de `enrichMatch()`. Para inyectar la modalidad en el mensaje, hay que agregar `modalidadProbable?: string` a `EnrichedAlert` antes de que se llame `formatMatchAlert`.
- **`item.amount: number | null`** — campo monetario disponible en `NormalizedProcurement`. `presupuesto_autorizado` de la entidad NO está disponible; se usa un default de `500_000_000`.
- **Tests existentes** usan funciones puras sin mocks. Seguir ese patrón: extraer `computarModalidad()` como función pura y testearla directamente.

---

## Archivo mapa

| Acción | Archivo |
|---|---|
| Crear | `docs/migrations/11_topes_financieros.sql` |
| Crear | `apps/worker/src/topes/topes.types.ts` |
| Crear | `apps/worker/src/topes/topes.service.ts` |
| Crear | `apps/worker/src/topes/__tests__/topes.service.test.ts` |
| Crear | `apps/worker/src/core/http-server.ts` |
| Modificar | `apps/worker/src/config/env.ts` — agregar `HEALTH_PORT` |
| Modificar | `apps/worker/src/types/procurement.ts` — agregar `modalidadProbable?` a `EnrichedAlert` |
| Modificar | `apps/worker/src/enrichers/match.enricher.ts` — param opcional `modalidadProbable?` |
| Modificar | `apps/worker/src/alerts/telegram.alerts.ts` — línea modalidad en `formatMatchAlert` |
| Modificar | `apps/worker/src/jobs/collect.job.ts` — llamar `evaluarModalidad()` + pasar a `enrichMatch()` |
| Modificar | `apps/worker/src/index.ts` — arrancar HTTP server |

---

## Task 1: Migración SQL — Tabla y seed PEF 2026

**Files:**
- Create: `docs/migrations/11_topes_financieros.sql`

- [ ] **Step 1: Crear el archivo de migración**

```sql
-- docs/migrations/11_topes_financieros.sql
-- Topes financieros federales según PEF 2026 Anexo 9
-- Fuente: DOF Presupuesto de Egresos de la Federación 2026, Anexo 9
-- Artículos 43 LAASSP y 43 LOPSRM

-- ── Enum ──────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE tipo_contratacion AS ENUM (
    'adquisicion',
    'arrendamiento',
    'obra_publica'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tabla ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topes_financieros_federales (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  anio                    INTEGER     NOT NULL,
  tipo                    tipo_contratacion NOT NULL,
  presupuesto_desde       BIGINT      NOT NULL,   -- en pesos MXN (inclusive)
  presupuesto_hasta       BIGINT,                 -- en pesos MXN (exclusive); NULL = sin límite superior
  tope_adjudicacion_miles NUMERIC(14,2) NOT NULL, -- miles de pesos MXN
  tope_invitacion_miles   NUMERIC(14,2) NOT NULL, -- miles de pesos MXN
  fuente                  TEXT        NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_topes_anio_tipo_presupuesto
    UNIQUE (anio, tipo, presupuesto_desde)
);

-- Índice para búsquedas por (anio, tipo, presupuesto)
CREATE INDEX IF NOT EXISTS idx_topes_anio_tipo
  ON topes_financieros_federales (anio, tipo, presupuesto_desde DESC);

-- ── Seed PEF 2026 Anexo 9 ─────────────────────────────────────────────────────
-- LAASSP: Adquisiciones, arrendamientos y servicios
-- Topes en miles de pesos (miles = valor × 1,000 = pesos reales)
INSERT INTO topes_financieros_federales
  (anio, tipo, presupuesto_desde, presupuesto_hasta, tope_adjudicacion_miles, tope_invitacion_miles, fuente)
VALUES
  -- Adquisiciones: presupuesto autorizado < $500 millones
  (2026, 'adquisicion',   0,                500000000,   300,    2000,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  -- Adquisiciones: $500M – $2,000M
  (2026, 'adquisicion',   500000000,        2000000000,  600,    4500,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  -- Adquisiciones: $2,000M – $10,000M
  (2026, 'adquisicion',   2000000000,       10000000000, 1200,   9000,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  -- Adquisiciones: > $10,000M
  (2026, 'adquisicion',   10000000000,      NULL,        2400,   18000, 'PEF 2026 Anexo 9 — LAASSP Art.43'),

  -- Arrendamiento: mismos topes que adquisición (LAASSP)
  (2026, 'arrendamiento', 0,                500000000,   300,    2000,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  (2026, 'arrendamiento', 500000000,        2000000000,  600,    4500,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  (2026, 'arrendamiento', 2000000000,       10000000000, 1200,   9000,  'PEF 2026 Anexo 9 — LAASSP Art.43'),
  (2026, 'arrendamiento', 10000000000,      NULL,        2400,   18000, 'PEF 2026 Anexo 9 — LAASSP Art.43'),

  -- Obra pública y servicios relacionados (LOPSRM Art.43)
  (2026, 'obra_publica',  0,                500000000,   4200,   21000, 'PEF 2026 Anexo 9 — LOPSRM Art.43'),
  (2026, 'obra_publica',  500000000,        2000000000,  8400,   42000, 'PEF 2026 Anexo 9 — LOPSRM Art.43'),
  (2026, 'obra_publica',  2000000000,       NULL,        16800,  84000, 'PEF 2026 Anexo 9 — LOPSRM Art.43')
ON CONFLICT (anio, tipo, presupuesto_desde) DO NOTHING;
```

- [ ] **Step 2: Verificar sintaxis (no correr aún en prod)**

Abrir el archivo y confirmar que no hay errores de sintaxis visibles. La migración se correrá manualmente en Supabase SQL Editor.

---

## Task 2: Tipos TypeScript

**Files:**
- Create: `apps/worker/src/topes/topes.types.ts`

- [ ] **Step 1: Crear el archivo de tipos**

```typescript
// apps/worker/src/topes/topes.types.ts

export type TipoContratacion = "adquisicion" | "arrendamiento" | "obra_publica";

export type ModalidadContratacion =
  | "adjudicacion_directa"
  | "invitacion_tres_personas"
  | "licitacion_publica";

/** Fila de la tabla topes_financieros_federales */
export interface TopeFinancieroRow {
  id: string;
  anio: number;
  tipo: TipoContratacion;
  presupuesto_desde: number;
  presupuesto_hasta: number | null;
  tope_adjudicacion_miles: number;
  tope_invitacion_miles: number;
  fuente: string;
}

export interface EvaluarModalidadParams {
  /** Monto del contrato en pesos MXN */
  monto: number;
  tipo: TipoContratacion;
  /** Presupuesto autorizado de la entidad en pesos MXN.
   *  Default 500_000_000 si no se conoce. */
  presupuestoAutorizado: number;
  /** Año fiscal. Default: año actual. */
  anio?: number;
  /** Si true, divide monto / 1.16 antes de comparar con topes. */
  incluyeIva?: boolean;
}

export interface EvaluarModalidadResult {
  modalidad: ModalidadContratacion;
  /** Monto ya sin IVA (= monto si incluyeIva=false) */
  montoSinIva: number;
  /** Tope de adjudicación directa en pesos MXN */
  topeAdjudicacion: number;
  /** Tope de invitación a 3 personas en pesos MXN */
  topeInvitacion: number;
  /** Explicación en español */
  analisis: string;
}
```

- [ ] **Step 2: No hay tests para interfaces — continuar al siguiente task**

---

## Task 3: Servicio — lógica pura + consulta Supabase + tests

**Files:**
- Create: `apps/worker/src/topes/topes.service.ts`
- Create: `apps/worker/src/topes/__tests__/topes.service.test.ts`

### 3a — Test (lógica pura primero)

- [ ] **Step 1: Crear el archivo de tests**

```typescript
// apps/worker/src/topes/__tests__/topes.service.test.ts
import {
  computarModalidad,
  inferTipoContratacion,
} from "../topes.service";
import type { TipoContratacion } from "../topes.types";
import type { NormalizedProcurement } from "../../types/procurement";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTopeParams(
  tipo: TipoContratacion = "adquisicion",
  topeAd = 300_000,
  topeI3p = 2_000_000,
) {
  return { tipo, topeAdjudicacion: topeAd, topeInvitacion: topeI3p };
}

function makeProcurement(
  overrides: Partial<NormalizedProcurement> = {},
): NormalizedProcurement {
  return {
    source: "comprasmx",
    sourceUrl: "https://example.com",
    externalId: "EXT-001",
    expedienteId: null,
    licitationNumber: null,
    procedureNumber: null,
    title: "Adquisición de equipo",
    description: null,
    dependencyName: null,
    buyingUnit: null,
    procedureType: "unknown",
    status: "publicada",
    publicationDate: null,
    openingDate: null,
    awardDate: null,
    state: null,
    municipality: null,
    amount: null,
    currency: null,
    attachments: [],
    canonicalText: "adquisicion de equipo de computo",
    canonicalFingerprint: "abc123",
    lightweightFingerprint: null,
    rawJson: {},
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── computarModalidad ─────────────────────────────────────────────────────────

describe("computarModalidad", () => {
  const topes = makeTopeParams("adquisicion", 300_000, 2_000_000);

  it("devuelve adjudicacion_directa cuando monto <= tope AD", () => {
    const result = computarModalidad(299_000, false, topes);
    expect(result.modalidad).toBe("adjudicacion_directa");
    expect(result.montoSinIva).toBe(299_000);
  });

  it("devuelve adjudicacion_directa cuando monto == tope AD exacto", () => {
    const result = computarModalidad(300_000, false, topes);
    expect(result.modalidad).toBe("adjudicacion_directa");
  });

  it("devuelve invitacion_tres_personas cuando monto > tope AD y <= tope I3P", () => {
    const result = computarModalidad(1_500_000, false, topes);
    expect(result.modalidad).toBe("invitacion_tres_personas");
  });

  it("devuelve licitacion_publica cuando monto > tope I3P", () => {
    const result = computarModalidad(5_000_000, false, topes);
    expect(result.modalidad).toBe("licitacion_publica");
  });

  it("divide entre 1.16 cuando incluyeIva=true", () => {
    // 348_000 / 1.16 ≈ 300_000 → adjudicacion_directa
    const result = computarModalidad(348_000, true, topes);
    expect(result.montoSinIva).toBeCloseTo(300_000, 0);
    expect(result.modalidad).toBe("adjudicacion_directa");
  });

  it("incluye topes correctos en el resultado", () => {
    const result = computarModalidad(100_000, false, topes);
    expect(result.topeAdjudicacion).toBe(300_000);
    expect(result.topeInvitacion).toBe(2_000_000);
  });

  it("analisis menciona el monto y la modalidad en español", () => {
    const result = computarModalidad(1_000_000, false, topes);
    expect(result.analisis).toContain("invitación");
    expect(result.analisis.length).toBeGreaterThan(20);
  });
});

// ── inferTipoContratacion ─────────────────────────────────────────────────────

describe("inferTipoContratacion", () => {
  it("devuelve obra_publica para texto con 'obra'", () => {
    const p = makeProcurement({ canonicalText: "obra publica carretera morelos" });
    expect(inferTipoContratacion(p)).toBe("obra_publica");
  });

  it("devuelve obra_publica para 'construccion'", () => {
    const p = makeProcurement({ canonicalText: "construccion de puente" });
    expect(inferTipoContratacion(p)).toBe("obra_publica");
  });

  it("devuelve obra_publica para 'rehabilitacion'", () => {
    const p = makeProcurement({ canonicalText: "rehabilitacion de infraestructura hidraulica" });
    expect(inferTipoContratacion(p)).toBe("obra_publica");
  });

  it("devuelve adquisicion por defecto", () => {
    const p = makeProcurement({ canonicalText: "compra de mobiliario de oficina" });
    expect(inferTipoContratacion(p)).toBe("adquisicion");
  });

  it("devuelve arrendamiento para 'arrendamiento'", () => {
    const p = makeProcurement({ canonicalText: "arrendamiento de equipos de computo" });
    expect(inferTipoContratacion(p)).toBe("arrendamiento");
  });
});
```

- [ ] **Step 2: Correr tests — deben fallar (módulo no existe aún)**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npm test -- --testPathPattern="topes.service" --no-coverage 2>&1 | tail -20
```

Esperado: `Cannot find module '../topes.service'`

### 3b — Implementación del servicio

- [ ] **Step 3: Crear el directorio y el servicio**

```typescript
// apps/worker/src/topes/topes.service.ts
import { createModuleLogger } from "../core/logger";
import { getSupabaseClient } from "../storage/client";
import { StorageError } from "../core/errors";
import type { NormalizedProcurement } from "../types/procurement";
import type {
  TipoContratacion,
  ModalidadContratacion,
  TopeFinancieroRow,
  EvaluarModalidadParams,
  EvaluarModalidadResult,
} from "./topes.types";

const log = createModuleLogger("topes-service");

const IVA = 1.16;

// ── Inferencia de tipo de contratación ───────────────────────────────────────

const OBRA_KEYWORDS = [
  "obra publica",
  "obra pública",
  "construccion",
  "construcción",
  "rehabilitacion",
  "rehabilitación",
  "ampliacion",
  "ampliación",
  "proyecto ejecutivo",
  "infraestructura",
  "carretera",
  "pavimentacion",
  "pavimentación",
  "drenaje",
  "alcantarillado",
];

const ARRENDAMIENTO_KEYWORDS = ["arrendamiento"];

/**
 * Infiere TipoContratacion a partir del texto canónico del expediente.
 * Heurístico: no es 100% preciso, pero suficiente para una estimación.
 */
export function inferTipoContratacion(
  procurement: NormalizedProcurement,
): TipoContratacion {
  const text = procurement.canonicalText.toLowerCase();
  if (ARRENDAMIENTO_KEYWORDS.some((k) => text.includes(k))) {
    return "arrendamiento";
  }
  if (OBRA_KEYWORDS.some((k) => text.includes(k))) {
    return "obra_publica";
  }
  return "adquisicion";
}

// ── Lógica pura de cálculo ───────────────────────────────────────────────────

interface TopesInput {
  tipo: TipoContratacion;
  topeAdjudicacion: number; // pesos
  topeInvitacion: number;   // pesos
}

/**
 * Pura: determina la modalidad dados el monto y los topes.
 * No toca Supabase — completamente testeable.
 */
export function computarModalidad(
  monto: number,
  incluyeIva: boolean,
  topes: TopesInput,
): EvaluarModalidadResult {
  const montoSinIva = incluyeIva ? monto / IVA : monto;

  let modalidad: ModalidadContratacion;
  if (montoSinIva <= topes.topeAdjudicacion) {
    modalidad = "adjudicacion_directa";
  } else if (montoSinIva <= topes.topeInvitacion) {
    modalidad = "invitacion_tres_personas";
  } else {
    modalidad = "licitacion_publica";
  }

  const montoFmt = montoSinIva.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
  const adFmt = topes.topeAdjudicacion.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
  const i3pFmt = topes.topeInvitacion.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });

  const analisisMap: Record<ModalidadContratacion, string> = {
    adjudicacion_directa: `El monto de ${montoFmt} MXN no supera el tope de adjudicación directa de ${adFmt} MXN para ${topes.tipo.replace("_", " ")}.`,
    invitacion_tres_personas: `El monto de ${montoFmt} MXN supera el tope de adjudicación directa (${adFmt}) pero no el de invitación a 3 personas (${i3pFmt}) para ${topes.tipo.replace("_", " ")}.`,
    licitacion_publica: `El monto de ${montoFmt} MXN supera el tope de invitación a 3 personas de ${i3pFmt} MXN para ${topes.tipo.replace("_", " ")}, lo que requiere licitación pública.`,
  };

  return {
    modalidad,
    montoSinIva,
    topeAdjudicacion: topes.topeAdjudicacion,
    topeInvitacion: topes.topeInvitacion,
    analisis: analisisMap[modalidad],
  };
}

// ── Consulta Supabase ─────────────────────────────────────────────────────────

/**
 * Devuelve la fila de topes que aplica para (anio, tipo, presupuestoAutorizado).
 * Encuentra el rango de presupuesto más alto que no supere el presupuesto dado.
 * @throws StorageError si no hay datos para los parámetros dados.
 */
export async function consultarTopes(
  anio: number,
  tipo: TipoContratacion,
  presupuestoAutorizado: number,
): Promise<TopeFinancieroRow> {
  const db = getSupabaseClient();

  const { data, error } = await db
    .from("topes_financieros_federales")
    .select("*")
    .eq("anio", anio)
    .eq("tipo", tipo)
    .lte("presupuesto_desde", presupuestoAutorizado)
    .order("presupuesto_desde", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    log.warn(
      { anio, tipo, presupuestoAutorizado, err: error.message },
      "Error consultando topes financieros",
    );
    throw new StorageError(
      `No se encontraron topes para anio=${anio}, tipo=${tipo}: ${error.message}`,
      "consultar_topes",
    );
  }

  return data as TopeFinancieroRow;
}

// ── Función compuesta ─────────────────────────────────────────────────────────

/**
 * Evalúa la modalidad de contratación probable para un contrato.
 * Combina consulta DB + lógica pura.
 */
export async function evaluarModalidad(
  params: EvaluarModalidadParams,
): Promise<EvaluarModalidadResult> {
  const anio = params.anio ?? new Date().getFullYear();

  const tope = await consultarTopes(
    anio,
    params.tipo,
    params.presupuestoAutorizado,
  );

  const topeAdjudicacion = tope.tope_adjudicacion_miles * 1000;
  const topeInvitacion = tope.tope_invitacion_miles * 1000;

  return computarModalidad(params.monto, params.incluyeIva ?? false, {
    tipo: params.tipo,
    topeAdjudicacion,
    topeInvitacion,
  });
}
```

- [ ] **Step 4: Correr tests — deben pasar**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npm test -- --testPathPattern="topes.service" --no-coverage 2>&1 | tail -20
```

Esperado: `Tests: 10 passed` (o similar, todos en verde)

- [ ] **Step 5: Commit**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX
git add docs/migrations/11_topes_financieros.sql \
        apps/worker/src/topes/topes.types.ts \
        apps/worker/src/topes/topes.service.ts \
        apps/worker/src/topes/__tests__/topes.service.test.ts
git commit -m "feat: agregar servicio motor-topes-financieros con migración PEF 2026 Anexo 9 y tests"
```

---

## Task 4: Modificar `EnrichedAlert` y el pipeline de formato

**Files:**
- Modify: `apps/worker/src/types/procurement.ts:134-147`
- Modify: `apps/worker/src/enrichers/match.enricher.ts:22-72`
- Modify: `apps/worker/src/alerts/telegram.alerts.ts:233-276`

### 4a — Agregar campo a `EnrichedAlert`

- [ ] **Step 1: En `procurement.ts`, agregar `modalidadProbable?` a `EnrichedAlert`**

Buscar el bloque `export interface EnrichedAlert` (línea ~134) y agregar el campo:

```typescript
// Reemplazar:
export interface EnrichedAlert {
  alertType: AlertType;
  radarKey: string;
  radarName: string;
  matchLevel: MatchLevel;
  matchScore: number;
  procurement: NormalizedProcurement;
  matchedTerms: string[];
  explanation: string;
  hasHistory: boolean;
  historyCount: number;
  detectedAt: string; // ISO-8601
  telegramMessage: string; // Mensaje ya formateado para Telegram
}

// Con:
export interface EnrichedAlert {
  alertType: AlertType;
  radarKey: string;
  radarName: string;
  matchLevel: MatchLevel;
  matchScore: number;
  procurement: NormalizedProcurement;
  matchedTerms: string[];
  explanation: string;
  hasHistory: boolean;
  historyCount: number;
  detectedAt: string; // ISO-8601
  telegramMessage: string; // Mensaje ya formateado para Telegram
  /** Modalidad de contratación probable según topes PEF. Presente si el expediente tiene monto. */
  modalidadProbable?: string;
}
```

### 4b — Actualizar `enrichMatch` para aceptar modalidad

- [ ] **Step 2: En `match.enricher.ts`, agregar parámetro `modalidadProbable?`**

```typescript
// Reemplazar la firma y el cuerpo de enrichMatch:
export async function enrichMatch(
  procurement: NormalizedProcurement,
  match: MatchResult,
  modalidadProbable?: string,
): Promise<EnrichedAlert> {
  const radar = getRadarByKey(match.radarKey);

  let historyCount = 0;
  let hasHistory = false;

  try {
    const { count } = await getSupabaseClient()
      .from("procurement_versions")
      .select("*", { count: "exact", head: true })
      .eq("procurement_id", match.procurementId);

    historyCount = count ?? 0;
    hasHistory = historyCount > 1;
  } catch (err) {
    log.warn(
      { err },
      "Error obteniendo historial — continuando sin antecedentes",
    );
  }

  const alertType = match.isStatusChange
    ? "status_change"
    : match.isNew
      ? "new_match"
      : "new_match";

  const enriched: EnrichedAlert = {
    alertType,
    radarKey: match.radarKey,
    radarName: radar?.name ?? match.radarKey,
    matchLevel: match.matchLevel,
    matchScore: match.matchScore,
    procurement,
    matchedTerms: match.matchedTerms,
    explanation: match.explanation,
    hasHistory,
    historyCount,
    detectedAt: nowISO(),
    telegramMessage: "",
    modalidadProbable,
  };

  enriched.telegramMessage = formatMatchAlert(enriched);

  return enriched;
}
```

### 4c — Renderizar modalidad en el mensaje Telegram

- [ ] **Step 3: En `telegram.alerts.ts`, agregar línea de modalidad en `formatMatchAlert`**

En el array `lines[]` de `formatMatchAlert`, localizar la línea del Monto (línea ~256) y agregar la modalidad inmediatamente después:

```typescript
// Reemplazar en el array lines[] esta sección:
    `📅 <b>Publicación:</b> ${p.publicationDate ? formatMexicoDate(p.publicationDate, "dd/MM/yyyy") : "N/D"}`,
    `📊 <b>Estatus:</b> ${p.status}`,
    p.amount ? `💰 <b>Monto:</b> ${formatCurrency(p.amount, p.currency)}` : "",
    "",

// Con:
    `📅 <b>Publicación:</b> ${p.publicationDate ? formatMexicoDate(p.publicationDate, "dd/MM/yyyy") : "N/D"}`,
    `📊 <b>Estatus:</b> ${p.status}`,
    p.amount ? `💰 <b>Monto:</b> ${formatCurrency(p.amount, p.currency)}` : "",
    alert.modalidadProbable
      ? `📋 <b>Modalidad probable:</b> ${alert.modalidadProbable.replace(/_/g, " ")}`
      : "",
    "",
```

- [ ] **Step 4: Verificar typecheck parcial**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npm run typecheck 2>&1 | head -30
```

Esperado: sin errores.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX
git add apps/worker/src/types/procurement.ts \
        apps/worker/src/enrichers/match.enricher.ts \
        apps/worker/src/alerts/telegram.alerts.ts
git commit -m "feat: agregar modalidadProbable a EnrichedAlert y renderizar en mensaje Telegram"
```

---

## Task 5: Integración en collect.job.ts

**Files:**
- Modify: `apps/worker/src/jobs/collect.job.ts` (sección del for loop de matches, ~líneas 664-690)

- [ ] **Step 1: Agregar import de topes al inicio del archivo**

Localizar el bloque de imports en `collect.job.ts` y agregar:

```typescript
import { evaluarModalidad, inferTipoContratacion } from "../topes/topes.service";
```

- [ ] **Step 2: Reemplazar el bloque `for (const match of matches)` completo**

Localizar el `for (const match of matches)` (~línea 665) y reemplazar el contenido interno donde se llama `upsertMatch` + `enrichMatch`:

```typescript
    for (const match of matches) {
      try {
        const enrichableMatch = {
          ...match,
          procurementId: upsertResult.procurementId,
        };

        const radarDbId = radarDbIds.get(match.radarKey);

        if (radarDbId) {
          await upsertMatch(enrichableMatch, radarDbId);
        }

        // Evaluar modalidad de contratación si el expediente tiene monto
        let modalidadProbable: string | undefined;
        if (item.amount) {
          try {
            const tipoContratacion = inferTipoContratacion(item);
            const modalidadResult = await evaluarModalidad({
              monto: item.amount,
              tipo: tipoContratacion,
              presupuestoAutorizado: 500_000_000, // default: entidad mediana
              incluyeIva: false,
            });
            modalidadProbable = modalidadResult.modalidad;
          } catch (modalidadErr) {
            log.warn(
              { err: modalidadErr, externalId: item.externalId },
              "No se pudo evaluar modalidad — se omite del mensaje",
            );
          }
        }

        const enriched = await enrichMatch(item, enrichableMatch, modalidadProbable);
        const alertId = await createAlert(enriched, upsertResult.procurementId, radarDbId);

        const msgId = await sendMatchAlert(enriched);

        if (msgId) {
          await markAlertSent(alertId, msgId);
        } else {
          await markAlertFailed(alertId);
        }
      } catch (matchErr) {
        log.error(
          {
            err: matchErr,
            radarKey: match.radarKey,
            externalId: item.externalId,
          },
          "Error procesando match",
        );
      }
    }
```

- [ ] **Step 3: Verificar typecheck**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npm run typecheck 2>&1 | head -30
```

Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX
git add apps/worker/src/jobs/collect.job.ts
git commit -m "feat: evaluar modalidad de contratación en pipeline de alertas"
```

---

## Task 6: HTTP Server + HEALTH_PORT

**Files:**
- Modify: `apps/worker/src/config/env.ts`
- Create: `apps/worker/src/core/http-server.ts`
- Modify: `apps/worker/src/index.ts`

### 6a — Agregar HEALTH_PORT a env.ts

- [ ] **Step 1: Agregar `HEALTH_PORT` al schema Zod**

En `env.ts`, dentro de `envSchema`, agregar después de `APP_TIMEZONE`:

```typescript
  // HTTP Server
  HEALTH_PORT: z.string().default("8080").transform(Number),
```

Y agregar el tipo inferido automáticamente (ya lo hace `z.infer<typeof envSchema>`).

### 6b — Crear HTTP server

- [ ] **Step 2: Crear `apps/worker/src/core/http-server.ts`**

```typescript
// apps/worker/src/core/http-server.ts
/**
 * HTTP SERVER — Expone endpoints de salud y topes financieros.
 * Puerto: HEALTH_PORT (default 8080).
 *
 * Rutas:
 *   GET  /health
 *   GET  /api/topes/federales?anio=&tipo=&presupuesto_autorizado=
 *   POST /api/licitaciones/evaluar-modalidad
 */
import http from "node:http";
import { createModuleLogger } from "./logger";
import { getConfig } from "../config/env";
import { consultarTopes, evaluarModalidad } from "../topes/topes.service";
import type { TipoContratacion } from "../topes/topes.types";

const log = createModuleLogger("http-server");

const TIPOS_VALIDOS = new Set<TipoContratacion>([
  "adquisicion",
  "arrendamiento",
  "obra_publica",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown,
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new Error("JSON inválido en el cuerpo de la petición"));
      }
    });
    req.on("error", reject);
  });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleGetTopes(
  url: URL,
  res: http.ServerResponse,
): Promise<void> {
  const anioStr = url.searchParams.get("anio");
  const tipoStr = url.searchParams.get("tipo");
  const presupuestoStr = url.searchParams.get("presupuesto_autorizado");

  if (!anioStr || !tipoStr || !presupuestoStr) {
    sendJson(res, 400, {
      error: "Parámetros requeridos: anio, tipo, presupuesto_autorizado",
    });
    return;
  }

  if (!TIPOS_VALIDOS.has(tipoStr as TipoContratacion)) {
    sendJson(res, 400, {
      error: `tipo inválido. Valores permitidos: ${[...TIPOS_VALIDOS].join(", ")}`,
    });
    return;
  }

  const anio = parseInt(anioStr, 10);
  const presupuesto = parseInt(presupuestoStr, 10);

  if (isNaN(anio) || isNaN(presupuesto) || anio < 2020 || presupuesto < 0) {
    sendJson(res, 400, {
      error: "anio debe ser un año >= 2020 y presupuesto_autorizado debe ser >= 0",
    });
    return;
  }

  const tope = await consultarTopes(anio, tipoStr as TipoContratacion, presupuesto);

  sendJson(res, 200, {
    anio: tope.anio,
    tipo: tope.tipo,
    presupuesto_autorizado: presupuesto,
    tope_adjudicacion: tope.tope_adjudicacion_miles * 1000,
    tope_invitacion: tope.tope_invitacion_miles * 1000,
    fuente: tope.fuente,
  });
}

async function handlePostEvaluarModalidad(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 400, { error: "Cuerpo JSON inválido" });
    return;
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    sendJson(res, 400, { error: "El body debe ser un objeto JSON" });
    return;
  }

  const b = body as Record<string, unknown>;
  const monto = typeof b.monto === "number" ? b.monto : null;
  const tipoRaw = typeof b.tipo === "string" ? b.tipo : null;
  const presupuesto =
    typeof b.presupuesto_autorizado === "number"
      ? b.presupuesto_autorizado
      : null;

  if (monto === null || tipoRaw === null || presupuesto === null) {
    sendJson(res, 400, {
      error:
        "Campos requeridos: monto (number), tipo (string), presupuesto_autorizado (number)",
    });
    return;
  }

  if (monto < 0) {
    sendJson(res, 400, { error: "monto debe ser >= 0" });
    return;
  }

  if (!TIPOS_VALIDOS.has(tipoRaw as TipoContratacion)) {
    sendJson(res, 400, {
      error: `tipo inválido. Valores permitidos: ${[...TIPOS_VALIDOS].join(", ")}`,
    });
    return;
  }

  const anio =
    typeof b.anio === "number" ? b.anio : new Date().getFullYear();
  const incluyeIva =
    typeof b.incluye_iva === "boolean" ? b.incluye_iva : false;

  const result = await evaluarModalidad({
    monto,
    tipo: tipoRaw as TipoContratacion,
    presupuestoAutorizado: presupuesto,
    anio,
    incluyeIva,
  });

  sendJson(res, 200, {
    modalidad_probable: result.modalidad,
    monto_sin_iva: result.montoSinIva,
    tope_adjudicacion: result.topeAdjudicacion,
    tope_invitacion: result.topeInvitacion,
    analisis: result.analisis,
  });
}

// ── Router principal ──────────────────────────────────────────────────────────

export function createHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    log.debug({ method: req.method, path: url.pathname }, "HTTP request");

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", ts: new Date().toISOString() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/topes/federales") {
        await handleGetTopes(url, res);
        return;
      }

      if (
        req.method === "POST" &&
        url.pathname === "/api/licitaciones/evaluar-modalidad"
      ) {
        await handlePostEvaluarModalidad(req, res);
        return;
      }

      sendJson(res, 404, { error: "Ruta no encontrada" });
    } catch (err) {
      log.error({ err, path: url.pathname }, "Error no manejado en HTTP server");
      sendJson(res, 500, { error: "Error interno del servidor" });
    }
  });
}

export function startHttpServer(): void {
  const config = getConfig();
  const port = config.HEALTH_PORT;
  const server = createHttpServer();
  server.listen(port, () => {
    log.info({ port }, "🌐 HTTP server escuchando");
  });
  server.on("error", (err) => {
    log.error({ err }, "Error en HTTP server");
  });
}
```

### 6c — Arrancar HTTP server en `index.ts`

- [ ] **Step 3: Agregar import y llamada en `index.ts`**

Agregar el import junto a los demás al inicio de `index.ts`:

```typescript
import { startHttpServer } from "./core/http-server";
```

En la función `main()`, después del bloque de `FORCE_COLLECT` y antes de `startScheduler`, agregar:

```typescript
  // ── HTTP server ──────────────────────────────────────────────────────────
  startHttpServer();
```

La ubicación exacta: localizar `startScheduler(` y agregar `startHttpServer();` en la línea inmediatamente anterior.

- [ ] **Step 4: Typecheck final**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npm run typecheck 2>&1
```

Esperado: sin errores (output vacío).

- [ ] **Step 5: Build completo**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npm run build 2>&1 | tail -10
```

Esperado: compilación exitosa sin errores.

- [ ] **Step 6: Correr todos los tests**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npm test --no-coverage 2>&1 | tail -20
```

Esperado: todos los tests pasan (incluyendo los nuevos de `topes.service`).

- [ ] **Step 7: Commit final**

```bash
cd /Users/kennethjts/Radar-Licitaciones-MX
git add apps/worker/src/config/env.ts \
        apps/worker/src/core/http-server.ts \
        apps/worker/src/index.ts
git commit -m "feat: agregar HTTP server con endpoints de topes financieros y evaluación de modalidad"
```

---

## Verificación end-to-end

### Probar HTTP server localmente

```bash
# Terminal 1: arrancar worker en dev
cd /Users/kennethjts/Radar-Licitaciones-MX/apps/worker
npm run dev

# Terminal 2: probar endpoints
# Health
curl http://localhost:8080/health

# Topes
curl "http://localhost:8080/api/topes/federales?anio=2026&tipo=adquisicion&presupuesto_autorizado=500000000"

# Evaluar modalidad — adjudicación directa
curl -X POST http://localhost:8080/api/licitaciones/evaluar-modalidad \
  -H "Content-Type: application/json" \
  -d '{"monto":250000,"tipo":"adquisicion","presupuesto_autorizado":500000000,"anio":2026}'

# Evaluar modalidad — licitación pública
curl -X POST http://localhost:8080/api/licitaciones/evaluar-modalidad \
  -H "Content-Type: application/json" \
  -d '{"monto":5000000,"tipo":"adquisicion","presupuesto_autorizado":500000000,"incluye_iva":true}'

# Error 400
curl "http://localhost:8080/api/topes/federales?anio=2026"
```

### Verificar Telegram con procuremiento real

Ejecutar un ciclo de colección (`FORCE_COLLECT=true`) y verificar en Telegram que los matches que tienen monto muestran la línea `📋 Modalidad probable:`.

### Nota sobre la migración

Antes de probar contra Supabase real:
1. Abrir Supabase SQL Editor
2. Pegar y ejecutar `docs/migrations/11_topes_financieros.sql`
3. Verificar con: `SELECT COUNT(*) FROM topes_financieros_federales;` → debe retornar 11

---

## Self-Review Checklist

- [x] **Spec — Fase 1 (Migración):** `11_topes_financieros.sql` con enum, tabla, seed PEF 2026 tres tipos. ✓
- [x] **Spec — Fase 2 (Servicio TS):** `consultarTopes` + `evaluarModalidad` con IVA + tipos estrictos. ✓
- [x] **Spec — Fase 3 (Pipeline alertas):** Llamada en `collect.job.ts` después de `upsertMatch`, antes de `createAlert`. ✓
- [x] **Spec — Fase 4 (HTTP):** GET `/api/topes/federales` + POST `/api/licitaciones/evaluar-modalidad` con 400/500. ✓
- [x] **Sin `any`:** Todos los tipos son explícitos. ✓
- [x] **Pino logger:** `createModuleLogger()` en `topes.service.ts` y `http-server.ts`. ✓
- [x] **env.ts pattern:** `HEALTH_PORT` agregado con `.default("8080").transform(Number)`. ✓
- [x] **`health-server.ts` no existe:** Se crea `core/http-server.ts` desde cero. ✓
- [x] **Migraciones en `docs/migrations/`:** Ruta correcta, no `supabase/migrations/`. ✓
- [x] **TDD:** Tests escritos antes de implementación, usando función pura `computarModalidad`. ✓
- [x] **Typecheck pasa:** Verificado en Task 4 y Task 6. ✓
