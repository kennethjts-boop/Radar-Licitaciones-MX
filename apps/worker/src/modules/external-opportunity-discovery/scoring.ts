import { findMatchingTerms, textContainsTerm } from "../../core/text";
import { MORELOS_TERMS } from "./keywords";
import type {
  ExternalLeadCandidate,
  ExternalLeadConfidence,
  ExternalLeadScoreBreakdown,
  ExternalLeadScoreResult,
} from "./types";

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceFromScore(score: number): ExternalLeadConfidence {
  if (score >= 75) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}

function nextActionForScore(score: number): string {
  if (score >= 75) return "revisar y contactar area publica";
  if (score >= 45) return "monitorear y validar antecedente";
  return "monitorear";
}

function ageDays(sourcePublishedAt: string | null): number | null {
  if (!sourcePublishedAt) return null;
  const published = new Date(sourcePublishedAt).getTime();
  if (!Number.isFinite(published)) return null;
  return Math.max(0, Math.floor((Date.now() - published) / (24 * 60 * 60 * 1000)));
}

function scoreFreshness(
  sourcePublishedAt: string | null,
  lookbackDays: number,
  reasons: string[],
): number {
  const age = ageDays(sourcePublishedAt);
  if (age === null) {
    reasons.push("fresh: publication date unavailable");
    return 2;
  }
  if (age <= 7) {
    reasons.push("fresh: less than 7 days");
    return 12;
  }
  if (age <= 30) {
    reasons.push("fresh: less than 30 days");
    return 8;
  }
  if (age <= lookbackDays) {
    reasons.push(`fresh: within ${lookbackDays} days`);
    return 5;
  }

  reasons.push(`fresh: older than ${lookbackDays} days`);
  return 0;
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => textContainsTerm(text, term));
}

export const PROCUREMENT_INTENT_TERMS = [
  "convocatoria",
  "licitacion",
  "licitación",
  "adjudicacion",
  "adjudicación",
  "contrato",
  "fallo",
  "bases",
  "suministro",
  "mantenimiento",
  "obra publica",
  "obra pública",
  "servicio de limpieza",
  "arrendamiento",
  "construccion",
  "construcción",
  "rehabilitacion",
  "rehabilitación",
  "pavimentacion",
  "pavimentación",
  "equipamiento",
  "publica bases",
  "publicó bases",
  "firma convenio para construccion",
  "firma convenio para construcción",
];

export const INSTITUTIONAL_NOISE_TERMS = [
  "bebe",
  "bebé",
  "bebe nacido",
  "bebé nacido",
  "cirugia",
  "cirugía",
  "jornada medica",
  "jornada médica",
  "reconstruccion mamaria",
  "reconstrucción mamaria",
  "bienvenida",
  "pacientes",
  "consulta medica",
  "consulta médica",
  "salud preventiva",
  "vacunacion",
  "vacunación",
  "evento deportivo",
  "cultura",
  "ceremonia",
  "entrega simbolica",
  "entrega simbólica",
  "reconocimiento",
  "capacitacion interna",
  "capacitación interna",
  "comunicado social",
];

