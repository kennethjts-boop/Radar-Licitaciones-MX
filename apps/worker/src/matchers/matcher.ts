/**
 * MATCHER — Evalúa expedientes contra radares.
 * Score entre 0.0 y 1.0 con explicabilidad completa.
 */
import { createModuleLogger } from "../core/logger";
import { findMatchingTerms, findExcludedTerms } from "../core/text";
import {
  getCommercialProfile,
  type CommercialProfileId,
} from "../modules/commercial-profiles";
import { matchCommercialOpportunity } from "../modules/commercial-matching";
import {
  detectImssMorelosPriority,
  IMSS_MORELOS_RADAR_KEY,
  IMSS_MORELOS_SCORE_REASONS,
} from "../radars/imss-morelos-priority.matcher";
import {
  CAPUFE_DIRECT_AWARDS_RADAR_KEY,
  CAPUFE_DIRECT_AWARDS_SCORE_REASONS,
  detectCapufeDirectAward,
} from "../radars/capufe-direct-awards.matcher";
import type {
  NormalizedProcurement,
  MatchResult,
  RadarConfig,
  MatchLevel,
} from "../types/procurement";

const log = createModuleLogger("matcher");

const CAPUFE_DOMAIN_RADAR_KEYS = new Set([
  "capufe_mantenimiento_equipos",
  "capufe_peaje",
  "capufe_emergencia",
  "capufe_oportunidades",
]);

const CAPUFE_STRONG_DOMAIN_TERMS = [
  "capufe",
  "caminos y puentes federales",
  "fonadin",
  "fondo nacional de infraestructura",
  "peaje",
  "telepeaje",
  "plaza de cobro",
  "plazas de cobro",
  "caseta",
  "casetas",
  "carril",
  "carriles",
  "iave",
  "equipo de peaje",
  "equipos de peaje",
  "sistema de peaje",
  "sistema de telepeaje",
  "aforo",
  "clasificacion vehicular",
  "clasificación vehicular",
  "red carretera",
  "autopista",
  "tramo carretero",
];

const CAPUFE_STRONG_NEGATIVE_TERMS = [
  "imss",
  "issste",
  "hospital",
  "clínica",
  "clinica",
  "electromédico",
  "electromedico",
  "electromédicos",
  "electromedicos",
  "biomédico",
  "biomedico",
  "biomédicos",
  "biomedicos",
  "quirófano",
  "quirofano",
  "equipo médico",
  "equipo medico",
  "equipo hospitalario",
  "laboratorio clínico",
  "laboratorio clinico",
];

/**
 * Convierte score numérico a nivel de match.
 */
