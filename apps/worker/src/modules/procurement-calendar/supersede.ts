/**
 * El watchdog también detecta cambios de fecha. Cuando el expediente tiene
 * seguimiento de calendario, esos cambios SOLO de fecha ya los avisa el
 * calendario (con fecha anterior, nueva y enlace), así que no se envían dos
 * veces. Cualquier otro cambio (estatus, documentos, partidas) sigue su curso.
 */
import { getSupabaseClient } from "../../storage/client";
import { classifyChangeCategory, filterAndDeduplicateChanges } from "../watchdog-narrator/classifier";
import type { WatchdogSnapshotRow } from "../licitacion-watchdog/types";
import { defaultDeps, isTracking, type CalendarDeps } from "./service";

const DATE_CATEGORIES = new Set(["fecha_apertura", "fecha_junta", "fecha_fallo"]);

export function isDateOnlyChange(row: WatchdogSnapshotRow): boolean {
  if (row.detected_changes?.notification?.kind !== "change") return false;
  const changes = filterAndDeduplicateChanges(row.detected_changes.changes ?? []);
  return changes.length > 0 && changes.every((change) => DATE_CATEGORIES.has(classifyChangeCategory(change)));
}

export async function calendarCoversWatchdogChange(
  row: WatchdogSnapshotRow, deps: CalendarDeps = defaultDeps,
): Promise<boolean> {
  if (!isDateOnlyChange(row)) return false;
  const { data, error } = await getSupabaseClient().from("procurements").select("id")
    .or(`licitation_number.eq.${row.numero_procedimiento},procedure_number.eq.${row.numero_procedimiento}`).limit(1).maybeSingle();
  if (error || !data) return false;
  return isTracking(String(data.id), deps);
}
