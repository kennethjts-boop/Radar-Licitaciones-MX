# Fase G — Motores de inteligencia contractual

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar motores de similitud contractual (G1) y estimación de techo presupuestal (G2), integrarlos en el pipeline de enriquecimiento (G3), y exponer los resultados en el endpoint HTTP de ficha (G4).

**Architecture:** G1 calcula similitud Jaccard entre la licitación actual y los contratos históricos de las tres fuentes de Fase F. G2 usa los similares + señales directas de E6 para estimar un techo en tres niveles (directo > inferido > sin evidencia). G3 añade pasos 5d y 5e al pipeline y extiende el mensaje Telegram. G4 extrae la lógica de mapeo de datos de enriquecimiento en una función pura y la conecta al endpoint `/api/licitaciones/:id/ficha`.

**Tech Stack:** TypeScript strict / Jest + ts-jest / sin embeddings (análisis léxico puro) / `node:http` nativo para el servidor

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `src/services/procurement-similarity-engine.ts` | Crear | Jaccard similarity sobre HistoricoContract[] + SipotContract[] + OcdsContract[] |
| `src/services/budget-ceiling-engine.ts` | Crear | Estimación techo en 3 niveles |
| `src/services/__tests__/procurement-similarity-engine.test.ts` | Crear | 6 tests |
| `src/services/__tests__/budget-ceiling-engine.test.ts` | Crear | 6 tests |
| `src/jobs/enrich-procurement.job.ts` | Modificar | Añadir imports G1+G2, pasos 5d y 5e, pasar a formatEnrichedAlert |
| `src/alerts/telegram.alerts.ts` | Modificar | Añadir `ceilingEstimate?` + `similarContracts?` a EnrichedAlertData; renderizar en ambas ramas |
| `src/alerts/__tests__/telegram.enriched.test.ts` | Modificar | +4 tests |
| `src/jobs/__tests__/enrich-procurement.test.ts` | Modificar | +2 tests |
| `src/core/http-server.ts` | Modificar | Exportar `mapEnrichmentToSections`, usarla en handleGetFicha |
| `src/core/__tests__/http-server.test.ts` | Crear | 3 tests de `mapEnrichmentToSections` |

---

## Context crítico para subagentes

### telegram.alerts.ts — estructura actual de formatEnrichedAlert

Dos ramas. Cada rama termina con `escapeHtml` disponible en scope. `formatCurrency` ya importado desde `../core/text`.

**Rama sin-docs** (líneas 519-566): `const lines = [...]` → budgetSignal → antecedentes → **INSERT AQUÍ** → errors → disclaimer → return.

**Rama con-docs** (líneas 589-641): `const lines: string[] = [...]` → budgetSignal → antecedentes → **INSERT AQUÍ** → errors → disclaimer → return.

La sección a insertar en AMBAS ramas (misma indentación que los bloques antecedentes adyacentes):

```typescript
    if (data.ceilingEstimate !== undefined) {
      const ce = data.ceilingEstimate;
      lines.push("");
      lines.push("📈 <b>Estimación presupuestal:</b>");
      if (ce.directCeiling !== null && ce.directCeiling > 0) {
        lines.push(`  💰 Techo directo: ${formatCurrency(ce.directCeiling, "MXN")} (Alta confianza)`);
      } else if (ce.estimatedMin !== null && ce.estimatedMax !== null) {
        lines.push(`  📊 Rango estimado: ${formatCurrency(ce.estimatedMin, "MXN")} — ${formatCurrency(ce.estimatedMax, "MXN")}`);
        if (ce.average !== null) {
          lines.push(`  📊 Promedio histórico: ${formatCurrency(ce.average, "MXN")}`);
        }
        const confLabel = ce.confidence === "alta" ? "Alta" : ce.confidence === "media" ? "Media" : "Baja";
        lines.push(`  🎯 Confianza: ${confLabel}`);
      } else {
        lines.push("  Sin estimación disponible.");
      }
    }

    if (data.similarContracts !== undefined) {
      const sim = data.similarContracts;
      lines.push("");
      lines.push(`🔗 <b>Contratos similares (${sim.length}):</b>`);
      if (sim.length === 0) {
        lines.push("  Sin contratos similares encontrados.");
      } else {
        for (const s of sim.slice(0, 3)) {
          const t = (s.title ?? "Sin título").slice(0, 60);
          const amt =
            s.awardedAmount !== null && s.awardedAmount > 0
              ? formatCurrency(s.awardedAmount, "MXN")
              : "N/D";
          const yr = s.year !== null ? String(s.year) : "N/D";
          lines.push(`  • ${escapeHtml(t)} — ${amt} (${yr}) [${s.source}]`);
        }
      }
    }

    if (data.ceilingEstimate !== undefined || data.similarContracts !== undefined) {
      lines.push("");
      lines.push(
        `⚖️ <i>${escapeHtml(
          data.ceilingEstimate?.legalWarning ??
            "Estimación basada únicamente en información pública.",
        )}</i>`,
      );
    }
```

### enrich-procurement.job.ts — punto de inserción G3

Insertar **después de la línea** `"📊 Antecedentes encontrados",` (el log.info de step 5c) y **antes de** `log.info({ jobId, status, ...}, "✅ enrichProcurement completado")`.

---

## Task G1: procurement-similarity-engine.ts

