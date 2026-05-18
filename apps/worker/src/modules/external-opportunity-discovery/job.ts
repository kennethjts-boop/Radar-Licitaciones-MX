import { getConfig } from "../../config/env";
import { healthTracker } from "../../core/healthcheck";
import { createModuleLogger } from "../../core/logger";
import { setState, STATE_KEYS } from "../../core/system-state";
import { dedupeExternalLeadCandidates } from "./matching";
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
    sourcesReviewed: result.sourcesReviewed,
    detected: result.detected,
    saved: result.saved,
    alerted: result.alerted,
    errors: result.errors,
  });

  await setState(STATE_KEYS.LAST_EXTERNAL_LEADS_RUN, {
    status: result.status,
    reason: result.reason ?? null,
    finishedAt: new Date().toISOString(),
    enabled: options.enabled,
    dryRun: options.dryRun,
    telegramEnabled: options.telegramEnabled,
    targetLocations: options.targetLocations ?? null,
    morelosOnly: options.morelosOnly,
    minScore: options.minScore,
    maxResultsPerRun: options.maxResultsPerRun,
    sourcesReviewed: result.sourcesReviewed,
    detected: result.detected,
    saved: result.saved,
    alerted: result.alerted,
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
  reason?: string,
): ExternalLeadRunResult {
  return {
    status,
    reason,
    dryRun,
    sourcesReviewed: 0,
    detected: 0,
    saved: 0,
    alerted: 0,
    skippedLowScore: 0,
    skippedMissingSourceUrl: 0,
    skippedMissingEvidence: 0,
    skippedDuplicateAlert: 0,
    telegramCandidates: 0,
    errors: [],
    errorsBySource: {},
    sourceQueries: [],
  };
}

export async function runExternalLeadsOsintJob(
  overrides: Partial<ExternalLeadRunOptions> = {},
  dependencies: ExternalLeadJobDependencies = {},
): Promise<ExternalLeadRunResult> {
  const options = { ...getExternalLeadRunOptions(), ...overrides };
  const recordState = dependencies.recordState ?? recordExternalLeadRunState;

  if (!options.enabled) {
    const skipped = emptyResult("skipped", options.dryRun, "ENABLE_EXTERNAL_LEADS_OSINT=false");
    await recordState(skipped, options).catch((err) =>
      log.warn({ err }, "No se pudo registrar estado OSINT skipped"),
    );
    return skipped;
  }

  const errors: string[] = [];
  let errorsBySource: Record<string, string[]> = {};
  let sourcesReviewed = 0;
  let saved = 0;
  let alerted = 0;
  let skippedLowScore = 0;
  let skippedMissingSourceUrl = 0;
  let skippedMissingEvidence = 0;
  let skippedDuplicateAlert = 0;
  let telegramCandidates = 0;
  let sourceQueries: ExternalLeadRunResult["sourceQueries"] = [];

  try {
    const discovery = await (dependencies.discoverCandidates ?? discoverExternalLeadCandidates)(options);
    errors.push(...discovery.errors);
    errorsBySource = discovery.errorsBySource;
    sourcesReviewed = discovery.sourcesReviewed;
    sourceQueries = discovery.sourceQueries ?? [];
    const candidates = dedupeExternalLeadCandidates(discovery.candidates);

    for (const candidate of candidates) {
      const lead = buildExternalLead(candidate, options.lookbackDays);

      if (!lead.sourceUrl.trim()) {
        skippedMissingSourceUrl++;
        log.info(
          { title: lead.title, vertical: lead.vertical },
          "Lead OSINT descartado por falta de source_url",
        );
        continue;
      }

      if (!lead.evidenceText.trim()) {
        skippedMissingEvidence++;
        log.info(
          { sourceUrl: lead.sourceUrl, vertical: lead.vertical },
          "Lead OSINT descartado por falta de evidence_text",
        );
        continue;
      }

      if (!shouldAlertExternalLead(lead.estimatedInterestScore, options.minScore, lead.confidence)) {
        skippedLowScore++;
        log.info(
          {
            sourceUrl: lead.sourceUrl,
            vertical: lead.vertical,
            score: lead.estimatedInterestScore,
            confidence: lead.confidence,
            minScore: options.minScore,
          },
          "Lead OSINT descartado por score/confidence",
        );
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

        if (!options.telegramEnabled || alerted >= options.maxResultsPerRun) {
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

    const result: ExternalLeadRunResult = {
      status: errors.length > 0 ? "error" : "success",
      dryRun: options.dryRun,
      sourcesReviewed,
      detected: candidates.length,
      saved,
      alerted,
      skippedLowScore,
      skippedMissingSourceUrl,
      skippedMissingEvidence,
      skippedDuplicateAlert,
      telegramCandidates,
      errors,
      errorsBySource,
      sourceQueries,
    };
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
      sourcesReviewed,
      detected: 0,
      saved,
      alerted,
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
