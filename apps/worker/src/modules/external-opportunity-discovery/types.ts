export type ExternalLeadVertical =
  | "aceites_lubricantes"
  | "impresos_primasa"
  | "impresos_coformex"
  | "seguridad_confianza_riesgo"
  | "construccion_mantenimiento";

export type ExternalOpportunityType =
  | "licitacion"
  | "licitacion_proxima"
  | "contrato_historico"
  | "senal_comercial_publica";

export type ExternalLeadConfidence = "LOW" | "MEDIUM" | "HIGH";
export type ExternalLeadDiscardReason =
  | "keyword"
  | "evidence"
  | "date"
  | "sanitization"
  | "scope"
  | "score"
  | "deduplication"
  | "missing_source_url"
  | "missing_evidence";

export type ExternalDiscardReason = ExternalLeadDiscardReason;

export type ExternalSourceType =
  | "datos_gob_mx"
  | "dof"
  | "official_gazette"
  | "official_website"
  | "rss"
  | "pdf"
  | "pnt_sipot"
  | "press_release";

export interface ExternalLeadEvidence {
  title: string;
  text: string;
  publicUrl: string | null;
  sourceName: string;
  publishedAt: string | null;
  matchedKeywords: string[];
  amountVisible: boolean;
  buyerAreaIdentified: boolean;
}

export interface RawExternalItem {
  sourceId: string;
  sourceName: string;
  sourceType: ExternalSourceType;
  sourceUrl: string | null;
  title: string | null;
  snippet: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  raw: Record<string, unknown>;
}

export interface NormalizedExternalLead {
  sourceId: string;
  sourceName: string;
  sourceType: ExternalSourceType;
  sourceUrl: string;
  canonicalUrl: string;
  detectedAt: string;
  title: string;
  organizationName: string | null;
  organizationType: string | null;
  dependency: string | null;
  state: string | null;
  municipality: string | null;
  sector: string | null;
  vertical: ExternalLeadVertical;
  matchedKeywords: string[];
  evidenceText: string;
  opportunityType: ExternalOpportunityType;
  amount: number | null;
  amountVisible: boolean;
  buyerAreaIdentified: boolean;
  isOfficialSource: boolean;
  sourcePublishedAt: string | null;
  procedureId: string | null;
  raw: Record<string, unknown>;
  contactArea?: string | null;
  contactNamePublicOptional?: string | null;
  contactEmailPublicOptional?: string | null;
  contactPhonePublicOptional?: string | null;
}

export interface SanitizedExternalLead extends NormalizedExternalLead {
  sanitizedAt: string;
}

export interface ExternalLeadScoreBreakdown {
  keywordScore: number;
  freshnessScore: number;
  sourceTrustScore: number;
  geographyScore: number;
  opportunityScore: number;
  evidenceScore: number;
  urgencyScore: number;
  finalScore: number;
}

export interface ScoredExternalLead extends SanitizedExternalLead {
  estimatedInterestScore: number;
  confidence: ExternalLeadConfidence;
  nextAction: string;
  scoreReasons: string[];
  scoreBreakdown: ExternalLeadScoreBreakdown;
  fingerprintHash: string;
}

export interface BusinessLineKeywordConfig {
  key: ExternalLeadVertical;
  displayName: string;
  referenceCompany: string;
  keywords: string[];
  osintSignals: string[];
}

export interface PublicContactFields {
  contactArea: string | null;
  contactNamePublicOptional: string | null;
  contactEmailPublicOptional: string | null;
  contactPhonePublicOptional: string | null;
}

export interface ExternalLeadCandidate extends Partial<PublicContactFields> {
  sourceId?: string;
  sourceName: string;
  sourceUrl: string;
  canonicalUrl?: string;
  detectedAt: string;
  title: string;
  organizationName: string | null;
  organizationType: string | null;
  dependency?: string | null;
  state: string | null;
  municipality: string | null;
  sector: string | null;
  vertical: ExternalLeadVertical;
  matchedKeywords: string[];
  evidenceText: string;
  opportunityType: ExternalOpportunityType;
  amountVisible: boolean;
  amount?: number | null;
  buyerAreaIdentified: boolean;
  isOfficialSource: boolean;
  sourcePublishedAt: string | null;
  procedureId?: string | null;
  scoreReasons?: string[];
  scoreBreakdown?: ExternalLeadScoreBreakdown;
  raw: Record<string, unknown>;
}

export interface ExternalLead extends PublicContactFields {
  id?: string;
  sourceName: string;
  sourceUrl: string;
  detectedAt: string;
  title: string;
  organizationName: string | null;
  organizationType: string | null;
  state: string | null;
  municipality: string | null;
  sector: string | null;
  vertical: ExternalLeadVertical;
  matchedKeywords: string[];
  evidenceText: string;
  estimatedInterestScore: number;
  opportunityType: ExternalOpportunityType;
  confidence: ExternalLeadConfidence;
  nextAction: string;
  status: "new" | "alert_sent" | "monitoring" | "dismissed";
  fingerprintHash: string;
  amountVisible: boolean;
  amount?: number | null;
  buyerAreaIdentified: boolean;
  isOfficialSource: boolean;
  sourcePublishedAt: string | null;
  scoreReasons?: string[];
  scoreBreakdown?: ExternalLeadScoreBreakdown;
  raw: Record<string, unknown>;
}

