/**
 * Adaptador de compatibilidad. La lógica institucional/geográfica canónica
 * vive en operational-focus.matcher.ts junto con los otros tres focos.
 */
import type { NormalizedProcurement } from "../types/procurement";
import {
  detectOperationalFocus,
  OPERATIONAL_FOCUS_KEYS,
} from "./operational-focus.matcher";

export const IMSS_MORELOS_RADAR_KEY = OPERATIONAL_FOCUS_KEYS.imssMorelos;
export const IMSS_MORELOS_SCORE_REASONS = [
  "buyer_imss_structured",
  "territory_morelos_structured",
];
export const IMSS_BIENESTAR_EXCLUSION_TERMS = ["IMSS-Bienestar"];
export const MORELOS_TERRITORY_TERMS = ["Morelos"];

export interface ImssMorelosPriorityDetection {
  imssTerms: string[];
  territoryTerms: string[];
  territoryMatched: string;
}

export function detectImssMorelosPriority(
  procurement: NormalizedProcurement,
): ImssMorelosPriorityDetection | null {
  const detection = detectOperationalFocus(procurement, IMSS_MORELOS_RADAR_KEY);
  if (!detection) return null;
  return {
    imssTerms: detection.matchedTerms.filter((term) => term === "IMSS"),
    territoryTerms: detection.matchedTerms.filter((term) => term !== "IMSS"),
    territoryMatched: detection.territoryMatched ?? "Morelos",
  };
}
