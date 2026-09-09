import { lock, JOB_LOCK_TTL_MS } from "../../core/lock";
import { createModuleLogger } from "../../core/logger";
import { getState, STATE_KEYS } from "../../core/system-state";
import { getSupabaseClient } from "../../storage/client";

const log = createModuleLogger("licitacion-watchdog:collector-guard");
const MAIN_COLLECTOR_STATE_MAX_AGE_MS = 45 * 60 * 1000;
const COLLECT_JOB_LOCK_KEY = "collect-job";

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

/**
 * Lee (sin adquirir ni renovar) la fila de bot_lock de collect-job para
 * detectar un collect-job corriendo en OTRO proceso. El lock en memoria
 * (lock.isLocked) solo ve al proceso local: con el patrón de dos capas de
 * withDistributedLock (core/lock.ts), un collect-job de otro proceso solapado
 * durante un deploy de Railway deja una fila vigente en bot_lock que el
 * proceso local nunca vería de otro modo. El watchdog ya depende de Supabase
 * más abajo para leer telemetría, así que esta lectura extra no introduce una
 * dependencia nueva — se le aplica el mismo criterio fail-open: si Supabase
 * no responde, se asume que no hay lock activo y el watchdog continúa.
 */
async function isDistributedCollectLockActive(now: Date): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("bot_lock")
      .select("updated_at")
      .eq("key", COLLECT_JOB_LOCK_KEY)
      .maybeSingle();

    if (error) {
      log.warn(
        { err: error },
        "No se pudo leer lock distribuido de collect-job; watchdog continúa por fail-open",
      );
      return false;
    }
    if (!data?.updated_at) return false;

    const updatedAt = Date.parse(data.updated_at);
    if (!Number.isFinite(updatedAt)) return false;

    return now.getTime() - updatedAt < JOB_LOCK_TTL_MS;
  } catch (error) {
    log.warn(
      { err: error },
      "Excepción leyendo lock distribuido de collect-job; watchdog continúa por fail-open",
    );
    return false;
  }
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

  if (await isDistributedCollectLockActive(now)) {
    return { defer: true, reason: "collect_lock_active" };
  }

  try {
    const state = await getState<MainCollectorTelemetry>(STATE_KEYS.COMPRASMX_TELEMETRY);
    return evaluateCollectorTelemetryGuard(state, now);
  } catch (error) {
    log.warn({ err: error }, "No se pudo leer salud del colector; watchdog continúa por fail-open");
    return { defer: false, reason: null };
  }
}