export function scoreExternalLead(
  candidate: ExternalLeadCandidate,
  lookbackDays: number,
): ExternalLeadScoreResult {
  const reasons: string[] = [];
  const text = [
    candidate.title,
    candidate.evidenceText,
    candidate.organizationName ?? "",
    candidate.state ?? "",
    candidate.municipality ?? "",
    candidate.sourceUrl,
  ].join(" ");
  const normalizedText = text.toLowerCase();
  const hasProcurementIntent = hasAny(normalizedText, PROCUREMENT_INTENT_TERMS);
  const institutionalNoiseMatches = findMatchingTerms(normalizedText, INSTITUTIONAL_NOISE_TERMS);

  const distinctKeywords = new Set(candidate.matchedKeywords.map((term) => term.toLowerCase()));
  const keywordScore = Math.min(24, distinctKeywords.size * 6);
  if (distinctKeywords.size > 0) {
    reasons.push(`keyword: ${candidate.matchedKeywords.slice(0, 4).join(", ")}`);
  } else {
    reasons.push("keyword: none");
  }

  const freshnessScore = scoreFreshness(candidate.sourcePublishedAt, lookbackDays, reasons);

  let sourceTrustScore = 0;
  if (candidate.sourceUrl && candidate.isOfficialSource) {
    sourceTrustScore = 16;
    reasons.push("source: official");
  } else if (candidate.sourceUrl) {
    sourceTrustScore = 5;
    reasons.push("source: public non-official");
  } else {
    reasons.push("source: missing public URL");
  }

  const scopeText = [
    candidate.state ?? "",
    candidate.municipality ?? "",
    candidate.title,
    candidate.evidenceText,
  ].join(" ");
  const hasMorelosScope =
    candidate.state === "Morelos" || findMatchingTerms(scopeText, MORELOS_TERMS).length > 0;
  const geographyScore = hasMorelosScope ? 18 : hasAny(scopeText, ["capufe", "caminos y puentes federales"]) ? 10 : 2;
  if (hasMorelosScope) reasons.push("geography: Morelos");
  else if (geographyScore >= 10) reasons.push("geography: CAPUFE national");
  else reasons.push("geography: weak or broad");

  let opportunityScore = 0;
  switch (candidate.opportunityType) {
    case "licitacion":
      opportunityScore = 20;
      reasons.push("opportunity: active public tender");
      break;
    case "licitacion_proxima":
      opportunityScore = 16;
      reasons.push("opportunity: upcoming tender signal");
      break;
    case "contrato_historico":
      opportunityScore = 10;
      reasons.push("opportunity: historical contract");
      break;
    case "senal_comercial_publica":
      opportunityScore = 5;
      reasons.push("opportunity: weak public signal");
      break;
  }

  if (
    hasAny(normalizedText, [
      "desierta",
      "sin participantes",
      "segunda convocatoria",
      "baja competencia",
      "adjudicacion directa",
      "adjudicación directa",
    ])
  ) {
    opportunityScore += 6;
    reasons.push("opportunity: low competition or deserted signal");
  }

  if (hasProcurementIntent && candidate.opportunityType === "senal_comercial_publica") {
    opportunityScore += 8;
    reasons.push("opportunity: procurement intent in public signal");
  }

  let evidenceScore = 0;
  if (candidate.sourceUrl) evidenceScore += 4;
  if (candidate.evidenceText.trim().length >= 60) evidenceScore += 5;
  if (candidate.amountVisible) evidenceScore += 4;
  if (candidate.buyerAreaIdentified || candidate.contactArea) evidenceScore += 4;
  evidenceScore = Math.min(15, evidenceScore);
  if (candidate.sourceUrl) reasons.push("evidence: public URL");
  if (candidate.amountVisible) reasons.push("evidence: amount visible");
  if (candidate.buyerAreaIdentified || candidate.contactArea) reasons.push("evidence: buyer area identified");

  let urgencyScore = 0;
  if (
    hasAny(normalizedText, [
      "vence",
      "junta de aclaraciones",
      "presentacion de proposiciones",
      "presentación de proposiciones",
      "apertura de proposiciones",
      "convocatoria",
      "bases",
    ])
  ) {
    urgencyScore = 7;
    reasons.push("urgency: tender calendar signal");
  }

  let score =
    keywordScore +
    freshnessScore +
    sourceTrustScore +
    geographyScore +
    opportunityScore +
    evidenceScore +
    urgencyScore;

  let negativePenalty = 0;
  if (institutionalNoiseMatches.length > 0) {
    negativePenalty = hasProcurementIntent ? 12 : 30;
    score -= negativePenalty;
    reasons.push(`penalty: institutional noise (${institutionalNoiseMatches.slice(0, 3).join(", ")})`);
  }

  if (!candidate.evidenceText.trim()) {
    score = Math.min(score, 35);
    reasons.push("penalty: missing evidence text");
  }
  if (!candidate.sourceUrl.trim()) {
    score = Math.min(score, 30);
    reasons.push("penalty: missing source URL");
  }
  if (!candidate.isOfficialSource) {
    score = Math.min(score, 45);
    reasons.push("penalty: non-official source cap");
  }
  if (distinctKeywords.size <= 1) {
    score = Math.min(score, 55);
    reasons.push("penalty: weak keyword diversity");
  }
  if (
    candidate.opportunityType === "senal_comercial_publica" &&
    (distinctKeywords.size <= 2 || !candidate.buyerAreaIdentified || !candidate.isOfficialSource)
  ) {
    score = Math.min(score, 44);
    reasons.push("penalty: weak commercial signal");
  } else if (candidate.opportunityType === "senal_comercial_publica") {
    score = Math.min(score, 65);
    reasons.push("penalty: public signal cap");
  }
  if (institutionalNoiseMatches.length > 0 && !hasProcurementIntent) {
    score = Math.min(score, 24);
    reasons.push("cap: institutional/social/medical note without procurement intent");
  }
  if (candidate.opportunityType === "contrato_historico") {
    const hasStrongHistoricalEvidence =
      distinctKeywords.size >= 4 &&
      candidate.amountVisible &&
      candidate.buyerAreaIdentified &&
      candidate.isOfficialSource &&
      hasMorelosScope;
    score = Math.min(score, hasStrongHistoricalEvidence ? 78 : 74);
    reasons.push(
      hasStrongHistoricalEvidence
        ? "cap: strong historical contract"
        : "cap: historical contract requires manual validation",
    );
  }

  const finalScore = clampScore(score);
  const scoreBreakdown: ExternalLeadScoreBreakdown = {
    keywordScore,
    recencyScore: freshnessScore,
    freshnessScore,
    sourceQualityScore: sourceTrustScore,
    sourceTrustScore,
    territoryScore: geographyScore,
    geographyScore,
    procurementIntentScore: opportunityScore,
    opportunityScore,
    evidenceScore,
    urgencyScore,
    negativePenalty,
    finalScore,
  };

  return {
    score: finalScore,
    confidence: confidenceFromScore(finalScore),
    nextAction: nextActionForScore(finalScore),
    scoreReasons: [...new Set(reasons)].slice(0, 12),
    scoreBreakdown,
  };
}

export function shouldAlertExternalLead(
  score: number,
  minScore: number,
  confidence: ExternalLeadConfidence = confidenceFromScore(score),
): boolean {
  return score >= minScore && confidence !== "LOW";
}
