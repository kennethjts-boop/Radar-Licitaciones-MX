import { buildExternalLeadFingerprint, sanitizePublicContact } from "./matching";
import { scoreExternalLead } from "./scoring";
import type { ExternalLead, ExternalLeadCandidate } from "./types";

export function buildExternalLead(
  candidate: ExternalLeadCandidate,
  lookbackDays: number,
): ExternalLead {
  const score = scoreExternalLead(candidate, lookbackDays);
  const contact = sanitizePublicContact(candidate);

  return {
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    detectedAt: candidate.detectedAt,
    title: candidate.title,
    organizationName: candidate.organizationName,
    organizationType: candidate.organizationType,
    state: candidate.state,
    municipality: candidate.municipality,
    sector: candidate.sector,
    vertical: candidate.vertical,
    matchedKeywords: candidate.matchedKeywords,
    evidenceText: candidate.evidenceText,
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
    buyerAreaIdentified: candidate.buyerAreaIdentified,
    isOfficialSource: candidate.isOfficialSource,
    sourcePublishedAt: candidate.sourcePublishedAt,
    raw: candidate.raw,
  };
}
