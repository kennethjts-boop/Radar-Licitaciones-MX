import {
  COMMERCIAL_PROFILES,
  STRONG_COMMERCIAL_CONTEXT_KEYWORDS,
  type CommercialProfile,
} from "../commercial-profiles";
import { detectCommercialTerritory } from "../commercial-profiles/territories";
import { findMatchingTerms, normalizeText } from "../../core/text";
import type {
  CommercialDiscardReason,
  CommercialMatchOptions,
  CommercialOpportunityInput,
  CommercialOpportunityMatchResult,
  CommercialProfileMatch,
  CommercialScoreLevel,
} from "./types";

export type {
  CommercialDiscardReason,
  CommercialMatchOptions,
  CommercialOpportunityInput,
  CommercialOpportunityMatchResult,
  CommercialProfileMatch,
  CommercialScoreLevel,
} from "./types";

const DEFAULT_MIN_SCORE = 60;
const SPECIFIC_PRIMARY_KEYWORDS = [
  "anticongelante",
  "anticongelantes",
  "liquido refrigerante",
  "líquido refrigerante",
  "control de confianza",
  "evaluacion psicometrica",
  "evaluación psicométrica",
  "evaluaciones psicometricas",
  "evaluaciones psicométricas",
  "evaluacion socioeconomica",
  "evaluación socioeconómica",
  "guardia armado",
  "guardias armados",
  "guardia desarmado",
  "guardias desarmados",
  "seguridad intramuros",
  "impresion offset",
  "impresión offset",
  "impresion digital",
  "impresión digital",
  "obra civil",
  "impermeabilizacion",
  "impermeabilización",
  "mantenimiento de inmuebles",
  "mantenimiento de edificios",
  "mantenimiento de oficinas",
];

const GENERIC_KEYWORDS = [
  "aceite",
  "aceites",
  "impresion",
  "impresión",
  "mantenimiento",
  "seguridad",
  "vigilancia",
  "servicio",
  "obra",
  "instalaciones",
];

const BUYER_TYPE_TERMS = [
  "gobierno",
  "secretaria",
  "secretaría",
  "municipio",
  "ayuntamiento",
  "organismo publico",
  "organismo público",
  "universidad",
  "hospital",
  "instituto",
  "fideicomiso",
  "dependencia",
];