**Files:**
- Create: `src/services/__tests__/procurement-similarity-engine.test.ts`
- Create: `src/services/procurement-similarity-engine.ts`

- [ ] **Step 1: Escribir el test**

```typescript
// src/services/__tests__/procurement-similarity-engine.test.ts
import { findSimilarProcurements } from "../procurement-similarity-engine";
import type { SimilarityInput } from "../procurement-similarity-engine";
import type { HistoricoContract } from "../../collectors/compranet-historico/index";

function makeHistorico(overrides: Partial<HistoricoContract> = {}): HistoricoContract {
  return {
    procedureNumber: "LPN-001",
    title: "Mantenimiento vial carreteras Morelos",
    dependency: "SCT",
    supplier: "Constructora ABC",
    awardedAmount: 1500000,
    currency: "MXN",
    year: 2023,
    state: "Morelos",
    contractType: "LP",
    sourceUrl: "https://example.com",
    retrievedAt: "2026-05-07T00:00:00Z",
    ...overrides,
  };
}

const baseInput: SimilarityInput = {
  title: "Mantenimiento de carreteras en Morelos",
  dependency: "SCT",
  state: "Morelos",
  contractType: "LP",
  keywords: ["mantenimiento", "carreteras"],
  scope: "MORELOS_ONLY",
  historico: [],
  sipot: [],
  ocds: [],
};

describe("findSimilarProcurements", () => {
  it("retorna contrato similar cuando Jaccard >= 0.15", async () => {
    const result = await findSimilarProcurements({
      ...baseInput,
      historico: [makeHistorico()],
    });
    expect(result.similarProcedures).toHaveLength(1);
    expect(result.similarProcedures[0].similarityScore).toBeGreaterThanOrEqual(0.15);
    expect(result.similarProcedures[0].source).toBe("compranet-historico");
  });

  it("excluye contrato con similarityScore < 0.15", async () => {
    const result = await findSimilarProcurements({
      ...baseInput,
      historico: [makeHistorico({ title: "Adquisición equipos cómputo Chihuahua" })],
    });
    expect(result.similarProcedures).toHaveLength(0);
  });

  it("aplica bonus de dependencia (+0.1) — score mayor cuando coincide", async () => {
    const withMatch = await findSimilarProcurements({
      ...baseInput,
      historico: [makeHistorico({ dependency: "SCT" })],
    });
    const withoutMatch = await findSimilarProcurements({
      ...baseInput,
      historico: [makeHistorico({ dependency: "IMSS" })],
    });
    // withMatch should score higher than withoutMatch (if both pass threshold)
    const scoreWith = withMatch.similarProcedures[0]?.similarityScore ?? 0;
    const scoreWithout = withoutMatch.similarProcedures[0]?.similarityScore ?? 0;
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it("retorna máximo 10 resultados", async () => {
    const manyContracts = Array.from({ length: 15 }, (_, i) =>
      makeHistorico({ procedureNumber: `LPN-${i}` }),
    );
    const result = await findSimilarProcurements({ ...baseInput, historico: manyContracts });
    expect(result.similarProcedures.length).toBeLessThanOrEqual(10);
  });

  it("retorna vacío cuando no hay contratos en ninguna fuente", async () => {
    const result = await findSimilarProcurements(baseInput);
    expect(result.similarProcedures).toHaveLength(0);
    expect(result.totalFound).toBe(0);
  });

  it("ordena por similarityScore descendente", async () => {
    const result = await findSimilarProcurements({
      ...baseInput,
      historico: [
        makeHistorico({ title: "Mantenimiento vial carreteras Morelos 2023", dependency: "SCT" }),
        makeHistorico({ title: "Obra de infraestructura municipal diferente", dependency: "IMSS" }),
      ],
    });
    if (result.similarProcedures.length >= 2) {
      expect(result.similarProcedures[0].similarityScore).toBeGreaterThanOrEqual(
        result.similarProcedures[1].similarityScore,
      );
    }
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/services/__tests__/procurement-similarity-engine.test.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '../procurement-similarity-engine'"

- [ ] **Step 3: Escribir la implementación**

```typescript
// src/services/procurement-similarity-engine.ts
/**
 * PROCUREMENT SIMILARITY ENGINE — Calcula similitud textual (Jaccard) entre
 * la licitación actual y contratos históricos de tres fuentes públicas.
 * Sin embeddings; análisis léxico puro.
 */
import type { HistoricoContract } from "../collectors/compranet-historico/index";
import type { SipotContract } from "../collectors/pnt-sipot/index";
import type { OcdsContract } from "../collectors/contrataciones-abiertas/index";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface SimilarityInput {
  title: string | null;
  dependency: string | null;
  state: string | null;
  contractType: string | null;
  keywords: string[];
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  historico: HistoricoContract[];
  sipot: SipotContract[];
  ocds: OcdsContract[];
}

export interface SimilarProcedure {
  procedureId: string | null;
  source: "compranet-historico" | "pnt-sipot" | "contrataciones-abiertas";
  title: string | null;
  similarityScore: number;
  reason: string;
  awardedAmount: number | null;
  supplier: string | null;
  year: number | null;
  evidenceUrl: string | null;
}

