import type {
  CommercialOpportunityInput,
  CommercialOpportunityMatchResult,
  CommercialProfileMatch,
} from "./types";

export interface CommercialTelemetryCandidate {
  title: string;
  source: string;
  score: number;
  reason: string | null;
  publicUrl: string | null;
  profile: string | null;
  territory: string | null;
}

export interface CommercialMatchingTelemetry {
  totalReviewed: number;
  rawResultsReceived: number;
  commercialCandidates: number;
  matchedProfiles: number;
  discardedByNoTerritory: number;
  discardedByKeyword: number;
  discardedByNegativeKeyword: number;
  discardedByLowScore: number;
  discardedByMissingEvidence: number;
  discardedByDeduplication: number;
  discardedByDate: number;
  discardedBySourceError: number;
  matchesByProfile: Record<string, number>;
  matchesByTerritory: Record<string, number>;
  topDiscardedCandidates: CommercialTelemetryCandidate[];
  topMatchedCandidates: CommercialTelemetryCandidate[];
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN =
  /(?:\+?52[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}\b/g;

export function createCommercialMatchingTelemetry(
  rawResultsReceived = 0,
): CommercialMatchingTelemetry {
  return {
    totalReviewed: 0,
    rawResultsReceived,
    commercialCandidates: 0,
    matchedProfiles: 0,
    discardedByNoTerritory: 0,
    discardedByKeyword: 0,
    discardedByNegativeKeyword: 0,
    discardedByLowScore: 0,
    discardedByMissingEvidence: 0,
    discardedByDeduplication: 0,
    discardedByDate: 0,
    discardedBySourceError: 0,
    matchesByProfile: {},
    matchesByTerritory: {},
    topDiscardedCandidates: [],
    topMatchedCandidates: [],
  };
}

function sanitizeTitle(title: string): string {
  return title
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function publicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (["token", "access_token", "api_key", "key", "secret", "sig"].includes(key.toLowerCase())) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function candidateFromProfile(
  input: CommercialOpportunityInput,
  match: CommercialProfileMatch,
): CommercialTelemetryCandidate {
  return {
    title: sanitizeTitle(input.title),
    source: input.source,
    score: match.score,
    reason: match.discardReason,
    publicUrl: publicUrl(input.sourceUrl),
    profile: match.displayName,
    territory: match.territoryMatched,
  };
}

function pushTop(
  items: CommercialTelemetryCandidate[],
  candidate: CommercialTelemetryCandidate,
): void {
  items.push(candidate);
  items.sort((left, right) => right.score - left.score);
  items.splice(5);
}

export function recordCommercialMatchTelemetry(
  telemetry: CommercialMatchingTelemetry,
  input: CommercialOpportunityInput,
  result: CommercialOpportunityMatchResult,
): void {
  telemetry.totalReviewed++;

  if (result.keywordMatches.length > 0 || result.negativeMatches.length > 0) {
    telemetry.commercialCandidates++;
  }

  for (const match of result.matchedProfiles) {
    telemetry.matchedProfiles++;
    telemetry.matchesByProfile[match.displayName] =
      (telemetry.matchesByProfile[match.displayName] ?? 0) + 1;
    if (match.territoryMatched) {
      telemetry.matchesByTerritory[match.territoryMatched] =
        (telemetry.matchesByTerritory[match.territoryMatched] ?? 0) + 1;
    }
    pushTop(telemetry.topMatchedCandidates, candidateFromProfile(input, match));
  }

  for (const discarded of result.topDiscardedProfiles) {
    switch (discarded.discardReason) {
      case "no_territory":
        telemetry.discardedByNoTerritory++;
        break;
      case "no_keyword":
      case "generic_keyword_without_context":
        telemetry.discardedByKeyword++;
        break;
      case "negative_keyword":
        telemetry.discardedByNegativeKeyword++;
        break;
      case "missing_evidence":
        telemetry.discardedByMissingEvidence++;
        break;
      case "date":
        telemetry.discardedByDate++;
        break;
      case "source_error":
        telemetry.discardedBySourceError++;
        break;
      case "deduplication":
        telemetry.discardedByDeduplication++;
        break;
      case "low_score":
      default:
        telemetry.discardedByLowScore++;
        break;
    }
    pushTop(telemetry.topDiscardedCandidates, candidateFromProfile(input, discarded));
  }
}