function scoreLevel(score: number): CommercialScoreLevel {
  if (score >= 75) return "high";
  if (score >= 60) return "medium";
  if (score > 0) return "low";
  return "none";
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function evidenceText(input: CommercialOpportunityInput): string {
  return [
    input.title,
    input.description ?? "",
    input.buyerName ?? "",
    input.dependency ?? "",
    input.unit ?? "",
    input.procedureId ?? "",
    input.source ?? "",
    input.state ?? "",
    input.municipality ?? "",
    input.placeOfExecution ?? "",
    input.placeOfDelivery ?? "",
    input.fullText ?? "",
    ...(input.attachmentsText ?? []),
  ].join(" ");
}

function isSpecificPrimary(matches: string[]): boolean {
  return matches.some((match) =>
    SPECIFIC_PRIMARY_KEYWORDS.some(
      (specific) => normalizeText(specific) === normalizeText(match),
    ),
  );
}

function onlyGenericPrimary(matches: string[]): boolean {
  if (matches.length === 0) return false;
  return matches.every((match) =>
    GENERIC_KEYWORDS.some((generic) => normalizeText(generic) === normalizeText(match)),
  );
}

function hasBuyerType(input: CommercialOpportunityInput, text: string): boolean {
  const structured = [
    input.buyerName ?? "",
    input.dependency ?? "",
    input.unit ?? "",
  ].join(" ");
  return (
    findMatchingTerms(structured, BUYER_TYPE_TERMS).length > 0 ||
    findMatchingTerms(text, BUYER_TYPE_TERMS).length > 0
  );
}

function hasClearEvidence(input: CommercialOpportunityInput, text: string): boolean {
  return Boolean(input.sourceUrl) ||
    text.trim().length >= 40 ||
    Boolean(input.procedureId) ||
    Boolean(input.publicationDate);
}

function datePenalty(input: CommercialOpportunityInput): number {
  if (!input.publicationDate) return 0;
  const date = Date.parse(input.publicationDate);
  if (!Number.isFinite(date)) return 0;
  const ageDays = Math.floor((Date.now() - date) / (24 * 60 * 60 * 1000));
  return ageDays > 365 ? 8 : 0;
}

function buildProfileMatch(
  profile: CommercialProfile,
  input: CommercialOpportunityInput,
  options: Required<Pick<CommercialMatchOptions, "minScore" | "requireTerritory">>,
): CommercialProfileMatch {
  const text = evidenceText(input);
  const primary = unique(findMatchingTerms(text, profile.primaryKeywords));
  const secondary = unique(findMatchingTerms(text, profile.secondaryKeywords));
  const strongContext = unique(
    findMatchingTerms(text, unique([...profile.strongContextKeywords, ...STRONG_COMMERCIAL_CONTEXT_KEYWORDS])),
  );
  const weakContext = unique(findMatchingTerms(text, profile.weakContextKeywords));
  const negativeMatches = unique(findMatchingTerms(text, profile.negativeKeywords));
  const territory = detectCommercialTerritory({
    text,
    state: input.state,
    municipality: input.municipality,
    placeOfExecution: input.placeOfExecution,
    placeOfDelivery: input.placeOfDelivery,
    territories: profile.territories,
  });
  const buyerType = hasBuyerType(input, text);
  const clearEvidence = hasClearEvidence(input, text);
  const specificPrimary = isSpecificPrimary(primary);
  const genericOnly = onlyGenericPrimary(primary);
  const minScore = Math.max(options.minScore, profile.minScore);
  const reasons: string[] = [];
  let score = 0;

  if (primary.length >= 2) {
    score += 38;
    reasons.push(`2+ keywords principales: ${primary.slice(0, 4).join(", ")}`);
  } else if (primary.length === 1 && specificPrimary) {
    score += 34;
    reasons.push(`keyword principal especifica: ${primary[0]}`);
  } else if (primary.length === 1) {
    score += 22;
    reasons.push(`keyword principal: ${primary[0]}`);
  }

  if (secondary.length > 0) {
    score += Math.min(12, secondary.length * 4);
    reasons.push(`contexto secundario: ${secondary.slice(0, 3).join(", ")}`);
  }

  if (strongContext.length > 0) {
    score += Math.min(16, strongContext.length * 5);
    reasons.push(`contexto de contratacion: ${strongContext.slice(0, 4).join(", ")}`);
  } else if (weakContext.length > 0) {
    score += Math.min(7, weakContext.length * 3);
    reasons.push(`contexto debil: ${weakContext.slice(0, 3).join(", ")}`);
  }

  if (territory.matched && !territory.isNationalPossible) {
    score += 18;
    reasons.push(`territorio objetivo: ${territory.territoryMatched}`);
  } else if (territory.isNationalPossible) {
    score += 8;
    reasons.push("territorio: Nacional / posible");
  }

  if (buyerType) {
    score += 5;
    reasons.push("comprador publico probable");
  }

  if (clearEvidence) {
    score += 5;
    reasons.push(input.sourceUrl ? "evidencia: URL publica" : "evidencia textual suficiente");
  }

  const publicationPenalty = datePenalty(input);
  if (publicationPenalty > 0) {
    score -= publicationPenalty;
    reasons.push("penalizacion: fecha antigua");
  }

  if (territory.isNationalPossible) {
    score -= 8;
    reasons.push("penalizacion: territorio nacional sin sede clara");
  }

  let discardReason: CommercialDiscardReason | null = null;
  if (primary.length === 0) {
    discardReason = "no_keyword";
    score = Math.min(score, 25);
  }

  if (negativeMatches.length > 0) {
    score -= 45;
    discardReason = "negative_keyword";
    reasons.push(`keyword negativa: ${negativeMatches.slice(0, 3).join(", ")}`);
  }

  if (
    genericOnly &&
    primary.length <= 1 &&
    strongContext.length === 0 &&
    secondary.length === 0
  ) {
    score = Math.min(score, 35);
    discardReason = discardReason ?? "generic_keyword_without_context";
    reasons.push("penalizacion: keyword generica sin contexto suficiente");
  }

  if (!clearEvidence) {
    score = Math.min(score, 45);
    discardReason = discardReason ?? "missing_evidence";
  }

  if (options.requireTerritory && !territory.matched) {
    score = Math.min(score, 50);
    discardReason = discardReason ?? "no_territory";
    reasons.push("sin territorio objetivo");
  }

  const finalScore = clampScore(score);
  if (!discardReason && finalScore < minScore) {
    discardReason = "low_score";
  }

  const shouldSave = discardReason !== "negative_keyword" &&
    primary.length > 0 &&
    finalScore >= minScore;
  const shouldAlert = profile.alertEnabled &&
    shouldSave &&
    finalScore >= minScore &&
    (territory.matched || !options.requireTerritory);

  const evidence = [
    input.title,
    input.dependency ?? input.buyerName ?? "",
    input.sourceUrl ?? "",
  ].filter(Boolean);

  return {
    profileId: profile.id,
    companyName: profile.companyName,
    displayName: profile.displayName,
    businessLines: profile.businessLines,
    score: finalScore,
    scoreLevel: scoreLevel(finalScore),
    scoreReasons: unique(reasons).slice(0, 12),
    territoryMatched: territory.territoryMatched,
    territoryTerms: territory.matchedTerms,
    keywordMatches: {
      primary,
      secondary,
      strongContext,
      weakContext,
    },
    negativeMatches,
    evidence,
    shouldAlert,
    shouldSave,
    discardReason,
  };
}

export function matchCommercialOpportunity(
  input: CommercialOpportunityInput,
  options: CommercialMatchOptions = {},
): CommercialOpportunityMatchResult {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const requireTerritory = options.requireTerritory ?? true;
  const profiles = options.profiles ?? COMMERCIAL_PROFILES;
  const profileMatches = profiles.map((profile) =>
    buildProfileMatch(profile, input, { minScore, requireTerritory }),
  );
  const matchedProfiles = profileMatches
    .filter((match) => match.shouldSave)
    .sort((left, right) => right.score - left.score);
  const topDiscardedProfiles = profileMatches
    .filter((match) => !match.shouldSave)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  const best = matchedProfiles[0] ?? topDiscardedProfiles[0] ?? null;
  const allKeywordMatches = unique(
    matchedProfiles.flatMap((match) => [
      ...match.keywordMatches.primary,
      ...match.keywordMatches.secondary,
      ...match.keywordMatches.strongContext,
    ]),
  );
  const allNegativeMatches = unique(profileMatches.flatMap((match) => match.negativeMatches));
  const shouldAlert = matchedProfiles.some((match) => match.shouldAlert);
  const shouldSave = matchedProfiles.some((match) => match.shouldSave);
  const discardReason = shouldSave
    ? null
    : allNegativeMatches.length > 0
      ? "negative_keyword"
      : best?.discardReason ?? "low_score";

  return {
    matched: matchedProfiles.length > 0,
    matchedProfiles,
    score: best?.score ?? 0,
    scoreLevel: best?.scoreLevel ?? "none",
    scoreReasons: best?.scoreReasons ?? [],
    territoryMatched: best?.territoryMatched ?? null,
    keywordMatches: allKeywordMatches,
    negativeMatches: allNegativeMatches,
    evidence: unique(matchedProfiles.flatMap((match) => match.evidence)).slice(0, 8),
    shouldAlert,
    shouldSave,
    discardReason,
    topDiscardedProfiles,
  };
}
