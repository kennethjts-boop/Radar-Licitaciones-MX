import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { buildDiscardedCandidateSummary } from "./matching";
import { scoredLeadToCandidate, isUnwantedTitle } from "./source-adapters";
import type {
  ExternalLeadCandidate,
  ExternalLeadDiscardReason,
  ExternalLeadDiscardedCandidate,
  ExternalLeadRunOptions,
  ExternalLeadSourceQueryResult,
  ExternalLeadVertical,
  ExternalOpportunityType,
  ExternalRunTelemetry,
  ExternalSourceResult,
  RawExternalItem,
  SanitizedExternalLead,
  ScoredExternalLead,
  SourceAdapter,
} from "./types";

const log = createModuleLogger("external-osint-v2-pipeline");

export interface ExternalDiscoveryPipelineResult {
  candidates: ExternalLeadCandidate[];
  errors: string[];
  errorsBySource: Record<string, string[]>;
  sourcesReviewed: number;
  sourceQueries: ExternalLeadSourceQueryResult[];
  discardedCandidates: ExternalLeadDiscardedCandidate[];
  rawResultsReceived: number;
  normalized: number;
  discardedByKeyword: number;
  discardedByEvidence: number;
  discardedByDate: number;
  discardedBySanitization: number;
  discardedByScope: number;
  discardedByMissingSourceUrl: number;
  discardedByMissingEvidence: number;
}

const EMPTY_TELEMETRY: ExternalRunTelemetry = {
  sourcesReviewed: 0,
  rawResultsReceived: 0,
  normalized: 0,
  detected: 0,
  saved: 0,
  alerted: 0,
  discardedByKeyword: 0,
  discardedByEvidence: 0,
  discardedByDate: 0,
  discardedBySanitization: 0,
  discardedByScope: 0,
  discardedByScore: 0,
  discardedByDeduplication: 0,
  discardedByMissingSourceUrl: 0,
  discardedByMissingEvidence: 0,
  topDiscardedCandidates: [],
  errors: [],
};

export function emptyExternalRunTelemetry(): ExternalRunTelemetry {
  return {
    ...EMPTY_TELEMETRY,
    topDiscardedCandidates: [],
    errors: [],
  };
}

function addTelemetry(target: ExternalRunTelemetry, source: ExternalRunTelemetry): void {
  target.sourcesReviewed += source.sourcesReviewed;
  target.rawResultsReceived += source.rawResultsReceived;
  target.normalized += source.normalized;
  target.detected += source.detected;
  target.saved += source.saved;
  target.alerted += source.alerted;
  target.discardedByKeyword += source.discardedByKeyword;
  target.discardedByEvidence += source.discardedByEvidence;
  target.discardedByDate += source.discardedByDate;
  target.discardedBySanitization += source.discardedBySanitization;
  target.discardedByScope += source.discardedByScope;
  target.discardedByScore += source.discardedByScore;
  target.discardedByDeduplication += source.discardedByDeduplication;
  target.discardedByMissingSourceUrl += source.discardedByMissingSourceUrl;
  target.discardedByMissingEvidence += source.discardedByMissingEvidence;
  target.errors.push(...source.errors);
}

function discardFromRaw(
  raw: RawExternalItem,
  reasons: ExternalLeadDiscardReason[],
): ExternalLeadDiscardedCandidate {
  return {
    sourceName: raw.sourceName,
    sourceUrl: raw.sourceUrl ?? "",
    publicUrl: raw.sourceUrl,
    detectedAt: raw.fetchedAt || nowISO(),
    title: raw.title ?? raw.sourceName,
    vertical: "construccion_mantenimiento",
    opportunityType: "senal_comercial_publica",
    matchedKeywords: [],
    reasons,
    estimatedScore: null,
    confidence: null,
    sourcePublishedAt: raw.publishedAt,
  };
}

