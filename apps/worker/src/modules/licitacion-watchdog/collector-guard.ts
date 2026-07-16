import { lock } from "../../core/lock";
import { createModuleLogger } from "../../core/logger";
import { getState, STATE_KEYS } from "../../core/system-state";

const log = createModuleLogger("licitacion-watchdog:collector-guard");
const MAIN_COLLECTOR_STATE_MAX_AGE_MS = 45 * 60 * 1000;

interface MainCollectorTelemetry {
  comprasmx_consecutive_failures?: unknown;
  last_comprasmx_error_at?: unknown;
  last_comprasmx_success_at?: unknown;
}

export interface CollectorGuardDecision {
  defer: boolean;
  reason: "collect_lock_active" | "collector_recently_degraded" | null;
}

function parsedTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateCollectorTelemetryGuard(
  state: MainCollectorTelemetry | null,
  now = new Date(),
): CollectorGuardDecision {
  if (!state || typeof state !== "object") return { defer: false, reason: null };
  const failures = state.comprasmx_consecutive_failures;
  const lastErrorAt = parsedTime(state.last_comprasmx_error_at);
  const lastSuccessAt = parsedTime(state.last_comprasmx_success_at);
  if (typeof failures !== "number" || !Number.isFinite(failures) || failures <= 0 || lastErrorAt === null) {
    return { defer: false, reason: null };
  }
  if (lastSuccessAt !== null && lastSuccessAt >= lastErrorAt) {
    return { defer: false, reason: null };
  }
  const ageMs = now.getTime() - lastErrorAt;
  if (ageMs < 0 || ageMs > MAIN_COLLECTOR_STATE_MAX_AGE_MS) {
    return { defer: false, reason: null };
  }
  return { defer: true, reason: "collector_recently_degraded" };
}

export async function shouldDeferWatchdogForCollector(
  now = new Date(),
): Promise<CollectorGuardDecision> {
  // Lectura estrictamente pasiva: nunca adquirir, liberar ni modificar el lock.
  try {
    if (lock.isLocked("collect-job")) {
      return { defer: true, reason: "collect_lock_active" };
    }
  } catch (error) {
    log.warn({ err: error }, "No se pudo leer lock principal; watchdog continúa por fail-open");
    return { defer: false, reason: null };
  }

  try {
    const state = await getState<MainCollectorTelemetry>(STATE_KEYS.COMPRASMX_TELEMETRY);
    return evaluateCollectorTelemetryGuard(state, now);
  } catch (error) {
    log.warn({ err: error }, "No se pudo leer salud del colector; watchdog continúa por fail-open");
    return { defer: false, reason: null };
  }
}
