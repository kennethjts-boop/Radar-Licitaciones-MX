/**
 * FINANCIAL CEILING RADAR — Barrel exports del módulo.
 *
 * Punto de entrada limpio para importar desde el resto del sistema.
 * Uso mínimo recomendado:
 *
 *   import { analyzeFinancialCeiling } from '../modules/financial-ceiling-radar';
 *   import { handleTechoCommand } from '../modules/financial-ceiling-radar';
 */

export { analyzeFinancialCeiling } from "./analyzer";
export { handleTechoCommand } from "./telegram-handler";
export { formatTelegramMessage, formatTelegramErrorMessage } from "./telegram-formatter";
export { generateJsonReport, generateMarkdownReport, saveReports } from "./reporter";
export { calculateSimilarityScore } from "./scorer";
export { normalizeObjectText, tokenizeObject, textSimilarity, isFormalTenderNumber } from "./normalizer";
export { estimateCeiling } from "./estimator";

// Types
export type {
  FinancialCeilingReport,
  FinancialCeiling,
  ImmediatePrecedent,
  SimilarCandidate,
  SourceConsulted,
  PublicContractRaw,
  ConfidenceLevel,
  CeilingType,
  FinancialAnalysisInput,
} from "./types";
