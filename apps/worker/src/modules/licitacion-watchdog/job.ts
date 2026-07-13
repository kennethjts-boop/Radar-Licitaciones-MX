import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { setState, STATE_KEYS } from "../../core/system-state";
import { extractWatchdogSnapshot } from "./extractor";
import {
  getLatestSnapshot,
  insertSnapshot,
  markNotificationSent,
  resolveExpediente,
} from "./repository";
import { diffSnapshots, hashSnapshot } from "./snapshot";
import { structuralChangeGuard } from "./structural-guard";
import { sendPendingNotification } from "./telegram";
import type { JsonObject, StructuralConfirmation, WatchdogSnapshotRow } from "./types";

const log = createModuleLogger("licitacion-watchdog:job");
let inFlight = false;

async function notifyPending(row: WatchdogSnapshotRow): Promise<void> {
  const messageId = await sendPendingNotification(row);
  await markNotificationSent(row, messageId);
}

async function processExpediente(numeroProcedimiento: string): Promise<JsonObject> {
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
  if (inFlight) {
    log.warn("Ciclo watchdog omitido porque el anterior sigue en ejecución");
    return;
  }
  inFlight = true;
  const startedAt = nowISO();
  const deploymentSha = getConfig().RAILWAY_GIT_COMMIT_SHA ?? null;
  const results: JsonObject = {};
  await setState(STATE_KEYS.WATCHDOG_TELEMETRY, {
    status: "running",
    lastCheckedAt: startedAt,
    lastSuccessfulCheckAt: null,
    lastError: null,
    configuredExpedientes: expedientes,
    deploymentSha,
    results,
  });

  try {
    for (const numeroProcedimiento of expedientes) {
      try {
        results[numeroProcedimiento] = await processExpediente(numeroProcedimiento);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[numeroProcedimiento] = { status: "error", error: message, deploymentSha };
        log.error({ err, numeroProcedimiento }, "Watchdog falló para expediente; ciclo principal no afectado");
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
    });
  } catch (err) {
    log.error({ err }, "Error no manejado contenido dentro del watchdog");
  } finally {
    inFlight = false;
  }
}

export function resetWatchdogLockForTests(): void {
  inFlight = false;
  structuralChangeGuard.reset();
}