export interface SimilarityResult {
  similarProcedures: SimilarProcedure[];
  totalFound: number;
  scopeApplied: string;
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "para", "con", "los", "las", "del", "que", "por", "una", "sus",
  "en", "de", "la", "el", "al", "se", "un", "es", "más",
]);
const MIN_SCORE = 0.15;
const MAX_RESULTS = 10;
const DEP_BONUS = 0.1;
const STATE_BONUS = 0.1;

// ── Helpers ────────────────────────────────────────────────────────────────────

function tokenize(text: string | null): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface CandidateContract {
  procedureId: string | null;
  source: SimilarProcedure["source"];
  title: string | null;
  dependency: string | null;
  state: string | null;
  awardedAmount: number | null;
  supplier: string | null;
  year: number | null;
  evidenceUrl: string | null;
}

function normalizeCandidates(
  historico: HistoricoContract[],
  sipot: SipotContract[],
  ocds: OcdsContract[],
): CandidateContract[] {
  const h: CandidateContract[] = historico.map((c) => ({
    procedureId: c.procedureNumber,
    source: "compranet-historico" as const,
    title: c.title,
    dependency: c.dependency,
    state: c.state,
    awardedAmount: c.awardedAmount,
    supplier: c.supplier,
    year: c.year,
    evidenceUrl: c.sourceUrl,
  }));

  const s: CandidateContract[] = sipot.map((c) => ({
    procedureId: c.procedureNumber,
    source: "pnt-sipot" as const,
    title: c.title,
    dependency: c.dependency,
    state: c.state,
    awardedAmount: c.awardedAmount,
    supplier: c.supplier,
    year: c.year,
    evidenceUrl: c.sourceUrl,
  }));

  const o: CandidateContract[] = ocds.map((c) => ({
    procedureId: c.ocid ?? c.procedureNumber,
    source: "contrataciones-abiertas" as const,
    title: c.title,
    dependency: c.dependency,
    state: c.state,
    awardedAmount: c.awardedAmount,
    supplier: c.supplier,
    year: c.year,
    evidenceUrl: c.sourceUrl,
  }));

  return [...h, ...s, ...o];
}

// ── Función principal ──────────────────────────────────────────────────────────

export async function findSimilarProcurements(
  input: SimilarityInput,
): Promise<SimilarityResult> {
  const inputTokens = tokenize(input.title);
  const normalizedDep = (input.dependency ?? "").toLowerCase().trim();
  const normalizedState = (input.state ?? "").toLowerCase().trim();

  const candidates = normalizeCandidates(input.historico, input.sipot, input.ocds);

  const scored: SimilarProcedure[] = candidates
    .map((c): SimilarProcedure | null => {
      const candidateTokens = tokenize(c.title);
      let score = jaccardSimilarity(inputTokens, candidateTokens);

      const reasons: string[] = [];
      if (score > 0) reasons.push(`similitud textual ${(score * 100).toFixed(0)}%`);

      if (normalizedDep && (c.dependency ?? "").toLowerCase().trim() === normalizedDep) {
        score = Math.min(1.0, score + DEP_BONUS);
        reasons.push("misma dependencia");
      }
      if (normalizedState && (c.state ?? "").toLowerCase().trim() === normalizedState) {
        score = Math.min(1.0, score + STATE_BONUS);
        reasons.push("mismo estado");
      }

      if (score < MIN_SCORE) return null;

      return {
        procedureId: c.procedureId,
        source: c.source,
        title: c.title,
        similarityScore: Math.round(score * 1000) / 1000,
        reason: reasons.join(", ") || "coincidencia general",
        awardedAmount: c.awardedAmount,
        supplier: c.supplier,
        year: c.year,
        evidenceUrl: c.evidenceUrl,
      };
    })
    .filter((p): p is SimilarProcedure => p !== null)
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, MAX_RESULTS);

  return {
    similarProcedures: scored,
    totalFound: scored.length,
    scopeApplied: input.scope,
  };
}
```

- [ ] **Step 4: Correr tests**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/services/__tests__/procurement-similarity-engine.test.ts --no-coverage
```

Expected: PASS 6/6

- [ ] **Step 5: Typecheck + commit**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npm run typecheck 2>&1 | tail -5
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX" && git add apps/worker/src/services/procurement-similarity-engine.ts apps/worker/src/services/__tests__/procurement-similarity-engine.test.ts && git commit -m "feat: G1 — agregar procurement-similarity-engine (Jaccard textual)"
```

---

## Task G2: budget-ceiling-engine.ts

**Files:**
- Create: `src/services/__tests__/budget-ceiling-engine.test.ts`
- Create: `src/services/budget-ceiling-engine.ts`

- [ ] **Step 1: Escribir el test**

```typescript
// src/services/__tests__/budget-ceiling-engine.test.ts
import { estimateBudgetCeiling } from "../budget-ceiling-engine";
import type { CeilingInput } from "../budget-ceiling-engine";
import type { SimilarProcedure } from "../procurement-similarity-engine";

function makeSimilar(amount: number): SimilarProcedure {
  return {
    procedureId: "LP-001",
    source: "compranet-historico",
    title: "Mantenimiento vial",
    similarityScore: 0.8,
    reason: "similitud textual 80%",
    awardedAmount: amount,
    supplier: "Empresa SA",
    year: 2023,
    evidenceUrl: null,
  };
}

const baseInput: CeilingInput = {
  directCeilingFound: false,
  directCeilingAmount: null,
  budgetSignals: [],
  similarProcedures: [],
  title: "Mantenimiento vial",
  dependency: "SCT",
};

