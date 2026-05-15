import { findMatchingTerms } from "../../core/text";
import { MORELOS_TERMS } from "./keywords";
import type {
  ExternalLeadCandidate,
  ExternalLeadConfidence,
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

function isRecentEnough(sourcePublishedAt: string | null, lookbackDays: number): boolean {
  if (!sourcePublishedAt) return false;
  const published = new Date(sourcePublishedAt).getTime();
  if (!Number.isFinite(published)) return false;
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return published >= cutoff;
}

export function scoreExternalLead(
  candidate: ExternalLeadCandidate,
  lookbackDays: number,
): ExternalLeadScoreResult {
  let score = 0;

  if (candidate.sourceUrl && candidate.isOfficialSource) score += 15;

  switch (candidate.opportunityType) {
    case "licitacion":
      score += 25;
      break;
    case "licitacion_proxima":
      score += 20;
      break;
    case "contrato_historico":
      score += 14;
      break;
    case "senal_comercial_publica":
      score += 8;
      break;
  }

  const scopeText = [
    candidate.state ?? "",
    candidate.municipality ?? "",
    candidate.title,
    candidate.evidenceText,
  ].join(" ");
  if (candidate.state === "Morelos" || findMatchingTerms(scopeText, MORELOS_TERMS).length > 0) {
    score += 20;
  }

  const distinctKeywords = new Set(candidate.matchedKeywords.map((term) => term.toLowerCase()));
  score += Math.min(22, distinctKeywords.size * 5);
  const hasMorelosScope =
    candidate.state === "Morelos" || findMatchingTerms(scopeText, MORELOS_TERMS).length > 0;

  if (candidate.amountVisible) score += 8;
  if (candidate.buyerAreaIdentified || candidate.contactArea) score += 8;
  if (isRecentEnough(candidate.sourcePublishedAt, lookbackDays)) score += 8;

  if (!candidate.evidenceText.trim()) score = Math.min(score, 35);
  if (!candidate.isOfficialSource) score = Math.min(score, 45);
  if (distinctKeywords.size <= 1) score = Math.min(score, 55);
  if (
    candidate.opportunityType === "senal_comercial_publica" &&
    (distinctKeywords.size <= 2 || !candidate.buyerAreaIdentified || !candidate.isOfficialSource)
  ) {
    score = Math.min(score, 44);
  } else if (candidate.opportunityType === "senal_comercial_publica") {
    score = Math.min(score, 65);
  }
  if (candidate.opportunityType === "contrato_historico") {
    const hasStrongHistoricalEvidence =
      distinctKeywords.size >= 4 &&
      candidate.amountVisible &&
      candidate.buyerAreaIdentified &&
      candidate.isOfficialSource &&
      hasMorelosScope;
    score = Math.min(score, hasStrongHistoricalEvidence ? 78 : 74);
  }

  const finalScore = clampScore(score);

  return {
    score: finalScore,
    confidence: confidenceFromScore(finalScore),
    nextAction: nextActionForScore(finalScore),
  };
}

export function shouldAlertExternalLead(
  score: number,
  minScore: number,
  confidence: ExternalLeadConfidence = confidenceFromScore(score),
): boolean {
  return score >= minScore && confidence !== "LOW";
}
