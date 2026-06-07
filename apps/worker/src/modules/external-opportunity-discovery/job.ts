import { getConfig } from "../../config/env";
import { healthTracker } from "../../core/healthcheck";
import { createModuleLogger } from "../../core/logger";
import { setState, STATE_KEYS } from "../../core/system-state";
import {
  buildDiscardedCandidateSummary,
  dedupeExternalLeadCandidatesWithTelemetry,
} from "./matching";
import { buildExternalLead } from "./lead-builder";
import { shouldAlertExternalLead } from "./scoring";
import { discoverExternalLeadCandidates } from "./sources";
import { formatExternalLeadAlert, sendExternalLeadAlert } from "./telegram";
import {
  createExternalLeadAlert,
  hasExternalLeadAlert,
  markExternalLeadAlertFailed,
  markExternalLeadAlertSent,
  upsertExternalLead,
} from "./repository";
import type {
  ExternalLeadCandidate,
  ExternalLeadDiscardedCandidate,
  ExternalLeadErrorSummary,
  ExternalLeadRunOptions,
  ExternalLeadRunResult,
  ExternalLeadSourceQueryResult,
} from "./types";

const log = createModuleLogger("external-leads-job");

type ExternalLeadDiscoveryResult = {
  candidates: ExternalLeadCandidate[];
  errors: string[];
  errorsBySource: Record<string, string[]>;
  sourcesReviewed: number;
  sourceQueries?: ExternalLeadSourceQueryResult[];
  discardedCandidates?: ExternalLeadDiscardedCandidate[];
  rawResultsReceived?: number;
  normalized?: number;
  discardedByKeyword?: number;
  discardedByEvidence?: number;
  discardedByDate?: number;
  discardedBySanitization?: number;
  discardedByScope?: number;
  discardedByMissingSourceUrl?: number;
  discardedByMissingEvidence?: number;
};

export interface ExternalLeadJobDependencies {
  discoverCandidates?: (options: ExternalLeadRunOptions) => Promise<ExternalLeadDiscoveryResult>;
  upsertLead?: typeof upsertExternalLead;
  hasAlert?: typeof hasExternalLeadAlert;
  createAlert?: typeof createExternalLeadAlert;
  sendAlert?: typeof sendExternalLeadAlert;
  markSent?: typeof markExternalLeadAlertSent;
  markFailed?: typeof markExternalLeadAlertFailed;
  recordState?: (result: ExternalLeadRunResult, options: ExternalLeadRunOptions) => Promise<void>;
}

export function getExternalLeadRunOptions(): ExternalLeadRunOptions {
  const config = getConfig();
  return {
    enabled: config.ENABLE_EXTERNAL_LEADS_OSINT,
    dryRun: config.EXTERNAL_LEADS_DRY_RUN,
    maxResultsPerRun: config.EXTERNAL_LEADS_MAX_RESULTS_PER_RUN,
    minScore: config.EXTERNAL_LEADS_MIN_SCORE,
    lookbackDays: config.EXTERNAL_LEADS_LOOKBACK_DAYS,
    morelosOnly: config.EXTERNAL_LEADS_MORELOS_ONLY,
    targetLocations: config.EXTERNAL_LEADS_TARGET_LOCATIONS,
    telegramEnabled: config.EXTERNAL_LEADS_TELEGRAM_ENABLED,
    discoveryMode: config.EXTERNAL_LEADS_DISCOVERY_MODE,
    debugDiscards: config.EXTERNAL_LEADS_DEBUG_DISCARDS,
    saveLowScoreCandidates: config.EXTERNAL_LEADS_SAVE_LOW_SCORE_CANDIDATES,
    maxRawResultsPerSource: config.EXTERNAL_LEADS_MAX_RAW_RESULTS_PER_SOURCE,
    sourceTimeoutMs: config.EXTERNAL_LEADS_SOURCE_TIMEOUT_MS,
    debugCandidates: config.RADAR_DEBUG_CANDIDATES,
  };
}

