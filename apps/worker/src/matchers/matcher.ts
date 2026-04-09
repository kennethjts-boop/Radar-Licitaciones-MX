/**
 * MATCHER — Evalúa expedientes contra radares.
 * Score entre 0.0 y 1.0 con explicabilidad completa.
 */
import { createModuleLogger } from "../core/logger";
import { findMatchingTerms, findExcludedTerms } from "../core/text";
import type {
  NormalizedProcurement,
  MatchResult,
  RadarConfig,
  MatchLevel,
} from "../types/procurement";

const log = createModuleLogger("matcher");

/**
 * Convierte score numérico a nivel de match.
 */
function scoreToLevel(score: number): MatchLevel {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

/**
 * Evalúa un expediente contra un radar.
 * Retorna null si no supera el umbral mínimo de score.
 */
export function evaluateProcurementAgainstRadar(
  procurement: NormalizedProcurement,
  radar: RadarConfig,
  isNew: boolean,
  previousStatus: NormalizedProcurement["status"] | null = null,
): MatchResult | null {
  const canonical = procurement.canonicalText;

  // 1. Encontrar términos excluidos → si aparece alguno requerido de exclusión, descartar
  const excludedFound = findExcludedTerms(canonical, radar.excludeTerms);

  // 2. Encontrar términos incluidos
  const matchedTerms = findMatchingTerms(canonical, radar.includeTerms);

  // 3. Evaluar reglas obligatorias
  const requiredRules = radar.rules.filter((r) => r.isRequired);
  for (const rule of requiredRules) {
    if (!evaluateRule(procurement, rule)) {
      log.trace(
        {
          radarKey: radar.key,
          externalId: procurement.externalId,
          rule: rule.fieldName,
        },
        "Regla obligatoria no cumplida — descartando",
      );
      return null;
    }
  }

  // Si no hay términos incluidos y no hay reglas opcionales que califiquen → no match
  if (matchedTerms.length === 0 && radar.includeTerms.length > 0) {
    return null;
  }

  // 4. Calcular score
  let score = 0;
  let totalWeight = 0;

  // Contribución de términos incluidos
  if (radar.includeTerms.length > 0) {
    const termRatio = Math.min(
      matchedTerms.length / Math.max(radar.includeTerms.length * 0.1, 1),
      1,
    );
    score += termRatio * 0.5;
    totalWeight += 0.5;
  }

  // Contribución de reglas con peso
  for (const rule of radar.rules) {
    if (!rule.isRequired) {
      const passes = evaluateRule(procurement, rule);
      if (passes) {
        score += rule.weight * 0.5;
      }
      totalWeight += rule.weight * 0.5;
    }
  }

  // Normalizar
  const finalScore = totalWeight > 0 ? Math.min(score / totalWeight, 1.0) : 0;

  // Penalizar por términos excluidos encontrados
  const penalizedScore =
    excludedFound.length > 0
      ? finalScore * (1 - (0.3 * Math.min(excludedFound.length, 3)) / 3)
      : finalScore;

  if (penalizedScore < radar.minScore) {
    return null;
  }

  const matchLevel = scoreToLevel(penalizedScore);

  // 5. Construir explicación
  const explanation = buildExplanation({
    radarKey: radar.key,
    matchedTerms,
    excludedFound,
    matchLevel,
    score: penalizedScore,
    isNew,
    isStatusChange:
      previousStatus !== null && previousStatus !== procurement.status,
  });

  return {
    radarKey: radar.key,
    procurementId: procurement.externalId,
    matchScore: penalizedScore,
    matchLevel,
    matchedTerms,
    excludedTerms: excludedFound,
    explanation,
    isNew,
    isStatusChange:
      previousStatus !== null && previousStatus !== procurement.status,
    previousStatus,
  };
}

/**
 * Evalúa una regla individual contra el expediente.
 */
function evaluateRule(
  procurement: NormalizedProcurement,
  rule: RadarConfig["rules"][0],
): boolean {
  const fieldValue = getFieldValue(procurement, rule.fieldName);
  if (fieldValue === null) return false;

  const normalizedField = fieldValue.toLowerCase();
  const ruleValue = rule.value;

  switch (rule.operator) {
    case "contains":
      return typeof ruleValue === "string"
        ? normalizedField.includes(ruleValue.toLowerCase())
        : false;

    case "exact":
      return typeof ruleValue === "string"
        ? normalizedField === ruleValue.toLowerCase()
        : false;

    case "any_of":
      return Array.isArray(ruleValue)
        ? ruleValue.some((v) => normalizedField.includes(v.toLowerCase()))
        : normalizedField.includes((ruleValue as string).toLowerCase());

    case "none_of":
      return Array.isArray(ruleValue)
        ? !ruleValue.some((v) => normalizedField.includes(v.toLowerCase()))
        : !normalizedField.includes((ruleValue as string).toLowerCase());

    case "regex":
      try {
        return new RegExp(ruleValue as string, "i").test(fieldValue);
      } catch {
        return false;
      }

    default:
      return false;
  }
}

/**
 * Extrae el valor de campo del procurement según el nombre del campo de la regla.
 */
function getFieldValue(
  procurement: NormalizedProcurement,
  fieldName: string,
): string | null {
  const map: Record<string, string | null> = {
    canonical_text: procurement.canonicalText,
    dependency_name: procurement.dependencyName,
    buying_unit: procurement.buyingUnit,
    title: procurement.title,
    description: procurement.description,
    status: procurement.status,
    state: procurement.state,
    municipality: procurement.municipality,
  };
  return map[fieldName] ?? null;
}

/**
 * Construye explicación legible del match.
 */
function buildExplanation(params: {
  radarKey: string;
  matchedTerms: string[];
  excludedFound: string[];
  matchLevel: MatchLevel;
  score: number;
  isNew: boolean;
  isStatusChange: boolean;
}): string {
  const parts: string[] = [];

  parts.push(
    `Match ${params.matchLevel.toUpperCase()} (score: ${(params.score * 100).toFixed(0)}%) en radar "${params.radarKey}".`,
  );

  if (params.matchedTerms.length > 0) {
    parts.push(
      `Términos coincidentes: ${params.matchedTerms.slice(0, 5).join(", ")}.`,
    );
  }

  if (params.excludedFound.length > 0) {
    parts.push(
      `⚠️ Términos excluidos detectados: ${params.excludedFound.join(", ")}.`,
    );
  }

  if (params.isNew) {
    parts.push("Expediente nuevo — primera vez detectado.");
  }

  if (params.isStatusChange) {
    parts.push("Cambio de estatus detectado.");
  }

  return parts.join(" ");
}

/**
 * Evalúa múltiples radares contra un expediente.
 * Retorna todos los matches que superan el umbral.
 */
export function evaluateAllRadars(
  procurement: NormalizedProcurement,
  radars: RadarConfig[],
  isNew: boolean,
  previousStatus: NormalizedProcurement["status"] | null = null,
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const radar of radars) {
    if (!radar.isActive) continue;
    const result = evaluateProcurementAgainstRadar(
      procurement,
      radar,
      isNew,
      previousStatus,
    );
    if (result) {
      results.push(result);
      log.debug(
        {
          radarKey: radar.key,
          score: result.matchScore,
          level: result.matchLevel,
        },
        "Match encontrado",
      );
    }
  }

  return results;
}