describe("estimateBudgetCeiling", () => {
  it("nivel 1: retorna directCeiling cuando está disponible", () => {
    const result = estimateBudgetCeiling({
      ...baseInput,
      directCeilingFound: true,
      directCeilingAmount: 2000000,
    });
    expect(result.directCeiling).toBe(2000000);
    expect(result.confidence).toBe("alta");
    expect(result.explanation).toContain("Techo localizado directamente");
  });

  it("nivel 2: calcula min/max/average/median de similares", () => {
    const result = estimateBudgetCeiling({
      ...baseInput,
      similarProcedures: [makeSimilar(1000000), makeSimilar(2000000), makeSimilar(3000000)],
    });
    expect(result.estimatedMin).toBe(1000000);
    expect(result.estimatedMax).toBe(3000000);
    expect(result.average).toBe(2000000);
    expect(result.median).toBe(2000000);
    expect(result.confidence).toBe("media");
  });

  it("nivel 2: confidence baja con 1 similar, alta con 4+", () => {
    const one = estimateBudgetCeiling({ ...baseInput, similarProcedures: [makeSimilar(500000)] });
    expect(one.confidence).toBe("baja");

    const four = estimateBudgetCeiling({
      ...baseInput,
      similarProcedures: [makeSimilar(100000), makeSimilar(200000), makeSimilar(300000), makeSimilar(400000)],
    });
    expect(four.confidence).toBe("alta");
  });

  it("nivel 3: todos null cuando no hay evidencia", () => {
    const result = estimateBudgetCeiling(baseInput);
    expect(result.directCeiling).toBeNull();
    expect(result.estimatedMin).toBeNull();
    expect(result.estimatedMax).toBeNull();
    expect(result.confidence).toBe("baja");
    expect(result.explanation).toContain("Sin evidencia");
  });

  it("legalWarning siempre presente", () => {
    const result = estimateBudgetCeiling(baseInput);
    expect(result.legalWarning).toContain("información pública");
  });

  it("ignora similares con awardedAmount null o 0", () => {
    const result = estimateBudgetCeiling({
      ...baseInput,
      similarProcedures: [
        makeSimilar(0),
        { ...makeSimilar(0), awardedAmount: null },
      ],
    });
    expect(result.estimatedMin).toBeNull();
    expect(result.confidence).toBe("baja");
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/services/__tests__/budget-ceiling-engine.test.ts --no-coverage 2>&1 | tail -5
```

- [ ] **Step 3: Escribir la implementación**

```typescript
// src/services/budget-ceiling-engine.ts
/**
 * BUDGET CEILING ENGINE — Estima el techo presupuestal de una licitación
 * usando 3 niveles: techo directo > inferido de similares > sin evidencia.
 */
import type { BudgetSignal } from "./budget-signal-extractor";
import type { SimilarProcedure } from "./procurement-similarity-engine";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface CeilingInput {
  directCeilingFound: boolean;
  directCeilingAmount: number | null;
  budgetSignals: BudgetSignal[];
  similarProcedures: SimilarProcedure[];
  title: string | null;
  dependency: string | null;
}

export interface CeilingResult {
  directCeiling: number | null;
  estimatedMin: number | null;
  estimatedMax: number | null;
  average: number | null;
  median: number | null;
  confidence: "baja" | "media" | "alta";
  evidence: string[];
  explanation: string;
  legalWarning: string;
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const LEGAL_WARNING =
  "Estimación basada únicamente en información pública. No representa " +
  "monto oficial salvo que el documento lo indique expresamente.";

// ── Helpers ────────────────────────────────────────────────────────────────────

function calcMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function calcAverage(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ── Función principal ──────────────────────────────────────────────────────────

export function estimateBudgetCeiling(input: CeilingInput): CeilingResult {
  const base: CeilingResult = {
    directCeiling: null,
    estimatedMin: null,
    estimatedMax: null,
    average: null,
    median: null,
    confidence: "baja",
    evidence: [],
    explanation: "Sin evidencia suficiente para estimar techo presupuestal.",
    legalWarning: LEGAL_WARNING,
  };

  // NIVEL 1 — Techo directo en documento
  if (
    input.directCeilingFound &&
    input.directCeilingAmount !== null &&
    input.directCeilingAmount > 0
  ) {
    return {
      ...base,
      directCeiling: input.directCeilingAmount,
      confidence: "alta",
      evidence: [`Techo directo: ${input.directCeilingAmount}`],
      explanation: "Techo localizado directamente en documento oficial.",
    };
  }

  // NIVEL 2 — Inferido de contratos similares
  const amounts = input.similarProcedures
    .map((s) => s.awardedAmount ?? 0)
    .filter((a) => a > 0);

  if (amounts.length > 0) {
    const confidence: CeilingResult["confidence"] =
      amounts.length >= 4 ? "alta" : amounts.length >= 2 ? "media" : "baja";
    const n = amounts.length;

    return {
      ...base,
      estimatedMin: Math.min(...amounts),
      estimatedMax: Math.max(...amounts),
      average: Math.round(calcAverage(amounts)),
      median: Math.round(calcMedian(amounts)),
      confidence,
      evidence: amounts.map((a) => `Contrato similar: ${a}`),
      explanation: `Estimación basada en ${n} contrato${n === 1 ? "" : "s"} similar${n === 1 ? "" : "es"} en fuentes públicas.`,
    };
  }

  // NIVEL 3 — Sin evidencia
  return base;
}
```

- [ ] **Step 4: Correr tests**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/services/__tests__/budget-ceiling-engine.test.ts --no-coverage
```

Expected: PASS 6/6

- [ ] **Step 5: Typecheck + commit**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npm run typecheck 2>&1 | tail -5
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX" && git add apps/worker/src/services/budget-ceiling-engine.ts apps/worker/src/services/__tests__/budget-ceiling-engine.test.ts && git commit -m "feat: G2 — agregar budget-ceiling-engine (estimación por niveles)"
```

---

## Task G3: Integration — G1+G2 en el pipeline y Telegram

**Files:**
- Modify: `src/jobs/enrich-procurement.job.ts`
- Modify: `src/alerts/telegram.alerts.ts`
- Modify: `src/alerts/__tests__/telegram.enriched.test.ts`
- Modify: `src/jobs/__tests__/enrich-procurement.test.ts`

**Read each file before modificar. Orden: tests primero (TDD).**

### Parte A — telegram.alerts.ts

- [ ] **Step 1: Añadir 4 tests a telegram.enriched.test.ts**

Leer el archivo primero. Añadir antes del cierre `});` del `describe("formatEnrichedAlert")`:

```typescript
  it("muestra sección estimación con techo directo", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      ceilingEstimate: {
        directCeiling: 3000000,
        estimatedMin: null, estimatedMax: null, average: null, median: null,
        confidence: "alta",
        evidence: [],
        explanation: "Techo localizado directamente en documento oficial.",
        legalWarning: "Estimación basada únicamente en información pública. No representa monto oficial salvo que el documento lo indique expresamente.",
      },
    });
    expect(msg).toContain("📈");
    expect(msg).toContain("Techo directo");
    expect(msg).toContain("3,000,000");
  });

  it("muestra rango estimado cuando no hay techo directo", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      ceilingEstimate: {
        directCeiling: null,
        estimatedMin: 1000000, estimatedMax: 2000000,
        average: 1500000, median: 1500000,
        confidence: "media",
        evidence: [],
        explanation: "Estimación basada en 2 contratos similares.",
        legalWarning: "Estimación basada únicamente en información pública. No representa monto oficial salvo que el documento lo indique expresamente.",
      },
    });
    expect(msg).toContain("Rango estimado");
    expect(msg).toContain("Confianza");
    expect(msg).toContain("Media");
  });

  it("muestra contratos similares cuando similarContracts tiene entradas", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      similarContracts: [{
        procedureId: "LP-001",
        source: "compranet-historico",
        title: "Mantenimiento vial 2023",
        similarityScore: 0.9,
        reason: "similitud textual",
        awardedAmount: 1500000,
        supplier: "Empresa SA",
        year: 2023,
        evidenceUrl: null,
      }],
    });
    expect(msg).toContain("🔗");
    expect(msg).toContain("Contratos similares");
    expect(msg).toContain("Mantenimiento vial 2023");
  });

  it("no muestra sección estimación si ceilingEstimate es undefined", () => {
    const msg = formatEnrichedAlert({ ...baseData });
    expect(msg).not.toContain("Estimación presupuestal");
    expect(msg).not.toContain("Contratos similares");
  });
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/alerts/__tests__/telegram.enriched.test.ts --no-coverage 2>&1 | grep "Tests:"
```

Expected: 4 tests failing.

- [ ] **Step 3: Actualizar EnrichedAlertData en telegram.alerts.ts**

Leer el archivo. Añadir después del campo `antecedentes?` (línea ~502):

```typescript
  ceilingEstimate?: import("../services/budget-ceiling-engine").CeilingResult;
  similarContracts?: import("../services/procurement-similarity-engine").SimilarProcedure[];
