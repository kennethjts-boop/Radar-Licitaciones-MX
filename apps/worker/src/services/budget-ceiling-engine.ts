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
