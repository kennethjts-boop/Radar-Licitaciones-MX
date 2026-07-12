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
import { sendPendingNotification } from "./telegram";
import type { JsonObject, WatchdogSnapshotRow } from "./types";

const log = createModuleLogger("licitacion-watchdog:job");
let inFlight = false;

async function notifyPending(row: WatchdogSnapshotRow): Promise<void> {
  const messageId = await sendPendingNotification(row);
  await markNotificationSent(row, messageId);
}

async function processExpediente(numeroProcedimiento: string): Promise<JsonObject> {
  const resolved = await resolveExpediente(numeroProcedimiento);
  const snapshot = await extractWatchdogSnapshot({ numeroProcedimiento, ...resolved });
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
    return { status: "baseline", hash, changes: 0 };
  }

  if (latest.snapshot_hash === hash) {
    if (latest.detected_changes?.notification?.status === "pending") {
      await notifyPending(latest);
    }
    return { status: "unchanged", hash, changes: 0 };
  }

  const changes = diffSnapshots(latest.snapshot_json, snapshot);
  const changed = await insertSnapshot({
    numeroProcedimiento,
    hash,
    snapshot,
    changes,
    notificationKind: "change",
  });
  await notifyPending(changed);
  return { status: "changed", hash, changes: changes.length };
}

export async function runLicitacionWatchdog(expedientes: string[]): Promise<void> {
  if (inFlight) {
    log.warn("Ciclo watchdog omitido porque el anterior sigue en ejecución");
    return;
  }
  inFlight = true;
  const startedAt = nowISO();
  const results: JsonObject = {};
  await setState(STATE_KEYS.WATCHDOG_TELEMETRY, {
    status: "running",
    lastCheckedAt: startedAt,
    lastSuccessfulCheckAt: null,
    lastError: null,
    configuredExpedientes: expedientes,
    results,
  });

  try {
    for (const numeroProcedimiento of expedientes) {
      try {
        results[numeroProcedimiento] = await processExpediente(numeroProcedimiento);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[numeroProcedimiento] = { status: "error", error: message };
        log.error({ err, numeroProcedimiento }, "Watchdog falló para expediente; ciclo principal no afectado");
      }
    }
    const failed = Object.values(results).filter((result) =>
      typeof result === "object" && result !== null && !Array.isArray(result) && result.status === "error",
    );
    await setState(STATE_KEYS.WATCHDOG_TELEMETRY, {
      status: failed.length > 0 ? "error" : "ok",
      lastCheckedAt: nowISO(),
      lastSuccessfulCheckAt: failed.length === 0 ? nowISO() : null,
      lastError: failed.length > 0 ? `${failed.length} expediente(s) con error` : null,
      configuredExpedientes: expedientes,
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
}