```

O bien, agregar imports al inicio del archivo:
```typescript
import type { CeilingResult } from "../services/budget-ceiling-engine";
import type { SimilarProcedure } from "../services/procurement-similarity-engine";
```
y en la interfaz:
```typescript
  ceilingEstimate?: CeilingResult;
  similarContracts?: SimilarProcedure[];
```

- [ ] **Step 4: Insertar bloque de rendering en la rama sin-docs**

En la rama sin-docs (`if (data.documentsFound.length === 0)`), después del bloque `antecedentes` (que termina con `}`) y **antes** del bloque `if (data.errors.length > 0)`, insertar exactamente:

```typescript
    if (data.ceilingEstimate !== undefined) {
      const ce = data.ceilingEstimate;
      lines.push("");
      lines.push("📈 <b>Estimación presupuestal:</b>");
      if (ce.directCeiling !== null && ce.directCeiling > 0) {
        lines.push(`  💰 Techo directo: ${formatCurrency(ce.directCeiling, "MXN")} (Alta confianza)`);
      } else if (ce.estimatedMin !== null && ce.estimatedMax !== null) {
        lines.push(`  📊 Rango estimado: ${formatCurrency(ce.estimatedMin, "MXN")} — ${formatCurrency(ce.estimatedMax, "MXN")}`);
        if (ce.average !== null) {
          lines.push(`  📊 Promedio histórico: ${formatCurrency(ce.average, "MXN")}`);
        }
        const confLabel = ce.confidence === "alta" ? "Alta" : ce.confidence === "media" ? "Media" : "Baja";
        lines.push(`  🎯 Confianza: ${confLabel}`);
      } else {
        lines.push("  Sin estimación disponible.");
      }
    }

    if (data.similarContracts !== undefined) {
      const sim = data.similarContracts;
      lines.push("");
      lines.push(`🔗 <b>Contratos similares (${sim.length}):</b>`);
      if (sim.length === 0) {
        lines.push("  Sin contratos similares encontrados.");
      } else {
        for (const s of sim.slice(0, 3)) {
          const t = (s.title ?? "Sin título").slice(0, 60);
          const amt =
            s.awardedAmount !== null && s.awardedAmount > 0
              ? formatCurrency(s.awardedAmount, "MXN")
              : "N/D";
          const yr = s.year !== null ? String(s.year) : "N/D";
          lines.push(`  • ${escapeHtml(t)} — ${amt} (${yr}) [${s.source}]`);
        }
      }
    }

    if (data.ceilingEstimate !== undefined || data.similarContracts !== undefined) {
      lines.push("");
      lines.push(
        `⚖️ <i>${escapeHtml(
          data.ceilingEstimate?.legalWarning ??
            "Estimación basada únicamente en información pública.",
        )}</i>`,
      );
    }
