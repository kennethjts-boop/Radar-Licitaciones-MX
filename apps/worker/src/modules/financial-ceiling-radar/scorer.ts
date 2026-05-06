/**
 * SIMILARITY SCORER — Calcula score de similitud entre contratos/licitaciones.
 *
 * Scoring basado en criterios de procurement público mexicano.
 * NO depende de ninguna otra parte del radar.
 */

import { SimilarityScoreDetail, PublicContractRaw } from "./types";
import { textSimilarity } from "./normalizer";

// ─── Pesos por criterio ────────────────────────────────────────────────────────

const WEIGHTS = {
  sameDependency:    25,
  sameBuyerUnit:     20,
  objectMatchStrong: 30,
  objectMatchPartial: 15,
  sameCucop:         25,
  sameBudgetLine:    15,
  sameSupplier:      10,
  immediateYear:     15,
  officialDocument:  20,
} as const;

// MAX_POSSIBLE: solo criterios base (sin CUCOP/partida/proveedor que son datos opcionales/raros)
// dependency(25)+buyerUnit(20)+objectStrong(30)+immediateYear(15)+officialDoc(20) = 110
// CUCOP, partida y proveedor son bonificaciones extra que pueden llevar el score a >110 (se capea en 100)
const MAX_POSSIBLE = 110;


/**
 * Calcula el score de similitud entre la licitación actual y un contrato candidato.
 */
export function calculateSimilarityScore(
  current: {
    agency?: string | null;
    buyerUnit?: string | null;
    object?: string | null;
    cucop?: string | null;
    budgetLine?: string | null;
    supplier?: string | null;
    year?: number | null;
  },
  candidate: PublicContractRaw,
  currentYear?: number | null,
): SimilarityScoreDetail {
  let rawScore = 0;
  const breakdown = {
    sameDependency: 0,
    sameBuyerUnit: 0,
    objectMatchStrong: 0,
    objectMatchPartial: 0,
    sameCucop: 0,
    sameBudgetLine: 0,
    sameSupplier: 0,
    immediateYear: 0,
    officialDocument: 0,
  };

  // ── Dependencia ──────────────────────────────────────────────────────────────
  if (current.agency && candidate.dependencia) {
    const sim = textSimilarity(current.agency, candidate.dependencia);
    // Threshold más bajo (0.4) porque muchas veces se usa nombre completo vs acrónimo
    if (sim >= 0.4) {
      breakdown.sameDependency = WEIGHTS.sameDependency;
      rawScore += WEIGHTS.sameDependency;
    }
  }

  // ── Unidad compradora ────────────────────────────────────────────────────────
  if (current.buyerUnit && candidate.unidad_compradora) {
    const sim = textSimilarity(current.buyerUnit, candidate.unidad_compradora);
    if (sim >= 0.7) {
      breakdown.sameBuyerUnit = WEIGHTS.sameBuyerUnit;
      rawScore += WEIGHTS.sameBuyerUnit;
    }
  }

  // ── Objeto ───────────────────────────────────────────────────────────────────
  if (current.object && (candidate.objeto_contratacion || candidate.descripcion)) {
    const candidateObj = candidate.objeto_contratacion ?? candidate.descripcion ?? "";
    const sim = textSimilarity(current.object, candidateObj);

    if (sim >= 0.6) {
      breakdown.objectMatchStrong = WEIGHTS.objectMatchStrong;
      rawScore += WEIGHTS.objectMatchStrong;
    } else if (sim >= 0.3) {
      breakdown.objectMatchPartial = WEIGHTS.objectMatchPartial;
      rawScore += WEIGHTS.objectMatchPartial;
    }
  }

  // ── CUCOP ────────────────────────────────────────────────────────────────────
  if (current.cucop && candidate.partida_presupuestal) {
    if (
      current.cucop.trim().toLowerCase() ===
      candidate.partida_presupuestal.trim().toLowerCase()
    ) {
      breakdown.sameCucop = WEIGHTS.sameCucop;
      rawScore += WEIGHTS.sameCucop;
    }
  }

  // ── Partida presupuestal ─────────────────────────────────────────────────────
  if (current.budgetLine && candidate.partida_presupuestal) {
    if (
      current.budgetLine.trim().toLowerCase() ===
      candidate.partida_presupuestal.trim().toLowerCase()
    ) {
      breakdown.sameBudgetLine = WEIGHTS.sameBudgetLine;
      rawScore += WEIGHTS.sameBudgetLine;
    }
  }

  // ── Proveedor recurrente ─────────────────────────────────────────────────────
  if (current.supplier && candidate.proveedor_ganador) {
    const sim = textSimilarity(current.supplier, candidate.proveedor_ganador);
    if (sim >= 0.7) {
      breakdown.sameSupplier = WEIGHTS.sameSupplier;
      rawScore += WEIGHTS.sameSupplier;
    }
  }

  // ── Año inmediato anterior ───────────────────────────────────────────────────
  if (currentYear && candidate.fecha_contrato) {
    const candYear = parseInt(candidate.fecha_contrato.slice(0, 4));
    if (!isNaN(candYear) && currentYear - candYear === 1) {
      breakdown.immediateYear = WEIGHTS.immediateYear;
      rawScore += WEIGHTS.immediateYear;
    }
  }

  // ── Documento oficial con monto claro ────────────────────────────────────────
  if (
    candidate.monto_contrato !== null &&
    candidate.monto_contrato !== undefined &&
    candidate.url_fuente
  ) {
    breakdown.officialDocument = WEIGHTS.officialDocument;
    rawScore += WEIGHTS.officialDocument;
  }

  // ── Normalizar a 0-100 ───────────────────────────────────────────────────────
  const normalized = Math.min(100, Math.round((rawScore / MAX_POSSIBLE) * 100));

  let classification: SimilarityScoreDetail["classification"];
  if (normalized >= 80) classification = "antecedente_fuerte";
  else if (normalized >= 60) classification = "antecedente_probable";
  else if (normalized >= 40) classification = "antecedente_debil";
  else classification = "no_usar";

  return { total: normalized, breakdown, classification };
}
