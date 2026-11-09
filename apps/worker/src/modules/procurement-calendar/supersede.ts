/**
 * El watchdog también detecta cambios de fecha, documentos y estatus. Para no avisar dos veces
 * el mismo cambio, el watchdog cede el aviso SOLO si otro avisador ya cubrió ese expediente y
 * ese cambio concreto:
 *  - folios con vigilancia prioritaria: se exige una captura exitosa DE ESE FOLIO posterior al
 *    cambio del watchdog y que el estado confirmado ya contenga ese mismo valor (fecha, documento,
 *    estatus). Que el ciclo general de Edomex haya terminado bien no basta: el portal puede haber
 *    fallado para un folio concreto.
 *  - resto de expedientes con seguimiento de calendario: cambios SOLO de fecha y calendario del
 *    ciclo general corrido en los últimos 90 min (comportamiento previo).
 * Documentos y cambios de estatus de expedientes ajenos a la vigilancia prioritaria siguen su curso.
 */
import { getSupabaseClient } from "../../storage/client";
import { normalizeText } from "../../core/text";
import { formatInTimeZone } from "date-fns-tz";
import { MX_TIMEZONE } from "../../core/time";
import { classifyChangeCategory, filterAndDeduplicateChanges } from "../watchdog-narrator/classifier";
import type { WatchdogChange, WatchdogSnapshotRow } from "../licitacion-watchdog/types";
import { toMilestone } from "./extract";
import { defaultDeps, isTracking, type CalendarDeps } from "./service";
import { isWatchedProcedure } from "../priority-watch/types";
import { dbStateStore, type StateStore, type WatchState } from "../priority-watch/store";
import type { MilestoneKey } from "./types";

const DATE_CATEGORIES = new Set(["fecha_apertura", "fecha_junta", "fecha_fallo"]);
/** El calendario corre cada 30 min; si no ha corrido en 90 min, el watchdog avisa. */
export const CALENDAR_FRESHNESS_MS = 90 * 60 * 1000;
const MILESTONE_OF: Record<string, MilestoneKey> = {
  fecha_apertura: "presentacion_apertura", fecha_junta: "junta_aclaraciones", fecha_fallo: "fallo",
};

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

const fileKey = (value: string | null | undefined): string =>
  normalizeText(String(value ?? "").replace(/\.[a-z0-9]{2,4}$/i, "")).replace(/\s+/g, "");

function localMilestone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // El watchdog persiste ISO UTC; la vigilancia conserva la hora local del portal.
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
  return toMilestone(zoned ? formatInTimeZone(value, MX_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss") : value).at;
}

/** ¿El estado confirmado de la vigilancia prioritaria ya contiene este cambio del watchdog? */
export function priorityWatchCoversChange(state: WatchState | null, rowCreatedAt: string, change: WatchdogChange): boolean {
  const baseline = state?.baseline;
  if (!state || !baseline || !state.lastSuccessAt) return false;
  // La captura del folio debe ser posterior al cambio que vio el watchdog.
  if (Date.parse(state.lastSuccessAt) < Date.parse(rowCreatedAt)) return false;
  const category = classifyChangeCategory(change);
  if (isDocumentChange(change)) {
    if (!baseline.docsComplete || change.kind === "document_removed" || change.kind === "removed") return false;
    const wanted = fileKey(change.document?.name);
    return wanted !== "" && baseline.documents.some((doc) => {
      if (![doc.nombre, doc.descripcion].some((candidate) => fileKey(candidate) === wanted)) return false;
      // El nombre por sí solo no acredita que una revisión del documento ya esté cubierta.
      if (change.kind !== "document_added") return /\.modifiedAt$/.test(change.path) &&
        typeof change.current === "string" && localMilestone(doc.modifiedAt) === localMilestone(change.current);
      return !change.document?.createdAt || localMilestone(doc.createdAt) === localMilestone(change.document.createdAt);
    });
  }
  if (DATE_CATEGORIES.has(category)) {
    const current = localMilestone(change.current);
    return Boolean(current) && baseline.calendar.milestones[MILESTONE_OF[category]].at === current;
  }
  if (category === "cambio_estatus") {
    const current = normalizeText(String(change.current ?? ""));
    const confirmed = normalizeText(baseline.portalStatus ?? "");
    return current !== "" && confirmed === current;
  }
  if (category === "tabla_modificada") {
    // Cobertura completa no prueba que una celda concreta haya sido avisada. Solo
    // ceder descripciones de partidas con identidad y valor exactos; el resto
    // conserva el respaldo del watchdog hasta poder contrastar sus columnas.
    return state.partidasCoverage.status === "ok" && baseline.partidasComplete &&
      /^visibleTables\[\d+\]\.rows\[\d+\]\[\d+\]$/.test(change.path) &&
      typeof change.current === "string" && /^partida\s+\d+/i.test(change.current) &&
      baseline.partidas.some((p) => normalizeText(p.descripcion) === normalizeText(String(change.current)));
  }
  return false;
}

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
  stateStore: StateStore = dbStateStore,
): Promise<boolean> {
  if (row.detected_changes?.notification?.kind !== "change") return false;
  if (isWatchedProcedure(row.numero_procedimiento)) {
    const state = await stateStore.load(row.numero_procedimiento);
    const changes = filterAndDeduplicateChanges(row.detected_changes.changes ?? []);
    return changes.length > 0 && changes.every((change) => priorityWatchCoversChange(state, row.created_at, change));
  }
  if (!isDateOnlyChange(row)) return false;
  if (!(await calendarRanRecently(nowMs))) return false;
  const { data, error } = await getSupabaseClient().from("procurements").select("id")
    .or(`licitation_number.eq.${row.numero_procedimiento},procedure_number.eq.${row.numero_procedimiento}`).limit(1).maybeSingle();
  if (error || !data) return false;
  return isTracking(String(data.id), deps);
}