```

- [ ] **Step 5: Insertar el mismo bloque en la rama con-docs**

En la rama con-docs (el bloque `const lines: string[] = [...]`), después del bloque `antecedentes` y **antes** del bloque `if (data.errors.length > 0)`, insertar el mismo bloque del paso 4 (idéntico).

- [ ] **Step 6: Correr tests telegram**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/alerts/__tests__/telegram.enriched.test.ts --no-coverage
```

Expected: PASS 16/16 (12 existentes + 4 nuevos).

### Parte B — enrich-procurement.job.ts

- [ ] **Step 7: Añadir 2 tests a enrich-procurement.test.ts**

Leer el archivo. Agregar mocks ANTES de los imports de los mocks existentes:

```typescript
jest.mock("../../services/procurement-similarity-engine");
jest.mock("../../services/budget-ceiling-engine");
```

Agregar imports DESPUÉS de `const mockedOcds = ...`:

```typescript
import { findSimilarProcurements } from "../../services/procurement-similarity-engine";
import { estimateBudgetCeiling } from "../../services/budget-ceiling-engine";

const mockedSimilarity = findSimilarProcurements as jest.MockedFunction<typeof findSimilarProcurements>;
const mockedCeiling = estimateBudgetCeiling as jest.MockedFunction<typeof estimateBudgetCeiling>;
```

En el `beforeEach`, después de los mocks de compranet/sipot/ocds, añadir:

```typescript
    mockedSimilarity.mockResolvedValue({ similarProcedures: [], totalFound: 0, scopeApplied: "MORELOS_ONLY" });
    mockedCeiling.mockReturnValue({
      directCeiling: null, estimatedMin: null, estimatedMax: null,
      average: null, median: null, confidence: "baja" as const,
      evidence: [], explanation: "Sin evidencia.", legalWarning: "Info pública.",
    });
```

Añadir al final del `describe` (antes del cierre `}`):

```typescript
  it("llama a similarity engine y ceiling engine cuando hay documentos", async () => {
    const url = "https://example.com/bases.pdf";
    mockedCollect.mockResolvedValue(makeCollectorResult([{ title: "Bases", fileUrl: url }]));
    mockedDownload.mockResolvedValue(makeDownloadResults([url], ["ok"]));
    mockedParsePdf.mockResolvedValue({ text: "Mantenimiento vial Morelos.", parseStatus: "ok", errors: [] });
    mockedExtractBudget.mockReturnValue({ signals: [], hasSignals: false, highestAmount: null });

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("success");
    expect(mockedSimilarity).toHaveBeenCalled();
    expect(mockedCeiling).toHaveBeenCalled();
  });

  it("no falla si similarity engine lanza error", async () => {
    const url = "https://example.com/bases.pdf";
    mockedCollect.mockResolvedValue(makeCollectorResult([{ title: "Bases", fileUrl: url }]));
    mockedDownload.mockResolvedValue(makeDownloadResults([url], ["ok"]));
    mockedParsePdf.mockResolvedValue({ text: "", parseStatus: "empty", errors: [] });
    mockedExtractBudget.mockReturnValue({ signals: [], hasSignals: false, highestAmount: null });
    mockedSimilarity.mockRejectedValue(new Error("similarity crashed"));

    await expect(enrichProcurement(baseInput)).resolves.toBeDefined();
  });
```

- [ ] **Step 8: Verificar que fallan**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/jobs/__tests__/enrich-procurement.test.ts --no-coverage 2>&1 | grep "Tests:"
```

Expected: 2 tests failing.

- [ ] **Step 9: Actualizar enrich-procurement.job.ts**

Leer el archivo. Añadir DESPUÉS de los imports de fetchCompranetHistorico/fetchPntSipot/fetchContratacionesAbiertas:

```typescript
import { findSimilarProcurements, type SimilarityResult } from "../services/procurement-similarity-engine";
import { estimateBudgetCeiling, type CeilingResult } from "../services/budget-ceiling-engine";
```

Después de las líneas:
```typescript
    log.info(
      { jobId, compranetCount: antecedentes.compranetCount, sipotCount: antecedentes.sipotCount,
        ocdsCount: antecedentes.ocdsCount },
      "📊 Antecedentes encontrados",
    );