export interface ExternalLeadScoreResult {
  score: number;
  confidence: ExternalLeadConfidence;
  nextAction: string;
  scoreReasons: string[];
  scoreBreakdown: ExternalLeadScoreBreakdown;
}

export interface ExternalLeadDiscardedCandidate {
  sourceName: string;
  sourceUrl: string;
  publicUrl: string | null;
  detectedAt: string;
  title: string;
  vertical: ExternalLeadVertical;
  opportunityType: ExternalOpportunityType;
  matchedKeywords: string[];
  reasons: ExternalLeadDiscardReason[];
  estimatedScore: number | null;
  confidence: ExternalLeadConfidence | null;
  sourcePublishedAt: string | null;
}

export interface ExternalLeadCycleTelemetry {
  sourcesReviewed: number;
  rawResultsReceived: number;
  normalized: number;
  detected: number;
  saved: number;
  alerted: number;
  discardedByKeyword: number;
  discardedByEvidence: number;
  discardedByDate: number;
  discardedBySanitization: number;
  discardedByScope: number;
  discardedByScore: number;
  discardedByDeduplication: number;
  discardedByMissingSourceUrl: number;
  discardedByMissingEvidence: number;
  topDiscardedCandidates: ExternalLeadDiscardedCandidate[];
  errors: string[];
}

export interface ExternalLeadRunOptions {
  enabled: boolean;
  dryRun: boolean;
  maxResultsPerRun: number;
  minScore: number;
  lookbackDays: number;
  morelosOnly: boolean;
  targetLocations?: string[];
  telegramEnabled: boolean;
  discoveryMode: boolean;
  debugDiscards: boolean;
  saveLowScoreCandidates: boolean;
  maxRawResultsPerSource: number;
  sourceTimeoutMs: number;
}

export interface ExternalLeadSourceQueryResult {
  sourceId?: string;
  sourceName: string;
  sourceType?: ExternalSourceType;
  query: string;
  url: string;
  httpStatus: number | null;
  ok: boolean;
  error: string | null;
  rawResultsReceived?: number;
  normalized?: number;
  detected?: number;
  discarded?: number;
}

export interface ExternalLeadRunResult {
  status: "success" | "skipped" | "error";
  reason?: string;
  dryRun: boolean;
  discoveryMode: boolean;
  sourcesReviewed: number;
  rawResultsReceived: number;
  normalized: number;
  detected: number;
  saved: number;
  alerted: number;
  discardedByKeyword: number;
  discardedByEvidence: number;
  discardedByDate: number;
  discardedBySanitization: number;
  discardedByScope: number;
  discardedByScore: number;
  discardedByDeduplication: number;
  discardedByMissingSourceUrl: number;
  discardedByMissingEvidence: number;
  topDiscardedCandidates: ExternalLeadDiscardedCandidate[];
  skippedLowScore: number;
  skippedMissingSourceUrl: number;
  skippedMissingEvidence: number;
  skippedDuplicateAlert: number;
  telegramCandidates: number;
  errors: string[];
  errorsBySource: Record<string, string[]>;
  sourceQueries: ExternalLeadSourceQueryResult[];
}

export interface ExternalSourceResult {
  adapterId: string;
  sourceName: string;
  sourceType: ExternalSourceType;
  ok: boolean;
  error: string | null;
  httpStatus: number | null;
  rawResults: RawExternalItem[];
  rawResultsReceived: number;
  normalized: number;
  detected: number;
  candidates: ExternalLeadCandidate[];
  discardedCandidates: ExternalLeadDiscardedCandidate[];
  queryResult: ExternalLeadSourceQueryResult;
  telemetry: ExternalRunTelemetry;
}

export type ExternalRunTelemetry = ExternalLeadCycleTelemetry;

export interface SourceAdapter {
  id: string;
  name: string;
  type: ExternalSourceType;
  enabled: boolean;
  query?: string;
  url?: string;
  fetchRaw(options: ExternalLeadRunOptions): Promise<RawExternalItem[]>;
  normalize(
    raw: RawExternalItem,
    options: ExternalLeadRunOptions,
  ): NormalizedExternalLead | null;
  sanitize(
    normalized: NormalizedExternalLead,
    options: ExternalLeadRunOptions,
  ): SanitizedExternalLead | null;
  score(
    sanitized: SanitizedExternalLead,
    options: ExternalLeadRunOptions,
  ): ScoredExternalLead;
  buildFingerprint(scored: ScoredExternalLead): string;
  extractEvidence(raw: RawExternalItem): ExternalLeadEvidence;
}
