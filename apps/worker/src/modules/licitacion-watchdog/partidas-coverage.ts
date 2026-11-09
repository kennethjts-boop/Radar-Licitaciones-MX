/**
 * Cobertura de partidas del watchdog por folio. Cuando la tabla de partidas llega vacía o
 * incompleta (`structural_incomplete`), el watchdog conserva la última captura confirmada y no
 * avisa desapariciones. Si el problema persiste varios ciclos seguidos, se registra que la
 * cobertura de partidas está DEGRADADA para ese folio (visible en telemetría y /estado).
 */
import { getSupabaseClient } from "../../storage/client";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";

const log = createModuleLogger("licitacion-watchdog:partidas-coverage");
const PREFIX = "watchdog_partidas_coverage:";
export const DEGRADED_AFTER_CYCLES = 3;

export interface PartidasCoverageState {
  status: "ok" | "transient" | "degraded";
  consecutive: number;
  since: string | null;
  lastReasons: string[];
  updatedAt: string;
}

export function nextPartidasCoverage(
  previous: PartidasCoverageState | null, incompleteReasons: string[] | null, nowIsoValue: string,
): PartidasCoverageState {
  if (!incompleteReasons) return { status: "ok", consecutive: 0, since: null, lastReasons: [], updatedAt: nowIsoValue };
  const consecutive = (previous?.status === "ok" || !previous ? 0 : previous.consecutive) + 1;
  return {
    status: consecutive >= DEGRADED_AFTER_CYCLES ? "degraded" : "transient",
    consecutive, since: previous && previous.status !== "ok" ? previous.since : nowIsoValue,
    lastReasons: incompleteReasons.slice(0, 5), updatedAt: nowIsoValue,
  };
}

export async function recordPartidasCoverage(numero: string, incompleteReasons: string[] | null): Promise<PartidasCoverageState | null> {
  try {
    const db = getSupabaseClient();
    const { data } = await db.from("system_state").select("value_json").eq("key", PREFIX + numero).maybeSingle();
    const previous = (data?.value_json as PartidasCoverageState | null) ?? null;
    if (!incompleteReasons && (!previous || previous.status === "ok")) return previous; // sin escritura innecesaria
    const next = nextPartidasCoverage(previous, incompleteReasons, nowISO());
    await db.from("system_state").upsert({ key: PREFIX + numero, value_json: next, updated_at: nowISO() }, { onConflict: "key" });
    if (next.status === "degraded" && previous?.status !== "degraded") {
      log.warn({ numero, since: next.since, reasons: next.lastReasons }, "Cobertura de partidas DEGRADADA para el folio");
    }
    return next;
  } catch (err) {
    log.warn({ err, numero }, "No se pudo registrar la cobertura de partidas");
    return null;
  }
}