```

Insertar los pasos 5d y 5e:

```typescript
    // 5d. Similitud contractual (G1) — falla silenciosamente
    let similarityResult: SimilarityResult = {
      similarProcedures: [],
      totalFound: 0,
      scopeApplied: input.scope,
    };
    try {
      similarityResult = await findSimilarProcurements({
        title: input.title,
        dependency: input.dependency,
        state: null,
        contractType: null,
        keywords: titleKeywords,
        scope: input.scope,
        historico: historicoContracts,
        sipot: sipotContracts,
        ocds: ocdsContracts,
      });
      log.info(
        { jobId, totalSimilares: similarityResult.totalFound },
        "🔗 Contratos similares encontrados",
      );
    } catch (simErr) {
      log.warn({ err: simErr, jobId }, "⚠️ Similarity engine no disponible");
    }

    // 5e. Estimación de techo presupuestal (G2) — falla silenciosamente
    let ceilingResult: CeilingResult = {
      directCeiling: null,
      estimatedMin: null,
      estimatedMax: null,
      average: null,
      median: null,
      confidence: "baja",
      evidence: [],
      explanation: "Sin estimación disponible.",
      legalWarning:
        "Estimación basada únicamente en información pública. No representa monto oficial salvo que el documento lo indique expresamente.",
    };
    try {
      ceilingResult = estimateBudgetCeiling({
        directCeilingFound: budgetSignal.hasSignals,
        directCeilingAmount: budgetSignal.highestAmount,
        budgetSignals: budgetSignal.signals,
        similarProcedures: similarityResult.similarProcedures,
        title: input.title,
        dependency: input.dependency,
      });
    } catch (ceilErr) {
      log.warn({ err: ceilErr, jobId }, "⚠️ Ceiling engine no disponible");
    }
```

En la llamada a `formatEnrichedAlert` (paso 6), añadir después de `antecedentes,`:

```typescript
      ceilingEstimate: ceilingResult,
      similarContracts: similarityResult.similarProcedures.slice(0, 3),
```

- [ ] **Step 10: Correr todos los tests**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npm test -- --no-coverage 2>&1 | tail -10
```

Expected: ≥ 252 tests, 0 failing.

- [ ] **Step 11: Typecheck + commit**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npm run typecheck 2>&1 | tail -5
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX" && git add apps/worker/src/jobs/enrich-procurement.job.ts apps/worker/src/jobs/__tests__/enrich-procurement.test.ts apps/worker/src/alerts/telegram.alerts.ts apps/worker/src/alerts/__tests__/telegram.enriched.test.ts && git commit -m "feat: G3 — integrar G1+G2 en pipeline y alerta Telegram"
```

---

## Task G4: Endpoint /api/licitaciones/:id/ficha

**Files:**
- Modify: `src/core/http-server.ts`
- Create: `src/core/__tests__/http-server.test.ts`

El endpoint actualmente devuelve `techo: { disponible: false, nota: "Consultar vía /techo en Telegram" }` y `antecedentes: { disponible: false, nota: "Módulo en desarrollo" }`.

G4 extrae la lógica de mapeo como función pura exportada, la prueba directamente, y la usa en el handler para retornar datos reales cuando existan en la base de datos (columna `enrichment_data` en tabla `procurements`).

- [ ] **Step 1: Escribir el test**

Crear `src/core/__tests__/http-server.test.ts`:

```typescript
// src/core/__tests__/http-server.test.ts
import { mapEnrichmentToSections } from "../http-server";

