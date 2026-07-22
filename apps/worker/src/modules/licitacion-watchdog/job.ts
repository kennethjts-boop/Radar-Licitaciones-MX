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
  transitionWatchdogHealth,
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
import type {
  JsonObject,
  StructuralConfirmation,
  WatchdogFailureCause,
  WatchdogHealthState,
  WatchdogSnapshotRow,
  WatchdogTelemetry,
} from "./types";

const log = createModuleLogger("licitacion-watchdog:job");
let inFlight = false;

async function notifyPending(row: WatchdogSnapshotRow): Promise<void> {
  const receipt = await sendPendingNotification(row);
  await markNotificationSent(row, receipt);
}

async function processExpediente(numeroProcedimiento: string): Promise<JsonObject> {
  // Drenar primero toda la cola histórica en orden. Antes solo se reintentaba el
  // snapshot más reciente; si aparecía otro cambio entre intentos, el anterior
  // podía quedar pendiente para siempre.
  const pending = await getPendingSnapshots(numeroProcedimiento);
  for (const row of pending) await notifyPending(row);

  const resolved = await resolveExpediente(numeroProcedimiento);
  const snapshot = await extractWatchdogSnapshot({ numeroProcedimiento, ...resolved });
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
    await notifyPending(baseline);
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
      await notifyPending(latest);
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
      await notifyPending(latest);
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
  await notifyPending(changed);
  return {
    status: baselineCompleted ? "baseline_completed" : "changed",
    hash,
    changes: changes.length,
    deploymentSha: snapshot.deploymentSha,
    structuralConfirmation: structuralConfirmation ?? null,
  };
}

export async function runLicitacionWatchdog(expedientes: string[]): Promise<void> {
  let ownsInFlight = false;
  let currentHealth: WatchdogHealthState = EMPTY_WATCHDOG_HEALTH;
  let deploymentSha: string | null = null;
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

    const startedAt = nowISO();
    deploymentSha = getConfig().RAILWAY_GIT_COMMIT_SHA ?? null;
    const previousTelemetry = await getState<WatchdogTelemetry>(STATE_KEYS.WATCHDOG_TELEMETRY);
    currentHealth = previousTelemetry?.health ?? EMPTY_WATCHDOG_HEALTH;
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

    for (const numeroProcedimiento of expedientes) {
      try {
        results[numeroProcedimiento] = await processExpediente(numeroProcedimiento);
      } catch (err) {
        const message = watchdogErrorMessage(err);
        results[numeroProcedimiento] = {
          status: "error",
          error: message,
          cause: classifyWatchdogFailure(err),
          stage: "expediente_processing",
          errorType: watchdogErrorType(err),
          deploymentSha,
        };
        log.error(
          { err, numeroProcedimiento, suppressTelegram: true },
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
    } else {
      currentHealth = transitionWatchdogHealth(currentHealth, { success: true });
    }
    await setState(STATE_KEYS.WATCHDOG_TELEMETRY, {
      status: incomplete > 0 ? "error" : "ok",
      lastCheckedAt: nowISO(),
      lastSuccessfulCheckAt: incomplete === 0 ? nowISO() : null,
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
      await notifyWatchdogHealthIfNeeded(currentHealth);
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
    await notifyWatchdogHealthIfNeeded(currentHealth).catch((alertError) => {
      log.warn({ err: alertError }, "Fallo contenido notificando salud watchdog");
    });
  } finally {
    if (ownsInFlight) inFlight = false;
  }
}

export function resetWatchdogLockForTests(): void {
  inFlight = false;
  structuralChangeGuard.reset();
}
