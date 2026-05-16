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
  opportunityType: ExternalOpportunityType;
  amountVisible: boolean;
  buyerAreaIdentified: boolean;
  isOfficialSource: boolean;
  sourcePublishedAt: string | null;
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
  buyerAreaIdentified: boolean;
  isOfficialSource: boolean;
  sourcePublishedAt: string | null;
  raw: Record<string, unknown>;
}

export interface ExternalLeadScoreResult {
  score: number;
  confidence: ExternalLeadConfidence;
  nextAction: string;
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
}

export interface ExternalLeadSourceQueryResult {
  sourceName: string;
  query: string;
  url: string;
  httpStatus: number | null;
  ok: boolean;
  error: string | null;
}

export interface ExternalLeadRunResult {
  status: "success" | "skipped" | "error";
  reason?: string;
  dryRun: boolean;
  sourcesReviewed: number;
  detected: number;
  saved: number;
  alerted: number;
  skippedLowScore: number;
  skippedMissingSourceUrl: number;
  skippedMissingEvidence: number;
  skippedDuplicateAlert: number;
  telegramCandidates: number;
  errors: string[];
  errorsBySource: Record<string, string[]>;
  sourceQueries: ExternalLeadSourceQueryResult[];
}