describe("mapEnrichmentToSections", () => {
  it("retorna disponible:false para ambos cuando enrichmentData es null", () => {
    const result = mapEnrichmentToSections(null);
    expect(result.techo).toMatchObject({ disponible: false });
    expect(result.antecedentes).toMatchObject({ disponible: false });
    expect((result.techo as { nota: string }).nota).toContain("Enriquecimiento pendiente");
  });

  it("retorna techo disponible:true cuando hay ceiling data", () => {
    const enrichmentData = {
      ceiling: {
        directCeiling: 5000000,
        estimatedMin: null,
        estimatedMax: null,
        average: null,
        confidence: "alta",
        explanation: "Techo localizado directamente.",
        legalWarning: "Info pública.",
      },
    };
    const result = mapEnrichmentToSections(enrichmentData);
    expect(result.techo).toMatchObject({ disponible: true, directCeiling: 5000000, confidence: "alta" });
    expect(result.antecedentes).toMatchObject({ disponible: false });
  });

  it("retorna antecedentes disponible:true cuando hay similar data", () => {
    const enrichmentData = {
      ceiling: null,
      similar: [
        { procedureId: "LP-001", source: "compranet-historico", title: "Contrato A", similarityScore: 0.9, awardedAmount: 1200000, year: 2023 },
        { procedureId: "LP-002", source: "pnt-sipot", title: "Contrato B", similarityScore: 0.7, awardedAmount: 800000, year: 2022 },
      ],
    };
    const result = mapEnrichmentToSections(enrichmentData);
    expect(result.antecedentes).toMatchObject({ disponible: true, totalSimilares: 2 });
    expect((result.antecedentes as { contratos: unknown[] }).contratos).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/core/__tests__/http-server.test.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — "mapEnrichmentToSections is not a function" o similar.

- [ ] **Step 3: Añadir `mapEnrichmentToSections` a http-server.ts**

Leer el archivo primero. Después del bloque de imports, añadir el tipo y la función pura. Colocar ANTES de `// ── Helpers ──`:

```typescript
// ── Tipos de enriquecimiento ──────────────────────────────────────────────────

type EnrichmentStore = {
  ceiling?: {
    directCeiling: number | null;
    estimatedMin: number | null;
    estimatedMax: number | null;
    average: number | null;
    confidence: string;
    explanation: string;
    legalWarning: string;
  } | null;
  similar?: Array<{
    procedureId: string | null;
    source: string;
    title: string | null;
    similarityScore: number;
    awardedAmount: number | null;
    year: number | null;
  }> | null;
};

export function mapEnrichmentToSections(enrichmentData: unknown): {
  techo: unknown;
  antecedentes: unknown;
} {
  if (
    enrichmentData === null ||
    enrichmentData === undefined ||
    typeof enrichmentData !== "object"
  ) {
    return {
      techo: { disponible: false, nota: "Enriquecimiento pendiente" },
      antecedentes: { disponible: false, nota: "Enriquecimiento pendiente" },
    };
  }

  const ed = enrichmentData as EnrichmentStore;

  const techo =
    ed.ceiling != null
      ? {
          disponible: true,
          directCeiling: ed.ceiling.directCeiling,
          estimatedMin: ed.ceiling.estimatedMin,
          estimatedMax: ed.ceiling.estimatedMax,
          average: ed.ceiling.average,
          confidence: ed.ceiling.confidence,
          explanation: ed.ceiling.explanation,
          legalWarning: ed.ceiling.legalWarning,
        }
      : { disponible: false, nota: "Enriquecimiento pendiente" };

  const antecedentes =
    Array.isArray(ed.similar)
      ? {
          disponible: true,
          totalSimilares: ed.similar.length,
          contratos: ed.similar.slice(0, 5),
        }
      : { disponible: false, nota: "Enriquecimiento pendiente" };

  return { techo, antecedentes };
}
```

- [ ] **Step 4: Actualizar `handleGetFicha` para usar `mapEnrichmentToSections`**

Leer la función `handleGetFicha`. Modificar `FICHA_SELECT` para incluir `enrichment_data` (si la columna existe en Supabase, se leerá; si no existe, Supabase puede devolver error — encapsular en try/catch). Alternativa más segura: hacer una segunda query explícita o leer el campo con acceso opcional.

La forma más segura sin modificar FICHA_SELECT (para no romper si la columna no existe):

Después de `const data = raw as unknown as Record<string, unknown>;`, añadir:

```typescript
  const enrichmentRaw = (data["enrichment_data"] as unknown) ?? null;
  const { techo, antecedentes } = mapEnrichmentToSections(enrichmentRaw);
```

Y en el objeto del `sendJson`, reemplazar las líneas actuales de `techo` y `antecedentes`:

Reemplazar:
```typescript
    techo: { disponible: false, nota: "Consultar vía /techo en Telegram" },
    antecedentes: { disponible: false, nota: "Módulo en desarrollo" },
```

Con:
```typescript
    techo,
    antecedentes,
```

**Nota:** Agregar `enrichment_data` al `FICHA_SELECT` para que Supabase lo incluya en el select. Si la columna no existe aún en la tabla, el select fallará. Para hacer esto tolerante a fallos, NO agregar al select por ahora — dejar que `data["enrichment_data"]` sea `undefined`, lo que resultará en `mapEnrichmentToSections(undefined)` retornando el fallback "Enriquecimiento pendiente". Esto es correcto hasta que se agregue la columna.

- [ ] **Step 5: Correr tests**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/core/__tests__/http-server.test.ts --no-coverage
```

Expected: PASS 3/3

- [ ] **Step 6: Correr suite completa**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npm test -- --no-coverage 2>&1 | tail -15
```

Expected: ≥ 255 tests, 0 failing.

- [ ] **Step 7: Typecheck + build**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npm run typecheck 2>&1 | tail -5 && npm run build 2>&1 | tail -5
```

Expected: ambos exit 0.

- [ ] **Step 8: Commit + push**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX" && git add apps/worker/src/core/http-server.ts apps/worker/src/core/__tests__/http-server.test.ts && git commit -m "feat: G4 — mapEnrichmentToSections en endpoint /ficha" && git push origin main
```

---

## Summary

| Tarea | Archivos nuevos | Tests nuevos |
|-------|----------------|--------------|
| G1 (similarity engine) | 2 | 6 |
| G2 (ceiling engine) | 2 | 6 |
| G3 (integration) | mods 4 archivos | 6 |
| G4 (http-server) | 1 nuevo + 1 mod | 3 |
| **Total** | **5 nuevos + 5 mods** | **~21 nuevos** |

Total esperado post-Fase G: **≥ 253 tests**.

**Reglas cumplidas en todos los motores:**
- G1 y G2: funciones puras o async sin side-effects externos
- G3: pasos 5d y 5e envueltos en try/catch — pipeline no se rompe si G1/G2 fallan
- G4: `mapEnrichmentToSections` es función pura exportada — fácil de testear sin HTTP
- Commits separados por tarea (G1, G2, G3, G4)
- Push a origin main al terminar G4
