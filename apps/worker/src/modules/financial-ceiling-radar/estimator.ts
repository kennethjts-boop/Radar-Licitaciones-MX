/**
 * CEILING ESTIMATOR — Lógica de estimación del techo financiero.
 *
 * Jerarquía de estimación según las reglas del módulo:
 * CASO 1: Techo confirmado (monto máximo explícito)
 * CASO 2: Contrato abierto (min/max)
 * CASO 3: Antecedente inmediato
 * CASO 4: Histórico similar
 * CASO 5: Sin información suficiente
 */

import {
  PublicContractRaw,
  FinancialCeiling,
  ImmediatePrecedent,
  SimilarCandidate,
  CeilingType,
  ConfidenceLevel,
} from "./types";
import { calculateSimilarityScore } from "./scorer";
import { extractYearFromTenderNumber } from "./normalizer";

// ─── Inflación estimada para variación ────────────────────────────────────────

const ESTIMATED_INFLATION_RATE = 0.07; // 7% referencia anual MX

// ─── Estimador principal ──────────────────────────────────────────────────────

/**
 * Determina el techo financiero más confiable dado el contexto de la licitación.
 */
export function estimateCeiling(params: {
  currentData: PublicContractRaw | null;
  candidates: PublicContractRaw[];
  query: string;
}): {
  ceiling: FinancialCeiling;
  immediatePrecedent: ImmediatePrecedent | null;
  similarCandidates: SimilarCandidate[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const { currentData, candidates, query } = params;

  const currentYear = extractYearFromTenderNumber(query);

  // ── CASO 1: Techo confirmado en la licitación actual ────────────────────────
  if (currentData) {
    const confirmed = extractConfirmedCeiling(currentData);
    if (confirmed) {
      return {
        ceiling: confirmed,
        immediatePrecedent: null,
        similarCandidates: [],
        warnings,
      };
    }
  }

  // ── Scoring de candidatos históricos ────────────────────────────────────────
  const scored = candidates
    .map((c) => {
      const scoreDetail = calculateSimilarityScore(
        {
          agency: currentData?.dependencia,
          buyerUnit: currentData?.unidad_compradora,
          object: currentData?.objeto_contratacion ?? query,
          year: currentYear,
        },
        c,
        currentYear,
      );
      return { contract: c, scoreDetail };
    })
    .filter((s) => s.scoreDetail.classification !== "no_usar")
    .sort((a, b) => b.scoreDetail.total - a.scoreDetail.total);

  // Similar candidates list
  const similarCandidates: SimilarCandidate[] = scored.slice(0, 5).map((s) => ({
    expediente: s.contract.numero_licitacion ?? null,
    object: s.contract.objeto_contratacion ?? null,
    supplier: s.contract.proveedor_ganador ?? null,
    amount: s.contract.monto_contrato ?? null,
    year: s.contract.fecha_contrato
      ? parseInt(s.contract.fecha_contrato.slice(0, 4))
      : null,
    score: s.scoreDetail.total,
    sourceUrl: s.contract.url_fuente ?? null,
    agency: s.contract.dependencia ?? null,
  }));

  // ── CASO 3: Antecedente inmediato ────────────────────────────────────────────
  const best = scored[0];
  if (best && best.scoreDetail.classification === "antecedente_fuerte") {
    const { ceiling, precedent, warns } = buildFromPrecedent(
      best.contract,
      best.scoreDetail.total,
      "antecedente_inmediato",
      currentYear,
    );
    warnings.push(...warns);
    return { ceiling, immediatePrecedent: precedent, similarCandidates, warnings };
  }

  // ── CASO 4: Histórico similar ────────────────────────────────────────────────
  if (scored.length >= 1 && best) {
    const isMedium = best.scoreDetail.classification === "antecedente_probable";
    const { ceiling, precedent, warns } = buildFromPrecedent(
      best.contract,
      best.scoreDetail.total,
      "historico_similar",
      currentYear,
      isMedium ? "MEDIA" : "BAJA",
    );
    warnings.push(...warns);

    if (scored.length > 1) {
      const amountsWithData = scored
        .filter((s) => s.contract.monto_contrato !== null)
        .map((s) => s.contract.monto_contrato as number);

      if (amountsWithData.length > 1) {
        const sorted = [...amountsWithData].sort((a, b) => a - b);
        ceiling.rangeMin = sorted[0];
        ceiling.rangeMax = sorted[sorted.length - 1];
        warnings.push(`Rango basado en ${amountsWithData.length} contratos similares históricos.`);
      }
    }

    return { ceiling, immediatePrecedent: precedent, similarCandidates, warnings };
  }

  // ── CASO 5: Sin información ──────────────────────────────────────────────────
  warnings.push("No se encontraron contratos similares suficientes para estimar el techo financiero.");
  if (!currentData) {
    warnings.push("La licitación no fue encontrada en fuentes públicas consultadas.");
  }

  const emptyCeiling: FinancialCeiling = {
    amount: null,
    rangeMin: null,
    rangeMax: null,
    currency: "MXN",
    type: "no_determinado",
    confidence: "BAJA",
    evidence: "Información pública insuficiente para estimación.",
  };

  return {
    ceiling: emptyCeiling,
    immediatePrecedent: null,
    similarCandidates,
    warnings,
  };
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function extractConfirmedCeiling(data: PublicContractRaw): FinancialCeiling | null {
  // Monto máximo explícito
  if (data.monto_maximo && data.monto_minimo) {
    return {
      amount: data.monto_maximo,
      rangeMin: data.monto_minimo,
      rangeMax: data.monto_maximo,
      currency: (data.moneda as "MXN" | "USD") ?? "MXN",
      type: "contrato_abierto",
      confidence: "ALTA",
      evidence: `Contrato abierto: min $${fmtNum(data.monto_minimo)} — max $${fmtNum(data.monto_maximo)} ${data.moneda ?? "MXN"}`,
    };
  }

  if (data.monto_maximo) {
    return {
      amount: data.monto_maximo,
      rangeMin: null,
      rangeMax: data.monto_maximo,
      currency: (data.moneda as "MXN" | "USD") ?? "MXN",
      type: "confirmado_monto_maximo",
      confidence: "ALTA",
      evidence: `Monto máximo publicado: $${fmtNum(data.monto_maximo)} ${data.moneda ?? "MXN"}`,
    };
  }

  if (data.presupuesto_autorizado) {
    return {
      amount: data.presupuesto_autorizado,
      rangeMin: null,
      rangeMax: data.presupuesto_autorizado,
      currency: (data.moneda as "MXN" | "USD") ?? "MXN",
      type: "confirmado_suficiencia_presupuestal",
      confidence: "ALTA",
      evidence: `Presupuesto autorizado: $${fmtNum(data.presupuesto_autorizado)} ${data.moneda ?? "MXN"}`,
    };
  }

  if (data.suficiencia_presupuestal) {
    return {
      amount: data.suficiencia_presupuestal,
      rangeMin: null,
      rangeMax: data.suficiencia_presupuestal,
      currency: (data.moneda as "MXN" | "USD") ?? "MXN",
      type: "confirmado_suficiencia_presupuestal",
      confidence: "ALTA",
      evidence: `Suficiencia presupuestal confirmada: $${fmtNum(data.suficiencia_presupuestal)} ${data.moneda ?? "MXN"}`,
    };
  }

  return null;
}

function buildFromPrecedent(
  contract: PublicContractRaw,
  score: number,
  type: CeilingType,
  currentYear: number | null,
  forceConfidence?: ConfidenceLevel,
): {
  ceiling: FinancialCeiling;
  precedent: ImmediatePrecedent;
  warns: string[];
} {
  const warns: string[] = [];
  const baseMonto = contract.monto_contrato ?? 0;

  // Calcular variación inflacionaria estimada
  const contractYear = contract.fecha_contrato
    ? parseInt(contract.fecha_contrato.slice(0, 4))
    : null;
  const yearDiff = currentYear && contractYear ? currentYear - contractYear : 1;
  const inflationFactor = Math.pow(1 + ESTIMATED_INFLATION_RATE, yearDiff);
  const estimatedAmount = baseMonto > 0 ? Math.round(baseMonto * inflationFactor) : null;
  const rangeMin = estimatedAmount
    ? Math.round(estimatedAmount * 0.95)
    : null;
  const rangeMax = estimatedAmount
    ? Math.round(estimatedAmount * 1.08)
    : null;

  if (yearDiff > 1) {
    warns.push(
      `El antecedente es de ${yearDiff} año(s) antes. Se aplica variación estimada de ${Math.round((inflationFactor - 1) * 100)}%.`,
    );
  }

  if (baseMonto === 0) {
    warns.push("El contrato antecedente no tiene monto registrado en la fuente pública.");
  }

  const confidence: ConfidenceLevel =
    forceConfidence ??
    (score >= 80 ? "MEDIA" : score >= 60 ? "MEDIA" : "BAJA");

  const ceiling: FinancialCeiling = {
    amount: estimatedAmount,
    rangeMin,
    rangeMax,
    currency: (contract.moneda as "MXN" | "USD") ?? "MXN",
    type,
    confidence,
    evidence: `Basado en contrato similar: ${contract.numero_licitacion ?? "N/D"} ($${fmtNum(baseMonto)} ${contract.moneda ?? "MXN"}) | Score similitud: ${score}/100`,
  };

  const precedent: ImmediatePrecedent = {
    contractNumber: contract.numero_expediente ?? null,
    tenderNumber: contract.numero_licitacion ?? null,
    agency: contract.dependencia ?? null,
    supplier: contract.proveedor_ganador ?? null,
    amount: baseMonto > 0 ? baseMonto : null,
    currency: (contract.moneda as "MXN" | "USD") ?? "MXN",
    date: contract.fecha_contrato ?? contract.fecha_fallo ?? null,
    similarityScore: score,
    sourceUrl: contract.url_fuente ?? null,
    evidence: contract.texto_evidencia ?? null,
  };

  return { ceiling, precedent, warns };
}

function fmtNum(n: number | null): string {
  if (n === null) return "N/D";
  return new Intl.NumberFormat("es-MX").format(n);
}