function discardFromLead(
  lead: {
    sourceName: string;
    sourceUrl: string;
    detectedAt: string;
    title: string;
    vertical: ExternalLeadVertical;
    opportunityType: ExternalOpportunityType;
    matchedKeywords: string[];
    sourcePublishedAt: string | null;
    confidence?: ScoredExternalLead["confidence"];
  },
  reasons: ExternalLeadDiscardReason[],
  score: number | null = null,
): ExternalLeadDiscardedCandidate {
  return buildDiscardedCandidateSummary({
    sourceName: lead.sourceName,
    sourceUrl: lead.sourceUrl,
    detectedAt: lead.detectedAt,
    title: lead.title,
    vertical: lead.vertical,
    opportunityType: lead.opportunityType,
    matchedKeywords: lead.matchedKeywords,
    sourcePublishedAt: lead.sourcePublishedAt,
    reasons,
    estimatedScore: score,
    confidence: lead.confidence ?? null,
  });
}

function isOlderThanLookback(sourcePublishedAt: string | null, lookbackDays: number): boolean {
  if (!sourcePublishedAt) return false;
  const published = new Date(sourcePublishedAt).getTime();
  if (!Number.isFinite(published)) return false;
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return published < cutoff;
}

function inspectScoredLead(
  scored: ScoredExternalLead,
  options: ExternalLeadRunOptions,
): ExternalLeadDiscardReason[] {
  const reasons: ExternalLeadDiscardReason[] = [];
  if (!scored.sourceUrl.trim()) reasons.push("missing_source_url");
  if (!scored.evidenceText.trim()) reasons.push("missing_evidence", "evidence");
  if (isUnwantedTitle(scored.title)) reasons.push("missing_evidence");
  if (scored.matchedKeywords.length === 0) reasons.push("keyword");
  if (isOlderThanLookback(scored.sourcePublishedAt, options.lookbackDays)) {
    reasons.push("date");
  }
  return [...new Set(reasons)];
}

function countDiscardTelemetry(
  telemetry: ExternalRunTelemetry,
  reasons: ExternalLeadDiscardReason[],
): void {
  if (reasons.includes("keyword")) telemetry.discardedByKeyword++;
  if (reasons.includes("evidence")) telemetry.discardedByEvidence++;
  if (reasons.includes("date")) telemetry.discardedByDate++;
  if (reasons.includes("sanitization")) telemetry.discardedBySanitization++;
  if (reasons.includes("scope")) telemetry.discardedByScope++;
  if (reasons.includes("missing_source_url")) telemetry.discardedByMissingSourceUrl++;
  if (reasons.includes("missing_evidence")) telemetry.discardedByMissingEvidence++;
}

