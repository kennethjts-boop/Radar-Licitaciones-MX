import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { getState, setState, STATE_KEYS } from "../../core/system-state";
import { shouldDeferWatchdogForCollector } from "./collector-guard";
import {
  classifyWatchdogFailure,
  extractWatchdogSnapshot,
  watchdogErrorMessage,
  watchdogErrorType,
} from "./extractor";
import {
  EMPTY_WATCHDOG_HEALTH,
  notifyWatchdogHealthIfNeeded,
  reconcileWatchdogColdStartHealth,
  resolveWatchdogHealthDecision,
  transitionWatchdogHealth,
  type WatchdogHealthDecision,
} from "./health";
import {
  getLatestSnapshot,
  getPendingSnapshots,
  insertSnapshot,
  markNotificationSent,
  resolveExpediente,
} from "./repository";
import { diffSnapshots, hashSnapshot } from "./snapshot";
import { structuralChangeGuard } from "./structural-guard";
import { sendPendingNotification } from "./telegram";
import { recordNetworkFailure } from "../alerting/saturation";
import { allCircuits } from "../resilience/circuit-breaker";
import type {
  JsonObject,
  StructuralConfirmation,
  WatchdogFailureCause,
  WatchdogHealthState,
  WatchdogExtractionResult,
  WatchdogSkippedResult,
  WatchdogSnapshotRow,
  WatchdogTelemetry,
} from "./types";

import {
  buildExpedienteUrl,
  notifyDegradedTarget,
  resolveTargetUuid,
  verifySnapshotFields,
  type ResolvedTarget,
  type WatchdogTarget,
} from "./target-resolver";
import { getAllTargets, getResolvedTargets } from "./target-manager";

const log = createModuleLogger("licitacion-watchdog:job");
const TRANSIENT_RENDER_RETRY_DELAYS_MS = [20_000, 40_000, 60_000] as const;
let inFlight = false;
let coldStartHealthReconciled = false;

