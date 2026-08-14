import { normalizeText } from "../core/text";
import type { NormalizedProcurement } from "../types/procurement";

export const OPERATIONAL_FOCUS_KEYS = {
  // Se reutilizan cuatro de las 12 filas históricas de producción. Las keys
  // permanecen estables para no crear/borrar configuraciones ni romper FKs.
  capufeNational: "capufe_oportunidades",
  imssMorelos: "imss_morelos",
  imssOaxtepec: "imss_bienestar_morelos",
  morelosGeneral: "habitat_morelos",
} as const;

export type OperationalFocusKey =
  (typeof OPERATIONAL_FOCUS_KEYS)[keyof typeof OPERATIONAL_FOCUS_KEYS];

export interface OperationalFocusDetection {
  matchedTerms: string[];
  scoreReasons: string[];
  territoryMatched: string | null;
}

function value(procurement: NormalizedProcurement, rawKey: string): string {
  const raw = procurement.rawJson[rawKey];
  return typeof raw === "string" ? raw.trim() : "";
}

function folded(input: string | null | undefined): string {
  return normalizeText(input ?? "");
}

function structuredDependency(procurement: NormalizedProcurement): string {
  return folded(
    value(procurement, "siglas") ||
      value(procurement, "dependencia") ||
      procurement.dependencyName,
  );
}

function structuredBuyingUnit(procurement: NormalizedProcurement): string {
  return folded(value(procurement, "unidad_compradora") || procurement.buyingUnit);
}

function structuredState(procurement: NormalizedProcurement): string {
  return folded(
    value(procurement, "entidad_federativa_contratacion") || procurement.state,
  );
}

function isCapufe(procurement: NormalizedProcurement): boolean {
  const dependency = structuredDependency(procurement);
  return (
    dependency === "capufe" ||
    dependency.includes("caminos y puentes federales")
  );
}

function isImss(procurement: NormalizedProcurement): boolean {
  const dependency = structuredDependency(procurement);
  if (dependency.includes("imss bienestar")) return false;
  return (
    dependency === "imss" ||
    dependency.includes("instituto mexicano del seguro social")
  );
}

/**
 * Morelos se acepta primero por el campo estructurado del listado ComprasMX.
 * Si ese campo no existe, el fallback queda limitado a la unidad compradora
 * estructurada; nunca se usa texto libre del objeto o sus anexos.
 */
export function detectStructuredMorelos(
  procurement: NormalizedProcurement,
): { matched: boolean; signal: string | null } {
  const state = structuredState(procurement);
  if (state) {
    return state === "morelos"
      ? { matched: true, signal: "entidad_federativa_contratacion=MORELOS" }
      : { matched: false, signal: null };
  }

  const unit = structuredBuyingUnit(procurement);
  const trustedUnit =
    /\bmorelos\b/.test(unit) &&
    /\b(ooad|delegacion|representacion|unidad|centro|hospital|coordinacion|departamento|depto)\b/.test(
      unit,
    );
  const trustedImssCode = /\b050gyr(?:007|085|107)\b/.test(unit);
  const oaxtepecUnit = /\boaxtepec\b/.test(unit);

  return trustedUnit || trustedImssCode || oaxtepecUnit
    ? { matched: true, signal: `unidad_compradora=${unit}` }
    : { matched: false, signal: null };
}

function detectOaxtepecUnit(procurement: NormalizedProcurement): boolean {
  const unit = structuredBuyingUnit(procurement);
  return /\b050gyr085\b/.test(unit) || /\bcentro vacacional imss oaxtepec\b/.test(unit);
}

export function detectOperationalFocus(
  procurement: NormalizedProcurement,
  radarKey: string,
): OperationalFocusDetection | null {
  if (procurement.source !== "comprasmx") return null;

  if (radarKey === OPERATIONAL_FOCUS_KEYS.capufeNational) {
    if (!isCapufe(procurement)) return null;
    return {
      matchedTerms: ["CAPUFE"],
      scoreReasons: ["buyer_capufe_structured", "scope_national"],
      territoryMatched: "Nacional",
    };
  }

  const morelos = detectStructuredMorelos(procurement);

  if (radarKey === OPERATIONAL_FOCUS_KEYS.imssMorelos) {
    if (!isImss(procurement) || !morelos.matched) return null;
    return {
      matchedTerms: ["IMSS", morelos.signal ?? "Morelos"],
      scoreReasons: ["buyer_imss_structured", "territory_morelos_structured"],
      territoryMatched: "Morelos",
    };
  }

  if (radarKey === OPERATIONAL_FOCUS_KEYS.imssOaxtepec) {
    if (!isImss(procurement) || !detectOaxtepecUnit(procurement)) return null;
    // Si ComprasMX sí declaró una entidad, una entidad distinta invalida el foco.
    if (structuredState(procurement) && !morelos.matched) return null;
    return {
      matchedTerms: ["IMSS", "050GYR085", "Oaxtepec"],
      scoreReasons: ["buyer_imss_structured", "buying_unit_050gyr085"],
      territoryMatched: "Oaxtepec, Morelos",
    };
  }

  if (radarKey === OPERATIONAL_FOCUS_KEYS.morelosGeneral) {
    if (!morelos.matched) return null;
    return {
      matchedTerms: [morelos.signal ?? "Morelos"],
      scoreReasons: ["territory_morelos_structured"],
      territoryMatched: "Morelos",
    };
  }

  return null;
}