export async function runSourceAdapter(
  adapter: SourceAdapter,
  options: ExternalLeadRunOptions,
): Promise<ExternalSourceResult> {
  const telemetry = emptyExternalRunTelemetry();
  telemetry.sourcesReviewed = 1;
  const discardedCandidates: ExternalLeadDiscardedCandidate[] = [];
  const candidates: ExternalLeadCandidate[] = [];
  let rawResults: RawExternalItem[] = [];
  let httpStatus: number | null = null;
  let error: string | null = null;

  try {
    rawResults = await adapter.fetchRaw(options);
    telemetry.rawResultsReceived = rawResults.length;
    httpStatus = rawResults[0]?.raw.httpStatus as number | null ?? null;

    for (const raw of rawResults) {
      const normalized = adapter.normalize(raw, options);
      if (!normalized) {
        const reasons: ExternalLeadDiscardReason[] = raw.sourceUrl
          ? ["sanitization"]
          : ["missing_source_url"];
        countDiscardTelemetry(telemetry, reasons);
        if (options.debugDiscards) discardedCandidates.push(discardFromRaw(raw, reasons));
        continue;
      }
      telemetry.normalized++;

      const sanitized = adapter.sanitize(normalized, options);
      if (!sanitized) {
        const reasons: ExternalLeadDiscardReason[] = ["sanitization"];
        countDiscardTelemetry(telemetry, reasons);
        if (options.debugDiscards) discardedCandidates.push(discardFromLead(normalized, reasons));
        continue;
      }

      const scored = adapter.score(sanitized, options);
      const discardReasons = inspectScoredLead(scored, options);
      if (discardReasons.length > 0) {
        countDiscardTelemetry(telemetry, discardReasons);
        if (options.debugDiscards) {
          discardedCandidates.push(
            discardFromLead(scored, discardReasons, scored.estimatedInterestScore),
          );
        }
        continue;
      }

      telemetry.detected++;
      candidates.push(scoredLeadToCandidate(scored));
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    httpStatus = (err as Error & { httpStatus?: number }).httpStatus ?? null;
    telemetry.errors.push(error);
    log.warn({ err, adapterId: adapter.id }, "Fuente External OSINT V2 falló de forma recuperable");
  }

  const queryResult: ExternalLeadSourceQueryResult = {
    sourceId: adapter.id,
    sourceName: adapter.name,
    sourceType: adapter.type,
    query: adapter.query ?? adapter.name,
    url: (rawResults[0]?.raw.queryUrl as string | undefined) ?? adapter.url ?? "",
    httpStatus,
    ok: error === null,
    error,
    rawResultsReceived: telemetry.rawResultsReceived,
    normalized: telemetry.normalized,
    detected: telemetry.detected,
    discarded: discardedCandidates.length,
  };

  return {
    adapterId: adapter.id,
    sourceName: adapter.name,
    sourceType: adapter.type,
    ok: error === null,
    error,
    httpStatus,
    rawResults,
    rawResultsReceived: telemetry.rawResultsReceived,
    normalized: telemetry.normalized,
    detected: telemetry.detected,
    candidates,
    discardedCandidates,
    queryResult,
    telemetry,
  };
}

export async function runExternalDiscoveryPipeline(
  adapters: SourceAdapter[],
  options: ExternalLeadRunOptions,
): Promise<ExternalDiscoveryPipelineResult> {
  const telemetry = emptyExternalRunTelemetry();
  const candidates: ExternalLeadCandidate[] = [];
  const discardedCandidates: ExternalLeadDiscardedCandidate[] = [];
  const errors: string[] = [];
  const errorsBySource: Record<string, string[]> = {};
  const sourceQueries: ExternalLeadSourceQueryResult[] = [];

  const enabledAdapters = adapters.filter((adapter) => adapter.enabled);
  const batchSize = 3;
  for (let index = 0; index < enabledAdapters.length; index += batchSize) {
    const batch = enabledAdapters.slice(index, index + batchSize);
    const results = await Promise.all(
      batch.map((adapter) => runSourceAdapter(adapter, options)),
    );

    for (const result of results) {
      addTelemetry(telemetry, result.telemetry);
      candidates.push(...result.candidates);
      discardedCandidates.push(...result.discardedCandidates);
      sourceQueries.push(result.queryResult);

      if (!result.ok && result.error) {
        errorsBySource[result.sourceName] = [
          ...(errorsBySource[result.sourceName] ?? []),
          `${result.adapterId}: ${result.error}`,
        ];
      }
    }
  }

  errors.push(...Object.values(errorsBySource).flat());

  return {
    candidates: candidates.slice(0, options.maxRawResultsPerSource * Math.max(1, enabledAdapters.length)),
    errors,
    errorsBySource,
    sourcesReviewed: telemetry.sourcesReviewed,
    sourceQueries,
    discardedCandidates,
    rawResultsReceived: telemetry.rawResultsReceived,
    normalized: telemetry.normalized,
    discardedByKeyword: telemetry.discardedByKeyword,
    discardedByEvidence: telemetry.discardedByEvidence,
    discardedByDate: telemetry.discardedByDate,
    discardedBySanitization: telemetry.discardedBySanitization,
    discardedByScope: telemetry.discardedByScope,
    discardedByMissingSourceUrl: telemetry.discardedByMissingSourceUrl,
    discardedByMissingEvidence: telemetry.discardedByMissingEvidence,
  };
}