async function recordExternalLeadRunState(
  result: ExternalLeadRunResult,
  options: ExternalLeadRunOptions,
): Promise<void> {
  healthTracker.recordExternalLeadsCycle({
    status: result.status,
    enabled: options.enabled,
    dryRun: options.dryRun,
    discoveryMode: options.discoveryMode,
    sourcesReviewed: result.sourcesReviewed,
    rawResultsReceived: result.rawResultsReceived,
    normalized: result.normalized,
    detected: result.detected,
    saved: result.saved,
    alerted: result.alerted,
    discardedByKeyword: result.discardedByKeyword,
    discardedByEvidence: result.discardedByEvidence,
    discardedByDate: result.discardedByDate,
    discardedBySanitization: result.discardedBySanitization,
    discardedByScope: result.discardedByScope,
    discardedByScore: result.discardedByScore,
    discardedByDeduplication: result.discardedByDeduplication,
    discardedByMissingSourceUrl: result.discardedByMissingSourceUrl,
    discardedByMissingEvidence: result.discardedByMissingEvidence,
    topDiscardedCandidates: result.topDiscardedCandidates,
    topErrors: result.topErrors,
    errors: result.errors,
  });

  await setState(STATE_KEYS.LAST_EXTERNAL_LEADS_RUN, {
    status: result.status,
    reason: result.reason ?? null,
    finishedAt: new Date().toISOString(),
    enabled: options.enabled,
    dryRun: options.dryRun,
    discoveryMode: options.discoveryMode,
    telegramEnabled: options.telegramEnabled && !options.discoveryMode,
    debugDiscards: options.debugDiscards,
    saveLowScoreCandidates: options.saveLowScoreCandidates,
    targetLocations: options.targetLocations ?? null,
    morelosOnly: options.morelosOnly,
    minScore: options.minScore,
    maxResultsPerRun: options.maxResultsPerRun,
    maxRawResultsPerSource: options.maxRawResultsPerSource,
    sourceTimeoutMs: options.sourceTimeoutMs,
    sourcesReviewed: result.sourcesReviewed,
    rawResultsReceived: result.rawResultsReceived,
    normalized: result.normalized,
    detected: result.detected,
    saved: result.saved,
    alerted: result.alerted,
    discardedByKeyword: result.discardedByKeyword,
    discardedByEvidence: result.discardedByEvidence,
    discardedByDate: result.discardedByDate,
    discardedBySanitization: result.discardedBySanitization,
    discardedByScope: result.discardedByScope,
    discardedByScore: result.discardedByScore,
    discardedByDeduplication: result.discardedByDeduplication,
    discardedByMissingSourceUrl: result.discardedByMissingSourceUrl,
    discardedByMissingEvidence: result.discardedByMissingEvidence,
    topDiscardedCandidates: result.topDiscardedCandidates,
    topErrors: result.topErrors,
    skippedLowScore: result.skippedLowScore,
    skippedMissingSourceUrl: result.skippedMissingSourceUrl,
    skippedMissingEvidence: result.skippedMissingEvidence,
    skippedDuplicateAlert: result.skippedDuplicateAlert,
    telegramCandidates: result.telegramCandidates,
    errors: result.errors.slice(0, 10),
    errorsBySource: result.errorsBySource,
  });
}

function emptyResult(
  status: ExternalLeadRunResult["status"],
  dryRun: boolean,
  discoveryMode: boolean,
  reason?: string,
): ExternalLeadRunResult {
  return {
    status,
    reason,
    dryRun,
    discoveryMode,
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
    skippedLowScore: 0,
    skippedMissingSourceUrl: 0,
    skippedMissingEvidence: 0,
    skippedDuplicateAlert: 0,
    telegramCandidates: 0,
    errors: [],
    errorsBySource: {},
    sourceQueries: [],
    topErrors: [],
  };
}

function classifyExternalSourceError(
  query: ExternalLeadSourceQueryResult,
): ExternalLeadErrorSummary["errorType"] {
  const message = (query.error ?? "").toLowerCase();
  if (message.includes("timeout") || message.includes("timed out") || message.includes("etimedout")) {
    return "timeout";
  }
  if (query.httpStatus && query.httpStatus >= 400) {
    return "http_status";
  }
  if (message.includes("json") || message.includes("parse") || message.includes("xml")) {
    return "parsing";
  }
  if (message.includes("normaliz")) {
    return "normalization";
  }
  if (message.includes("sanitiz") || message.includes("sanitiz")) {
    return "sanitization";
  }
  if (
    message.includes("econn") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("socket")
  ) {
    return "network";
  }
  return "unknown";
}

