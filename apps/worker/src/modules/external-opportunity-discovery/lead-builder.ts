import {
  buildExternalLeadFingerprint,
  redactSensitivePublicData,
  sanitizePublicContact,
} from "./matching";
import { scoreExternalLead } from "./scoring";
import type { ExternalLead, ExternalLeadCandidate } from "./types";

export function buildExternalLead(
  candidate: ExternalLeadCandidate,
  lookbackDays: number,
): ExternalLead {
  const baseScore = scoreExternalLead(candidate, lookbackDays);
  const commercialScore = candidate.scoreBreakdown?.finalScore;
  const finalScore = typeof commercialScore === "number" ? commercialScore : baseScore.score;
  const score = {
    ...baseScore,
    score: finalScore,
    confidence: finalScore >= 75 ? "HIGH" as const : finalScore >= 45 ? "MEDIUM" as const : "LOW" as const,
    nextAction: candidate.scoreReasons?.length
      ? finalScore >= 60
        ? "revisar posible oportunidad publica y validar fuente"
        : "monitorear candidato comercial"
      : baseScore.nextAction,
    scoreReasons: candidate.scoreReasons ?? baseScore.scoreReasons,
    scoreBreakdown: candidate.scoreBreakdown ?? baseScore.scoreBreakdown,
  };
  const contact = sanitizePublicContact(candidate);

  return {
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    detectedAt: candidate.detectedAt,
    title: redactSensitivePublicData(candidate.title),
    organizationName: candidate.organizationName,
    organizationType: candidate.organizationType,
    state: candidate.state,
    municipality: candidate.municipality,
    sector: candidate.sector,
    vertical: candidate.vertical,
    matchedKeywords: candidate.matchedKeywords,
    evidenceText: redactSensitivePublicData(candidate.evidenceText),
    contactArea: contact.contactArea,
    contactNamePublicOptional: contact.contactNamePublicOptional,
    contactEmailPublicOptional: contact.contactEmailPublicOptional,
    contactPhonePublicOptional: contact.contactPhonePublicOptional,
    estimatedInterestScore: score.score,
    opportunityType: candidate.opportunityType,
    confidence: score.confidence,
    nextAction: score.nextAction,
    status: "new",
    fingerprintHash: buildExternalLeadFingerprint(candidate),
    amountVisible: candidate.amountVisible,
    amount: candidate.amount ?? null,
    buyerAreaIdentified: candidate.buyerAreaIdentified,
    isOfficialSource: candidate.isOfficialSource,
    sourcePublishedAt: candidate.sourcePublishedAt,
    scoreReasons: score.scoreReasons,
    scoreBreakdown: score.scoreBreakdown,
    raw: {
      ...candidate.raw,
      sourceId: candidate.sourceId ?? candidate.sourceName,
      canonicalUrl: candidate.canonicalUrl ?? candidate.sourceUrl,
      dependency: candidate.dependency ?? candidate.organizationName,
      procedureId: candidate.procedureId ?? null,
      scoreReasons: score.scoreReasons,
      scoreBreakdown: score.scoreBreakdown,
    },
  };
}
