import type {
  CommercialProfile,
  CommercialProfileId,
} from "../commercial-profiles";

export type CommercialScoreLevel = "high" | "medium" | "low" | "none";

export type CommercialDiscardReason =
  | "no_keyword"
  | "negative_keyword"
  | "low_score"
  | "no_territory"
  | "missing_evidence"
  | "generic_keyword_without_context"
  | "date"
  | "deduplication"
  | "source_error";

export interface CommercialOpportunityInput {
  title: string;
  description?: string | null;
  buyerName?: string | null;
  dependency?: string | null;
  unit?: string | null;
  procedureId?: string | null;
  source: string;
  sourceUrl?: string | null;
  publicationDate?: string | null;
  state?: string | null;
  municipality?: string | null;
  placeOfExecution?: string | null;
  placeOfDelivery?: string | null;
  fullText?: string | null;
  attachmentsText?: string[] | null;
}

export interface CommercialProfileMatch {
  profileId: CommercialProfileId;
  companyName: string;
  displayName: string;
  businessLines: string[];
  score: number;
  scoreLevel: CommercialScoreLevel;
  scoreReasons: string[];
  territoryMatched: string | null;
  territoryTerms: string[];
  keywordMatches: {
    primary: string[];
    secondary: string[];
    strongContext: string[];
    weakContext: string[];
  };
  negativeMatches: string[];
  evidence: string[];
  shouldAlert: boolean;
  shouldSave: boolean;
  discardReason: CommercialDiscardReason | null;
}

export interface CommercialOpportunityMatchResult {
  matched: boolean;
  matchedProfiles: CommercialProfileMatch[];
  score: number;
  scoreLevel: CommercialScoreLevel;
  scoreReasons: string[];
  territoryMatched: string | null;
  keywordMatches: string[];
  negativeMatches: string[];
  evidence: string[];
  shouldAlert: boolean;
  shouldSave: boolean;
  discardReason: CommercialDiscardReason | null;
  topDiscardedProfiles: CommercialProfileMatch[];
}

export interface CommercialMatchOptions {
  profiles?: CommercialProfile[];
  minScore?: number;
  requireTerritory?: boolean;
  debug?: boolean;
}