function topExternalErrors(sourceQueries: ExternalLeadSourceQueryResult[]): ExternalLeadErrorSummary[] {
  return sourceQueries
    .filter((query) => !query.ok && query.error)
    .slice(0, 5)
    .map((query) => ({
      sourceName: query.sourceName,
      sourceId: query.sourceId ?? null,
      errorType: classifyExternalSourceError(query),
      message: String(query.error ?? "error").replace(/\s+/g, " ").slice(0, 180),
      httpStatus: query.httpStatus,
    }));
}

export async function runExternalLeadsOsintJob(
  overrides: Partial<ExternalLeadRunOptions> = {},
  dependencies: ExternalLeadJobDependencies = {},
): Promise<ExternalLeadRunResult> {
  const options = { ...getExternalLeadRunOptions(), ...overrides };
  const recordState = dependencies.recordState ?? recordExternalLeadRunState;

  if (!options.enabled) {
    const skipped = emptyResult(
      "skipped",
      options.dryRun,
      options.discoveryMode,
      "ENABLE_EXTERNAL_LEADS_OSINT=false",
    );
    await recordState(skipped, options).catch((err) =>
      log.warn({ err }, "No se pudo registrar estado OSINT skipped"),
    );
    return skipped;
  }

  const errors: string[] = [];
  let errorsBySource: Record<string, string[]> = {};
  let sourcesReviewed = 0;
  let rawResultsReceived = 0;
  let normalized = 0;
  let saved = 0;
  let alerted = 0;
  let skippedLowScore = 0;
  let skippedMissingSourceUrl = 0;
  let skippedMissingEvidence = 0;
  let skippedDuplicateAlert = 0;
  let telegramCandidates = 0;
  let discardedByKeyword = 0;
  let discardedByEvidence = 0;
  let discardedByDate = 0;
  let discardedBySanitization = 0;
  let discardedByScope = 0;
  let discardedByScore = 0;
  let discardedByDeduplication = 0;
  let discardedByMissingSourceUrl = 0;
  let discardedByMissingEvidence = 0;
  const discardedCandidates: ExternalLeadDiscardedCandidate[] = [];
  let sourceQueries: ExternalLeadRunResult["sourceQueries"] = [];

  try {
    const discovery = await (dependencies.discoverCandidates ?? discoverExternalLeadCandidates)(options);
    errors.push(...discovery.errors);
    errorsBySource = discovery.errorsBySource;
    sourcesReviewed = discovery.sourcesReviewed;
    sourceQueries = discovery.sourceQueries ?? [];
    rawResultsReceived = discovery.rawResultsReceived ?? 0;
    normalized = discovery.normalized ?? discovery.candidates.length;
    discardedByKeyword = discovery.discardedByKeyword ?? 0;
    discardedByEvidence = discovery.discardedByEvidence ?? 0;
    discardedByDate = discovery.discardedByDate ?? 0;
    discardedBySanitization = discovery.discardedBySanitization ?? 0;
    discardedByScope = discovery.discardedByScope ?? 0;
    discardedByMissingSourceUrl = discovery.discardedByMissingSourceUrl ?? 0;
    discardedByMissingEvidence = discovery.discardedByMissingEvidence ?? 0;
    discardedCandidates.push(...(discovery.discardedCandidates ?? []));

    const deduped = dedupeExternalLeadCandidatesWithTelemetry(discovery.candidates);
    const candidates = deduped.deduped;
    discardedByDeduplication += deduped.discardedDuplicateCount;
    discardedCandidates.push(...deduped.discardedDuplicates);

    for (const candidate of candidates) {
      const lead = buildExternalLead(candidate, options.lookbackDays);

      if (!lead.sourceUrl.trim()) {
        skippedMissingSourceUrl++;
        discardedByMissingSourceUrl++;
        discardedCandidates.push(
          buildDiscardedCandidateSummary({
            ...candidate,
            reasons: ["missing_source_url"],
            estimatedScore: lead.estimatedInterestScore,
            minScore: options.minScore,
            confidence: lead.confidence,
            scoreBreakdown: lead.scoreBreakdown,
            scoreReasons: lead.scoreReasons,
            exactReason: "missing_source_url",
          }),
        );
        log.info(
          { title: lead.title, vertical: lead.vertical },
          "Lead OSINT descartado por falta de source_url",
        );
        continue;
      }

      if (!lead.evidenceText.trim()) {
        skippedMissingEvidence++;
        discardedByMissingEvidence++;
        discardedCandidates.push(
          buildDiscardedCandidateSummary({
            ...candidate,
            reasons: ["missing_evidence", "evidence"],
            estimatedScore: lead.estimatedInterestScore,
            minScore: options.minScore,
            confidence: lead.confidence,
            scoreBreakdown: lead.scoreBreakdown,
            scoreReasons: lead.scoreReasons,
            exactReason: "missing_evidence",
          }),
        );
        log.info(
          { sourceUrl: lead.sourceUrl, vertical: lead.vertical },
          "Lead OSINT descartado por falta de evidence_text",
        );
        continue;
      }

      if (!shouldAlertExternalLead(lead.estimatedInterestScore, options.minScore, lead.confidence)) {
        skippedLowScore++;
        discardedByScore++;
        discardedCandidates.push(
          buildDiscardedCandidateSummary({
            ...candidate,
            reasons: ["score"],
            estimatedScore: lead.estimatedInterestScore,
            minScore: options.minScore,
            confidence: lead.confidence,
            scoreBreakdown: lead.scoreBreakdown,
            scoreReasons: lead.scoreReasons,
            exactReason: `score ${lead.estimatedInterestScore} below minScore ${options.minScore}; ${lead.scoreReasons?.[0] ?? "no primary reason"}`,
          }),
        );
        log.info(
          {
            title: lead.title,
            sourceName: lead.sourceName,
            sourceUrl: lead.sourceUrl,
            vertical: lead.vertical,
            score: lead.estimatedInterestScore,
            confidence: lead.confidence,
            minScore: options.minScore,
            scoreBreakdown: lead.scoreBreakdown,
            reason: `score ${lead.estimatedInterestScore} below minScore ${options.minScore}; ${lead.scoreReasons?.[0] ?? "no primary reason"}`,
          },
          "Lead OSINT descartado por score/confidence",
        );

        if (!options.dryRun && options.saveLowScoreCandidates) {
          try {
            await (dependencies.upsertLead ?? upsertExternalLead)({
              ...lead,
              status: "diagnostic_low_score",
            });
            saved++;
          } catch (leadErr) {
            const message = leadErr instanceof Error ? leadErr.message : String(leadErr);
            errors.push(`external low-score lead failed (${lead.fingerprintHash}): ${message}`);
          }
        }
        continue;
      }

      telegramCandidates++;

      if (options.dryRun) {
        log.info(
          {
            sourceName: lead.sourceName,
            sourceUrl: lead.sourceUrl,
            vertical: lead.vertical,
            organizationName: lead.organizationName,
            score: lead.estimatedInterestScore,
            confidence: lead.confidence,
            opportunityType: lead.opportunityType,
            matchedKeywords: lead.matchedKeywords.slice(0, 8),
            telegramCandidate: options.telegramEnabled,
          },
          "DRY_RUN Lead OSINT candidato",
        );
        continue;
      }

      try {
        const persisted = await (dependencies.upsertLead ?? upsertExternalLead)(lead);
        saved++;

        if (!options.telegramEnabled || options.discoveryMode || alerted >= options.maxResultsPerRun) {
          continue;
        }

        const alreadyAlerted = await (dependencies.hasAlert ?? hasExternalLeadAlert)(lead.fingerprintHash);
        if (alreadyAlerted) {
          skippedDuplicateAlert++;
          continue;
        }

        const message = formatExternalLeadAlert(lead);
        const alertId = await (dependencies.createAlert ?? createExternalLeadAlert)(
          persisted.id,
          lead.fingerprintHash,
          message,
        );

        try {
          const messageId = await (dependencies.sendAlert ?? sendExternalLeadAlert)(lead);
          if (messageId) {
            await (dependencies.markSent ?? markExternalLeadAlertSent)(alertId, persisted.id, messageId);
            alerted++;
          } else {
            await (dependencies.markFailed ?? markExternalLeadAlertFailed)(alertId);
          }
        } catch (telegramErr) {
          await (dependencies.markFailed ?? markExternalLeadAlertFailed)(alertId);
          throw telegramErr;
        }
      } catch (leadErr) {
        const message = leadErr instanceof Error ? leadErr.message : String(leadErr);
        errors.push(`external lead failed (${lead.fingerprintHash}): ${message}`);
        log.warn({ err: leadErr, fingerprintHash: lead.fingerprintHash }, "Fallo procesando lead OSINT");
      }
    }

    const hasSuccessfulSource = sourceQueries.some((query) => query.ok);
    const topErrors = topExternalErrors(sourceQueries);
    const result: ExternalLeadRunResult = {
      status: errors.length > 0 && !hasSuccessfulSource ? "error" : "success",
      dryRun: options.dryRun,
      discoveryMode: options.discoveryMode,
      sourcesReviewed,
      rawResultsReceived,
      normalized,
      detected: candidates.length,
      saved,
      alerted,
      discardedByKeyword,
      discardedByEvidence,
      discardedByDate,
      discardedBySanitization,
      discardedByScope,
      discardedByScore,
      discardedByDeduplication,
      discardedByMissingSourceUrl,
      discardedByMissingEvidence,
      topDiscardedCandidates: topDiscardedCandidates(discardedCandidates),
      topErrors,
      skippedLowScore,
      skippedMissingSourceUrl,
      skippedMissingEvidence,
      skippedDuplicateAlert,
      telegramCandidates,
      errors,
      errorsBySource,
      sourceQueries,
    };
    if (options.debugCandidates) {
      log.info(
        {
          topDiscardedCandidates: result.topDiscardedCandidates,
          topErrors,
        },
        "RADAR_DEBUG_CANDIDATES external OSINT diagnostics",
      );
    }
    await recordState(result, options).catch((err) =>
      log.warn({ err }, "No se pudo registrar estado OSINT"),
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, "Fallo ciclo OSINT externo");
    const result: ExternalLeadRunResult = {
      status: "error",
      reason: message,
      dryRun: options.dryRun,
      discoveryMode: options.discoveryMode,
      sourcesReviewed,
      rawResultsReceived,
      normalized,
      detected: 0,
      saved,
      alerted,
      discardedByKeyword,
      discardedByEvidence,
      discardedByDate,
      discardedBySanitization,
      discardedByScope,
      discardedByScore,
      discardedByDeduplication,
      discardedByMissingSourceUrl,
      discardedByMissingEvidence,
      topDiscardedCandidates: topDiscardedCandidates(discardedCandidates),
      topErrors: topExternalErrors(sourceQueries),
      skippedLowScore,
      skippedMissingSourceUrl,
      skippedMissingEvidence,
      skippedDuplicateAlert,
      telegramCandidates,
      errors: [message, ...errors],
      errorsBySource,
      sourceQueries,
    };
    await recordState(result, options).catch((stateErr) =>
      log.warn({ err: stateErr }, "No se pudo registrar estado OSINT error"),
    );
    return result;
  }
}

function topDiscardedCandidates(
  discardedCandidates: ExternalLeadDiscardedCandidate[],
): ExternalLeadDiscardedCandidate[] {
  return [...discardedCandidates]
    .sort((left, right) => {
      const scoreLeft = left.estimatedScore ?? -1;
      const scoreRight = right.estimatedScore ?? -1;
      if (scoreLeft !== scoreRight) return scoreRight - scoreLeft;
      return right.detectedAt.localeCompare(left.detectedAt);
    })
    .slice(0, 5);
}