function isSkippedExtraction(
  extraction: WatchdogExtractionResult,
): extraction is WatchdogSkippedResult {
  return extraction.status === "skipped";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRenderFailure(
  extraction: WatchdogExtractionResult,
): boolean {
  return !isSkippedExtraction(extraction) &&
    extraction.partial !== false &&
    extraction.extractionFailure?.cause === "TRANSIENT_RENDER";
}

export async function extractWatchdogSnapshotWithRetries(
  input: {
    numeroProcedimiento: string;
    expedienteUrl: string;
    uuidProcedimiento: string;
  },
  wait: (ms: number) => Promise<void> = sleep,
): Promise<WatchdogExtractionResult> {
  let extraction = await extractWatchdogSnapshot(input);
  for (
    let retryIndex = 0;
    retryIndex < TRANSIENT_RENDER_RETRY_DELAYS_MS.length &&
    isTransientRenderFailure(extraction);
    retryIndex++
  ) {
    const delayMs = TRANSIENT_RENDER_RETRY_DELAYS_MS[retryIndex];
    log.info(
      {
        numeroProcedimiento: input.numeroProcedimiento,
        retry: retryIndex + 1,
        maxRetries: TRANSIENT_RENDER_RETRY_DELAYS_MS.length,
        delayMs,
      },
      "Render transitorio del watchdog; reintento programado",
    );
    await wait(delayMs);
    extraction = await extractWatchdogSnapshot(input);
    if (
      !isSkippedExtraction(extraction) &&
      extraction.partial === false
    ) {
      log.info(
        {
          numeroProcedimiento: input.numeroProcedimiento,
          recoveredAfterRetries: retryIndex + 1,
        },
        "Render del watchdog recuperado sin escalar alerta",
      );
    }
  }
  return extraction;
}

async function notifyPending(row: WatchdogSnapshotRow, targetAlias?: string): Promise<void> {
  const receipt = targetAlias
    ? await sendPendingNotification(row, targetAlias)
    : await sendPendingNotification(row);
  await markNotificationSent(row, receipt);
}

async function processExpediente(target: ResolvedTarget): Promise<JsonObject> {
  const numeroProcedimiento = target.numero;
  // Drenar primero toda la cola histórica en orden.
  const pending = await getPendingSnapshots(numeroProcedimiento);
  for (const row of pending) await notifyPending(row, target.alias);

  const extraction = await extractWatchdogSnapshotWithRetries({
    numeroProcedimiento,
    expedienteUrl: target.expedienteUrl,
    uuidProcedimiento: target.uuid,
  });
  if (isSkippedExtraction(extraction)) {
    return {
      status: "skipped",
      reason: extraction.reason,
      endpointKey: extraction.endpointKey,
      msUntilRetry: extraction.msUntilRetry,
    };
  }
  const snapshot = extraction;

  if (snapshot.partial !== false) {
    log.warn(
      { numeroProcedimiento, deploymentSha: snapshot.deploymentSha ?? null },
      "Ciclo watchdog omitido: snapshot parcial no se compara ni persiste",
    );
    return {
      status: "partial",
      changes: 0,
      cause: snapshot.extractionFailure?.cause ?? "APPLICATION_ERROR",
      stage: snapshot.extractionFailure?.stage ?? "browser_session",
      errorType: snapshot.extractionFailure?.errorType ?? "Error",
      error: snapshot.extractionFailure?.message ?? "Snapshot parcial sin causa disponible",
      deploymentSha: snapshot.deploymentSha ?? null,
    };
  }

  // Verificación de portal
  const verification = verifySnapshotFields(snapshot);
  if (!verification.valid) {
    log.warn(
      { numeroProcedimiento, reason: verification.reason, failedSelectors: verification.failedSelectors },
      "Target degradado: fallo verificación de campos obligatorios en el portal",
    );
    await notifyDegradedTarget(
      target,
      verification.reason || "Fallo verificación de campos en portal",
      verification.failedSelectors || [],
    );
    return {
      status: "degraded",
      reason: verification.reason ?? null,
      failedSelectors: verification.failedSelectors ?? null,
      deploymentSha: snapshot.deploymentSha ?? null,
    };
  }
  const hash = hashSnapshot(snapshot);
  const latest = await getLatestSnapshot(numeroProcedimiento);

  if (!latest) {
    const baseline = await insertSnapshot({
      numeroProcedimiento,
      hash,
      snapshot,
      changes: [],
      notificationKind: "baseline",
    });
    await notifyPending(baseline, target.alias);
    return {
      status: "baseline",
      hash,
      changes: 0,
      deploymentSha: snapshot.deploymentSha,
    };
  }

  if (latest.snapshot_hash === hash) {
    structuralChangeGuard.evaluate(numeroProcedimiento, latest.snapshot_json, snapshot);
    if (latest.detected_changes?.notification?.status === "pending") {
      await notifyPending(latest, target.alias);
    }
    return {
      status: "unchanged",
      hash,
      changes: 0,
      deploymentSha: snapshot.deploymentSha,
    };
  }

  const structuralDecision = structuralChangeGuard.evaluate(
    numeroProcedimiento,
    latest.snapshot_json,
    snapshot,
  );
  if (structuralDecision.action === "reject_incomplete") {
    log.warn(
      {
        numeroProcedimiento,
        deploymentSha: snapshot.deploymentSha,
        reasons: structuralDecision.analysis.reasons,
      },
      "Snapshot estructuralmente incompleto descartado",
    );
    return {
      status: "structural_incomplete",
      hash,
      changes: 0,
      reasons: structuralDecision.analysis.reasons,
      deploymentSha: snapshot.deploymentSha,
    };
  }
  if (structuralDecision.action === "await_confirmation") {
    log.warn(
      {
        numeroProcedimiento,
        deploymentSha: snapshot.deploymentSha,
        signature: structuralDecision.analysis.signature,
        reasons: structuralDecision.analysis.reasons,
      },
      "Pérdida estructural retenida hasta una segunda captura completa independiente",
    );
    return {
      status: "confirmation_pending",
      hash,
      changes: 0,
      structuralSignature: structuralDecision.analysis.signature,
      reasons: structuralDecision.analysis.reasons,
      deploymentSha: snapshot.deploymentSha,
    };
  }

  const changes = diffSnapshots(latest.snapshot_json, snapshot);
  if (changes.length === 0) {
    if (latest.detected_changes?.notification?.status === "pending") {
      await notifyPending(latest, target.alias);
    }
    return {
      status: "unchanged",
      hash,
      changes: 0,
      deploymentSha: snapshot.deploymentSha,
      hashMigrated: latest.snapshot_hash !== hash,
    };
  }
  const baselineCompleted = latest.snapshot_json.visibleTables.some((table, index) =>
    table.rows.length === 0 && (snapshot.visibleTables[index]?.rows.length ?? 0) > 0,
  );
  const structuralConfirmation: StructuralConfirmation | undefined =
    structuralDecision.action === "confirmed"
      ? {
          signature: structuralDecision.analysis.signature,
          captures: structuralDecision.captures,
          confirmedAt: structuralDecision.confirmedAt,
        }
      : undefined;
  const changed = await insertSnapshot({
    numeroProcedimiento,
    hash,
    snapshot,
    changes,
    notificationKind: baselineCompleted ? "baseline_completed" : "change",
    structuralConfirmation,
  });
  await notifyPending(changed, target.alias);
  return {
    status: baselineCompleted ? "baseline_completed" : "changed",
    hash,
    changes: changes.length,
    deploymentSha: snapshot.deploymentSha,
    structuralConfirmation: structuralConfirmation ?? null,
  };
}

export async function runLicitacionWatchdog(expedientesOrTargets?: (string | ResolvedTarget)[]): Promise<void> {
  let ownsInFlight = false;
  let currentHealth: WatchdogHealthState = EMPTY_WATCHDOG_HEALTH;
  let previousTelemetry: WatchdogTelemetry | null = null;
  let deploymentSha: string | null = null;
  let healthDecision: WatchdogHealthDecision | null = null;
  let expedientes: string[] = [];
  const results: JsonObject = {};
  try {
    if (inFlight) {
      log.warn("Ciclo watchdog omitido porque el anterior sigue en ejecución");
      return;
    }
    inFlight = true;
    ownsInFlight = true;
    const guard = await shouldDeferWatchdogForCollector();
    if (guard.defer) {
      log.warn(
        { reason: guard.reason },
        "Ciclo watchdog pospuesto por prioridad del colector principal (guard solo-lectura)",
      );
      return;
    }

    let resolvedTargets: ResolvedTarget[] = [];
    if (Array.isArray(expedientesOrTargets) && expedientesOrTargets.length > 0) {
      const allTargetsMap = new Map((await getAllTargets()).map((t: WatchdogTarget) => [t.numero, t]));
      for (const item of expedientesOrTargets) {
        if (typeof item === "string") {
          const existing = allTargetsMap.get(item) || {
            id: item,
            alias: item,
            numero: item,
            uuid: null,
          };
          const uuid = existing.uuid || (process.env.NODE_ENV === "test" ? "dummy-uuid" : (await resolveTargetUuid(existing)) || "dummy-uuid");
          resolvedTargets.push({
            ...existing,
            uuid,
            expedienteUrl: buildExpedienteUrl(uuid),
          });
        } else {
          resolvedTargets.push(item);
        }
      }
    } else {
      resolvedTargets = await getResolvedTargets();
    }
    expedientes = resolvedTargets.map((t: ResolvedTarget) => t.numero);

    const startedAt = nowISO();
    deploymentSha = getConfig().RAILWAY_GIT_COMMIT_SHA ?? null;
    previousTelemetry = await getState<WatchdogTelemetry>(STATE_KEYS.WATCHDOG_TELEMETRY);
    currentHealth = previousTelemetry?.health ?? EMPTY_WATCHDOG_HEALTH;
    if (!coldStartHealthReconciled) {
      const reconciliation = reconcileWatchdogColdStartHealth(
        currentHealth,
        allCircuits(),
      );
      currentHealth = reconciliation.health;
      coldStartHealthReconciled = true;
      if (reconciliation.reset) {
        log.info(
          {
            previousConsecutiveFailures:
              previousTelemetry?.health?.consecutiveFailures ?? 0,
          },
          "[COLD_START] Contador watchdog reiniciado porque todos los circuitos están CLOSED",
        );
      }
    }
    await setState(STATE_KEYS.WATCHDOG_TELEMETRY, {
      status: "running",
      lastCheckedAt: startedAt,
      lastSuccessfulCheckAt: previousTelemetry?.lastSuccessfulCheckAt ?? null,
      lastError: null,
      configuredExpedientes: expedientes,
      deploymentSha,
      results,
      health: currentHealth,
    });

    const delayMs = getConfig().WATCHDOG_DELAY_MS;
    for (let i = 0; i < resolvedTargets.length; i++) {
      const target = resolvedTargets[i];
      if (i > 0 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        results[target.numero] = await processExpediente(target);
      } catch (err) {
        const message = watchdogErrorMessage(err);
        results[target.numero] = {
          status: "error",
          error: message,
          cause: classifyWatchdogFailure(err),
          stage: "expediente_processing",
          errorType: watchdogErrorType(err),
          deploymentSha,
        };
        log.error(
          { err, numeroProcedimiento: target.numero, suppressTelegram: true },
          "Watchdog falló para expediente; alerta consolidada gestionará Telegram",
        );
      }
    }
    const failed = Object.values(results).filter((result) =>
      typeof result === "object" && result !== null && !Array.isArray(result) && result.status === "error",
    );
    const incompleteResults = Object.values(results).filter((result) =>
      typeof result === "object" && result !== null && !Array.isArray(result) &&
        ["partial", "structural_incomplete", "confirmation_pending"].includes(String(result.status)),
    );
    const incomplete = failed.length + incompleteResults.length;
    const skippedResults = Object.values(results).filter((result) =>
      typeof result === "object" && result !== null && !Array.isArray(result) &&
        result.status === "skipped",
    );
    const allSkipped = skippedResults.length > 0 &&
      skippedResults.length === Object.keys(results).length;
    const extractionFailures = Object.values(results).filter((result) =>
      typeof result === "object" && result !== null && !Array.isArray(result) &&
        ["error", "partial"].includes(String(result.status)) && typeof result.cause === "string",
    ) as JsonObject[];
    if (extractionFailures.length > 0) {
      const causes = extractionFailures.map((result) => String(result.cause) as WatchdogFailureCause);
      const cause = causes.includes("NETWORK_INFRA")
        ? "NETWORK_INFRA"
        : causes[0] ?? "APPLICATION_ERROR";
      const primaryFailure = extractionFailures.find((result) => result.cause === cause) ??
        extractionFailures[0];
      currentHealth = transitionWatchdogHealth(currentHealth, {
        success: false,
        cause,
        stage: typeof primaryFailure?.stage === "string" ? primaryFailure.stage : null,
        errorType: typeof primaryFailure?.errorType === "string" ? primaryFailure.errorType : null,
        message: typeof primaryFailure?.error === "string" ? primaryFailure.error : null,
      });
      healthDecision = await resolveWatchdogHealthDecision(currentHealth);
      currentHealth = healthDecision.health;
    } else if (!allSkipped) {
      currentHealth = transitionWatchdogHealth(currentHealth, { success: true });
    }
    if (allSkipped) {
      log.info(
        { skippedExpedientes: skippedResults.length },
        "[CIRCUIT] Ciclo watchdog informativo: todos los expedientes fueron omitidos",
      );
    }
    await setState(STATE_KEYS.WATCHDOG_TELEMETRY, {
      status: allSkipped ? "skipped" : incomplete > 0 ? "error" : "ok",
      lastCheckedAt: nowISO(),
      lastSuccessfulCheckAt: allSkipped
        ? previousTelemetry?.lastSuccessfulCheckAt ?? null
        : incomplete === 0
          ? nowISO()
          : null,
      lastError: failed.length > 0
        ? `${failed.length} expediente(s) con error`
        : incompleteResults.length > 0
          ? `${incompleteResults.length} expediente(s) incompleto(s) o pendiente(s) de confirmación; sin diff ni alerta`
          : null,
      configuredExpedientes: expedientes,
      deploymentSha,
      results,
      health: currentHealth,
    });
    if (extractionFailures.length > 0) {
      if (currentHealth.cause === "NETWORK_INFRA") {
        await recordNetworkFailure(
          currentHealth.lastFailureAt
            ? new Date(currentHealth.lastFailureAt)
            : new Date(),
        ).catch((histogramError) => {
          log.warn(
            { err: histogramError },
            "No se pudo registrar muestra de saturación NETWORK_INFRA",
          );
        });
      }
      await notifyWatchdogHealthIfNeeded(
        currentHealth,
        healthDecision ?? undefined,
      );
    }
  } catch (err) {
    // Última frontera: esta función siempre resuelve. Así el scheduler y el handler
    // global de unhandledRejection nunca reciben una promesa rechazada del watchdog.
    log.error(
      { err, suppressTelegram: true },
      "Error no manejado contenido dentro del watchdog; Telegram queda consolidado",
    );
    currentHealth = transitionWatchdogHealth(
      currentHealth,
      {
        success: false,
        cause: classifyWatchdogFailure(err),
        stage: "watchdog_job",
        errorType: watchdogErrorType(err),
        message: watchdogErrorMessage(err),
      },
    );
    try {
      healthDecision = await resolveWatchdogHealthDecision(currentHealth);
      currentHealth = healthDecision.health;
    } catch (decisionError) {
      log.warn(
        { err: decisionError },
        "Fallo contenido calculando veredicto final watchdog; se conserva WARN",
      );
    }
    await setState(STATE_KEYS.WATCHDOG_TELEMETRY, {
      status: "error",
      lastCheckedAt: nowISO(),
      lastSuccessfulCheckAt: null,
      lastError: watchdogErrorMessage(err),
      configuredExpedientes: expedientes,
      deploymentSha,
      results,
      health: currentHealth,
    }).catch((stateError) => {
      log.warn({ err: stateError }, "Fallo contenido persistiendo error final watchdog");
    });
    await notifyWatchdogHealthIfNeeded(
      currentHealth,
      healthDecision ?? undefined,
    ).catch((alertError) => {
      log.warn({ err: alertError }, "Fallo contenido notificando salud watchdog");
    });
  } finally {
    if (ownsInFlight) inFlight = false;
  }
}

export function resetWatchdogLockForTests(): void {
  inFlight = false;
  coldStartHealthReconciled = false;
  structuralChangeGuard.reset();
}