function scoreToLevel(score: number): MatchLevel {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

function commercialMatchingEnabled(): boolean {
  return process.env.COMMERCIAL_MATCHING_ENABLED !== "false";
}

function commercialMinScore(): number {
  const parsed = Number(process.env.COMMERCIAL_MATCHING_MIN_SCORE ?? "60");
  return Number.isFinite(parsed) ? parsed : 60;
}

function commercialRequireTerritory(): boolean {
  return process.env.COMMERCIAL_MATCHING_REQUIRE_TERRITORY !== "false";
}

function passesCapufeDomainGuard(
  procurement: NormalizedProcurement,
  radar: RadarConfig,
): boolean {
  if (!CAPUFE_DOMAIN_RADAR_KEYS.has(radar.key)) return true;

  const text = [
    procurement.dependencyName ?? "",
    procurement.buyingUnit ?? "",
    procurement.title,
    procurement.description ?? "",
    procurement.canonicalText,
  ].join(" ");
  const strongMatches = findMatchingTerms(text, CAPUFE_STRONG_DOMAIN_TERMS);
  if (strongMatches.length > 0) return true;

  const negativeMatches = findMatchingTerms(text, CAPUFE_STRONG_NEGATIVE_TERMS);
  if (negativeMatches.length > 0) {
    log.info(
      {
        radarKey: radar.key,
        externalId: procurement.externalId,
        negativeMatches,
      },
      "CAPUFE radar descartado: contexto medico/hospitalario sin señal fuerte CAPUFE",
    );
    return false;
  }

  log.info(
    { radarKey: radar.key, externalId: procurement.externalId },
    "CAPUFE radar descartado: sin señal fuerte de CAPUFE/FONADIN/peaje",
  );
  return false;
}

function calculateOpportunityScore(procurement: NormalizedProcurement): number {
  let score = 0.25;

  if (["activa", "publicada", "en_proceso"].includes(procurement.status)) {
    score += 0.25;
  } else if (procurement.status === "desierta") {
    score += 0.2;
  } else if (["cancelada", "cerrada"].includes(procurement.status)) {
    score -= 0.15;
  }

  if (procurement.amount !== null && procurement.amount > 0) score += 0.15;
  if (procurement.dependencyName) score += 0.1;
  if (procurement.sourceUrl) score += 0.1;

  if (procurement.openingDate) {
    const openingTime = Date.parse(procurement.openingDate);
    if (!Number.isNaN(openingTime)) {
      score += openingTime >= Date.now() ? 0.15 : -0.1;
    }
  } else {
    score += 0.05;
  }

  return clampScore(score);
}

function calculateDocumentScore(procurement: NormalizedProcurement): number {
  let score = 0.2;
  const attachmentCount = procurement.attachments.length;

  if (attachmentCount >= 3) score += 0.45;
  else if (attachmentCount >= 1) score += 0.25;

  if (procurement.expedienteId || procurement.procedureNumber || procurement.licitationNumber) {
    score += 0.15;
  }
  if (procurement.sourceUrl) score += 0.1;
  if ((procurement.description?.length ?? 0) > 40 || procurement.canonicalText.length > 160) {
    score += 0.1;
  }

  return clampScore(score);
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
  if (radar.key === IMSS_MORELOS_RADAR_KEY) {
    return evaluateImssMorelosPriorityRadar(
      procurement,
      isNew,
      previousStatus,
    );
  }

  if (radar.key === CAPUFE_DIRECT_AWARDS_RADAR_KEY) {
    return evaluateCapufeDirectAwardsRadar(
      procurement,
      isNew,
      previousStatus,
    );
  }

  if (radar.commercialProfileId) {
    return evaluateProcurementAgainstCommercialRadar(
      procurement,
      radar,
      isNew,
      previousStatus,
    );
  }

  if (!passesCapufeDomainGuard(procurement, radar)) {
    return null;
  }

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

  // Penalización geográfica: si el radar tiene geoTerms y ninguno aparece en
  // canonical_text, reducir el score en 0.3. El filtro duro geográfico (descartar
  // la alerta) se aplica en collect.job.ts; aquí solo ajustamos el scoring.
  let adjustedScore = penalizedScore;
  if (radar.geoTerms.length > 0) {
    const canonicalLower = canonical.toLowerCase();
    const hasGeoMatch = radar.geoTerms.some((term) =>
      canonicalLower.includes(term.toLowerCase()),
    );
    if (!hasGeoMatch) {
      adjustedScore = Math.max(0, penalizedScore - 0.3);
    }
  }

  if (adjustedScore < radar.minScore) {
    return null;
  }

  const matchLevel = scoreToLevel(adjustedScore);

  // 5. Construir explicación
  const explanation = buildExplanation({
    radarKey: radar.key,
    matchedTerms,
    excludedFound,
    matchLevel,
    score: adjustedScore,
    isNew,
    isStatusChange:
      previousStatus !== null && previousStatus !== procurement.status,
  });

  return {
    radarKey: radar.key,
    procurementId: procurement.externalId,
    matchScore: adjustedScore,
    opportunityScore: calculateOpportunityScore(procurement),
    documentScore: calculateDocumentScore(procurement),
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

function evaluateProcurementAgainstCommercialRadar(
  procurement: NormalizedProcurement,
  radar: RadarConfig,
  isNew: boolean,
  previousStatus: NormalizedProcurement["status"] | null,
): MatchResult | null {
  if (!commercialMatchingEnabled()) return null;

  const profile = getCommercialProfile(radar.commercialProfileId as CommercialProfileId);
  const result = matchCommercialOpportunity(
    {
      title: procurement.title,
      description: procurement.description,
      buyerName: procurement.dependencyName,
      dependency: procurement.dependencyName,
      unit: procurement.buyingUnit,
      procedureId:
        procurement.procedureNumber ??
        procurement.licitationNumber ??
        procurement.expedienteId,
      source: procurement.source,
      sourceUrl: procurement.sourceUrl,
      publicationDate: procurement.publicationDate,
      state: procurement.state,
      municipality: procurement.municipality,
      placeOfExecution: procurement.rawJson.placeOfExecution as string | null | undefined,
      placeOfDelivery: procurement.rawJson.placeOfDelivery as string | null | undefined,
      fullText: procurement.canonicalText,
      attachmentsText: procurement.attachments
        .map((attachment) => attachment.detectedText)
        .filter((text): text is string => Boolean(text)),
    },
    {
      profiles: [profile],
      minScore: Math.max(commercialMinScore(), radar.minScore * 100),
      requireTerritory: commercialRequireTerritory(),
      debug: process.env.COMMERCIAL_MATCHING_DEBUG !== "false",
    },
  );
  const profileMatch = result.matchedProfiles[0];
  if (!profileMatch || !profileMatch.shouldAlert) {
    log.trace(
      {
        radarKey: radar.key,
        externalId: procurement.externalId,
        score: result.score,
        reason: result.discardReason,
      },
      "Commercial profile discarded",
    );
    return null;
  }

  const matchScore = clampScore(profileMatch.score / 100);
  const explanation = [
    `Match comercial ${profileMatch.scoreLevel.toUpperCase()} (${profileMatch.score}%) para ${profileMatch.displayName}.`,
    `Territorio: ${profileMatch.territoryMatched ?? "N/D"}.`,
    `Razones: ${profileMatch.scoreReasons.slice(0, 5).join("; ")}.`,
  ].join(" ");

  return {
    radarKey: radar.key,
    procurementId: procurement.externalId,
    matchScore,
    opportunityScore: calculateOpportunityScore(procurement),
    documentScore: calculateDocumentScore(procurement),
    matchLevel: scoreToLevel(matchScore),
    matchedTerms: [
      ...profileMatch.keywordMatches.primary,
      ...profileMatch.keywordMatches.secondary,
      ...profileMatch.keywordMatches.strongContext,
    ].slice(0, 12),
    excludedTerms: profileMatch.negativeMatches,
    explanation,
    commercialProfileId: profileMatch.profileId,
    commercialProfileName: profileMatch.displayName,
    commercialCompanyName: profileMatch.companyName,
    commercialScoreReasons: profileMatch.scoreReasons,
    commercialTerritoryMatched: profileMatch.territoryMatched,
    commercialShouldSave: profileMatch.shouldSave,
    commercialShouldAlert: profileMatch.shouldAlert,
    commercialDiscardReason: profileMatch.discardReason,
    isNew,
    isStatusChange:
      previousStatus !== null && previousStatus !== procurement.status,
    previousStatus,
  };
}

function evaluateImssMorelosPriorityRadar(
  procurement: NormalizedProcurement,
  isNew: boolean,
  previousStatus: NormalizedProcurement["status"] | null,
): MatchResult | null {
  const detection = detectImssMorelosPriority(procurement);
  if (!detection) return null;

  const matchedTerms = [
    ...detection.imssTerms,
    ...detection.territoryTerms,
  ];
  const explanation = [
    "PRIORIDAD INSTITUCIONAL IMSS MORELOS.",
    "Motivo: buyer_imss + territory_morelos + priority_institutional_radar.",
    `Territorio detectado: ${detection.territoryMatched}.`,
    isNew ? "Expediente nuevo — primera vez detectado." : "",
    previousStatus !== null && previousStatus !== procurement.status
      ? "Cambio de estatus detectado."
      : "",
  ].filter(Boolean).join(" ");

  return {
    radarKey: IMSS_MORELOS_RADAR_KEY,
    procurementId: procurement.externalId,
    matchScore: 1,
    opportunityScore: calculateOpportunityScore(procurement),
    documentScore: calculateDocumentScore(procurement),
    matchLevel: "high",
    matchedTerms: [...new Set(matchedTerms)],
    excludedTerms: [],
    explanation,
    scoreReasons: IMSS_MORELOS_SCORE_REASONS,
    territoryMatched: detection.territoryMatched,
    isNew,
    isStatusChange:
      previousStatus !== null && previousStatus !== procurement.status,
    previousStatus,
  };
}

function evaluateCapufeDirectAwardsRadar(
  procurement: NormalizedProcurement,
  isNew: boolean,
  previousStatus: NormalizedProcurement["status"] | null,
): MatchResult | null {
  const detection = detectCapufeDirectAward(procurement);
  if (!detection) return null;

  const matchedTerms = [
    ...detection.capufeTerms,
    ...detection.directAwardTerms,
  ];
  const explanation = [
    "PRIORIDAD CAPUFE ADJUDICACION DIRECTA.",
    "Motivo: buyer_capufe + procedure_direct_award + priority_capufe_direct_award.",
    isNew ? "Expediente nuevo — primera vez detectado." : "",
    previousStatus !== null && previousStatus !== procurement.status
      ? "Cambio de estatus detectado."
      : "",
  ].filter(Boolean).join(" ");

  return {
    radarKey: CAPUFE_DIRECT_AWARDS_RADAR_KEY,
    procurementId: procurement.externalId,
    matchScore: 1,
    opportunityScore: calculateOpportunityScore(procurement),
    documentScore: calculateDocumentScore(procurement),
    matchLevel: "high",
    matchedTerms: [...new Set(matchedTerms)],
    excludedTerms: [],
    explanation,
    scoreReasons: CAPUFE_DIRECT_AWARDS_SCORE_REASONS,
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
