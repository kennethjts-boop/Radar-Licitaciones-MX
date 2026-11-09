/**
 * El watchdog también detecta cambios de fecha. Cuando el expediente tiene
 * seguimiento de calendario y el calendario corrió hace poco, esos cambios SOLO
 * de fecha ya los avisa el calendario (con fecha anterior, nueva y enlace), así
 * que no se envían dos veces. Documentos (aunque se llamen «junta» o «fallo»),
 * estatus y partidas siempre siguen su curso por el watchdog.
 */
import { getSupabaseClient } from "../../storage/client";
import { classifyChangeCategory, filterAndDeduplicateChanges } from "../watchdog-narrator/classifier";
import type { WatchdogChange, WatchdogSnapshotRow } from "../licitacion-watchdog/types";
import { defaultDeps, isTracking, type CalendarDeps } from "./service";

const DATE_CATEGORIES = new Set(["fecha_apertura", "fecha_junta", "fecha_fallo"]);
/** El calendario corre cada 30 min; si no ha corrido en 90 min, el watchdog avisa. */
export const CALENDAR_FRESHNESS_MS = 90 * 60 * 1000;

function isDocumentChange(change: WatchdogChange): boolean {
  return Boolean(change.document) || change.kind === "document_added" || change.kind === "document_removed" ||
    /documents?|documentsignature|anexo/i.test(change.path ?? "");
}

export function isDateOnlyChange(row: WatchdogSnapshotRow): boolean {
  if (row.detected_changes?.notification?.kind !== "change") return false;
  const changes = filterAndDeduplicateChanges(row.detected_changes.changes ?? []);
  return changes.length > 0 && changes.every((change) =>
    !isDocumentChange(change) && DATE_CATEGORIES.has(classifyChangeCategory(change)));
}

/** Última corrida del calendario (resumen del ciclo Edomex) dentro de la ventana de frescura. */
export async function calendarRanRecently(nowMs = Date.now()): Promise<boolean> {
  const { data, error } = await getSupabaseClient().from("system_state").select("value_json")
    .eq("key", "edomex_last_run").maybeSingle();
  if (error || !data) return false;
  const value = data.value_json as { at?: string; calendar?: unknown; calendarError?: string } | null;
  if (!value?.at || !value.calendar || value.calendarError) return false;
  return nowMs - Date.parse(value.at) < CALENDAR_FRESHNESS_MS;
}

export async function calendarCoversWatchdogChange(
  row: WatchdogSnapshotRow, deps: CalendarDeps = defaultDeps, nowMs = Date.now(),
): Promise<boolean> {
  if (!isDateOnlyChange(row)) return false;
  if (!(await calendarRanRecently(nowMs))) return false;
  const { data, error } = await getSupabaseClient().from("procurements").select("id")
    .or(`licitation_number.eq.${row.numero_procedimiento},procedure_number.eq.${row.numero_procedimiento}`).limit(1).maybeSingle();
  if (error || !data) return false;
  return isTracking(String(data.id), deps);
}
