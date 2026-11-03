/**
 * Cobertura de la medición de IA (system_state).
 *
 * - cost_coverage:ai_usage — instante en que un worker con esta
 *   instrumentación confirmó acceso a ai_usage_events. Se escribe una sola
 *   vez (INSERT); antes de esa fecha no hay medición confiable.
 * - cost_coverage:gaps:YYYY-MM-DD — eventos de IA de ese día MX que no se
 *   pudieron registrar tras agotar los reintentos (lo escribe ai-usage).
 *
 * Un día sin cobertura muestra "sin datos"; uno parcial, "medición parcial".
 * Ninguno de los dos cuenta como gasto cero ni entra a promedios/anomalías.
 */
import { formatInTimeZone } from "date-fns-tz";
import { MX_TIMEZONE } from "../../core/time";
import { mexicoDayBounds } from "./period";
import type { StateStore } from "./report-state";
import type { DayCoverage } from "./types";

/** Sube cuando cambia qué llamadas de IA quedan instrumentadas. */
export const AI_INSTRUMENTATION_VERSION = 2;
export const COVERAGE_KEY = "cost_coverage:ai_usage";
export const gapKey = (date: string) => `cost_coverage:gaps:${date}`;

export interface CoverageMarker {
  since: string;
  version: number;
  instanceId?: string;
}

export interface GapRecord {
  droppedEvents: number;
  updatedAt: string;
}

/**
 * Registra el inicio de la medición si aún no existe y la tabla responde.
 * Devuelve el marcador vigente (el primero que se haya escrito).
 */
export async function ensureCoverageMarker(
  store: StateStore,
  probe: () => Promise<boolean>,
  instanceId: string,
  now: Date = new Date(),
): Promise<CoverageMarker | null> {
  const existing = await store.read<CoverageMarker>(COVERAGE_KEY);
  if (existing) return existing;
  if (!(await probe())) return null;
  const marker: CoverageMarker = { since: now.toISOString(), version: AI_INSTRUMENTATION_VERSION, instanceId };
  await store.insertIfAbsent(COVERAGE_KEY, marker);
  return store.read<CoverageMarker>(COVERAGE_KEY);
}

export function classifyCoverage(date: string, marker: CoverageMarker | null, gap: GapRecord | null): DayCoverage {
  const dropped = Math.max(0, Math.trunc(gap?.droppedEvents ?? 0));
  const since = marker?.since ? new Date(marker.since) : null;
  if (!since || Number.isNaN(since.getTime())) return { status: "none", since: null, droppedEvents: dropped };
  const b = mexicoDayBounds(date);
  if (since.getTime() >= b.endUtc.getTime()) return { status: "none", since: marker!.since, droppedEvents: dropped };
  const sinceWithinDay = since.getTime() > b.startUtc.getTime();
  const status = sinceWithinDay || dropped > 0 ? "partial" : "complete";
  return { status, since: marker!.since, droppedEvents: dropped, sinceWithinDay };
}

/** Sólo días con cobertura completa son comparables en métricas de IA. */
export function isAiComplete(m: { coverage?: DayCoverage }): boolean {
  return m.coverage?.status === "complete";
}

const mx = (iso: string) => formatInTimeZone(new Date(iso), MX_TIMEZONE, "dd/MM/yyyy HH:mm");

/** Leyenda de cobertura para el reporte. */
export function coverageNote(c: DayCoverage): string {
  if (c.status === "none") {
    return c.since
      ? `sin datos: la medición confiable empezó ${mx(c.since)} CDMX`
      : "sin datos: la medición confiable aún no inicia (worker o tabla ai_usage_events pendiente)";
  }
  if (c.status === "partial") {
    const parts: string[] = [];
    if (c.since && c.sinceWithinDay) parts.push(`desde ${mx(c.since)} CDMX`);
    if (c.droppedEvents) parts.push(`${c.droppedEvents} eventos de IA sin registrar`);
    return `medición parcial${parts.length ? `: ${parts.join(" · ")}` : ""}`;
  }
  return "completa";
}
