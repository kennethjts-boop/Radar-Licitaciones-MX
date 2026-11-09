/**
 * Orquestación del calendario: vista bajo demanda, autorización de seguimiento
 * (reutiliza el consentimiento y el objetivo del watchdog) y ciclo de avisos.
 */
import { getSupabaseClient } from "../../storage/client";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { calendarFromComprasMxDetail, calendarFromDbRow, calendarFromSecogem, type ComprasMxDetailData } from "./extract";
import { diffCalendars } from "./diff";
import { formatChangeMessage, formatCalendarMessage } from "./format";
import { fetchComprasMxDetailData } from "./fetch";
import * as store from "./store";
import type { CalendarSnapshot } from "./types";
import { isWatchedProcedure } from "../priority-watch/types";

const log = createModuleLogger("procurement-calendar");

/** Radares cuyas alertas llevan los botones de calendario (se amplía aquí). */
export const CALENDAR_BUTTON_RADAR_KEYS: readonly string[] = ["birmex_prioridad_20261108"];
const TERMINAL_STATUS = /adjudicad|cancelad|desiert|cerrad|fallo/i;

export interface ProcurementInfo {
  id: string;
  expediente: string;
  title: string | null;
  buyer: string | null;
  sourceKey: string;
  sourceUrl: string;
  status: string | null;
  openingDate: string | null;
  publicationDate: string | null;
  createdAt: string | null;
  rawJson: Record<string, unknown>;
}

export interface CalendarDeps {
  loadProcurement(idOrNumber: string): Promise<ProcurementInfo | null>;
  fetchDetail(url: string): Promise<ComprasMxDetailData>;
  send(text: string, procurementId: string, tracking: boolean): Promise<void>;
  watchdogEnable(procurementId: string, userId?: number): Promise<void>;
  watchdogDisable(procurementId: string): Promise<void>;
  /** Expedientes de los radares con botones cuyo seguimiento ya autorizó el watchdog. */
  implicitTrackedIds(): Promise<string[]>;
  now(): string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadProcurementFromDb(idOrNumber: string): Promise<ProcurementInfo | null> {
  // Un número de expediente válido no lleva comas ni paréntesis: evita alterar el filtro de PostgREST.
  if (!UUID.test(idOrNumber) && !/^[A-Za-z0-9][A-Za-z0-9./_-]{2,80}$/.test(idOrNumber)) return null;
  const db = getSupabaseClient();
  const query = db.from("procurements").select("*, sources(key), raw_items:raw_item_id(raw_json)");
  const { data, error } = UUID.test(idOrNumber)
    ? await query.eq("id", idOrNumber).maybeSingle()
    : await query.or(`licitation_number.eq.${idOrNumber},procedure_number.eq.${idOrNumber}`).limit(1).maybeSingle();
  if (error) throw new Error(`calendario: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const pick = <T>(value: unknown): T | null => (Array.isArray(value) ? (value[0] as T) : (value as T)) ?? null;
  return {
    id: String(row.id), expediente: String(row.licitation_number ?? row.procedure_number ?? row.external_id ?? ""),
    title: (row.title as string) ?? null, buyer: [row.dependency_name, row.buying_unit].filter(Boolean).join(" · ") || null,
    sourceKey: pick<{ key?: string }>(row.sources)?.key ?? "comprasmx", sourceUrl: String(row.source_url ?? ""),
    status: (row.status as string) ?? null, openingDate: (row.opening_date as string) ?? null,
    publicationDate: (row.publication_date as string) ?? null, createdAt: (row.created_at as string) ?? null,
    rawJson: pick<{ raw_json?: Record<string, unknown> }>(row.raw_items)?.raw_json ?? {},
  };
}

export const defaultDeps: CalendarDeps = {
  loadProcurement: loadProcurementFromDb,
  fetchDetail: fetchComprasMxDetailData,
  async send(text, procurementId, tracking) {
    const { sendTelegramMessage } = await import("../../alerts/telegram.alerts");
    const { calendarKeyboard } = await import("./keyboard");
    await sendTelegramMessage(text, "HTML", undefined, { replyMarkup: calendarKeyboard(procurementId, tracking) });
  },
  async watchdogEnable(procurementId, userId) {
    const { approveWatchdogForProcurement } = await import("../licitacion-watchdog/consent");
    await approveWatchdogForProcurement(procurementId, userId);
  },
  async watchdogDisable(procurementId) {
    const { declineWatchdogForProcurement } = await import("../licitacion-watchdog/consent");
    await declineWatchdogForProcurement(procurementId);
  },
  async implicitTrackedIds() {
    const { data, error } = await getSupabaseClient().from("alerts")
      .select("procurement_id, radars!inner(key)").eq("alert_type", "new_match").eq("telegram_status", "sent")
      .in("radars.key", [...CALENDAR_BUTTON_RADAR_KEYS]).limit(200);
    if (error) throw new Error(`calendario: ${error.message}`);
    const ids = [...new Set((data ?? []).map((row) => String(row.procurement_id)))];
    const { approvedWatchdogIds } = await import("../licitacion-watchdog/consent-store");
    return [...(await approvedWatchdogIds(ids))];
  },
  now: nowISO,
};

/** Captura el calendario desde la fuente oficial del expediente. */
export async function captureCalendar(info: ProcurementInfo, deps: CalendarDeps): Promise<CalendarSnapshot> {
  const capturedAt = deps.now();
  if (info.sourceKey === "secogem_edomex") {
    return calendarFromSecogem({ procurementId: info.id, expediente: info.expediente, officialUrl: info.sourceUrl, capturedAt, rawJson: info.rawJson });
  }
  if (info.sourceKey === "comprasmx") {
    const data = await deps.fetchDetail(info.sourceUrl);
    const snapshot = calendarFromComprasMxDetail({ procurementId: info.id, officialUrl: info.sourceUrl, capturedAt, data });
    if (!snapshot) throw new Error("El detalle del portal no trae el registro del expediente");
    return snapshot;
  }
  return calendarFromDbRow({
    procurementId: info.id, expediente: info.expediente, officialUrl: info.sourceUrl, capturedAt,
    publicationDate: info.publicationDate, openingDate: info.openingDate, status: info.status,
  });
}

/**
 * Origen de un registro de seguimiento. Un `enabled` sin usuario ni chat lo creó un ciclo del
 * propio radar (estado heredado): NO es evidencia de que alguien pulsara un botón.
 */
export function trackingOrigin(state: store.TrackingState | null): "none" | "user" | "legacy" {
  if (!state) return "none";
  return state.by !== undefined || state.chatId !== undefined ? "user" : "legacy";
}

export async function isTracking(procurementId: string, deps: CalendarDeps): Promise<boolean> {
  const explicit = await store.getTracking(procurementId);
  // Un registro heredado habilitado solo confirma el seguimiento ya existente; uno `disabled` lo apaga.
  if (explicit) return explicit.enabled;
  return (await deps.implicitTrackedIds().catch((): string[] => [])).includes(procurementId);
}

export interface CalendarView {
  info: ProcurementInfo;
  snapshot: CalendarSnapshot;
  stale: boolean;
  tracking: boolean;
  text: string;
}

/**
 * Calendario para el botón «Ver calendario» o /calendario. Si el portal falla
 * conserva el último calendario confirmado. Una consulta nunca adelanta la
 * línea base de un expediente con seguimiento (el ciclo detectaría el cambio).
 */
export async function getCalendarView(idOrNumber: string, deps: CalendarDeps = defaultDeps): Promise<CalendarView | null> {
  const info = await deps.loadProcurement(idOrNumber);
  if (!info) return null;
  const tracking = isWatchedProcedure(info.expediente) || await isTracking(info.id, deps);
  let snapshot: CalendarSnapshot;
  let stale = false;
  try {
    snapshot = await captureCalendar(info, deps);
    if (!tracking) await store.saveSnapshot(snapshot).catch((err) => log.warn({ err }, "No se guardó el calendario consultado"));
  } catch (err) {
    log.warn({ err, procurementId: info.id }, "Portal sin respuesta; se usa el último calendario confirmado");
    const previous = await store.getSnapshot(info.id).catch(() => null);
    snapshot = previous ?? calendarFromDbRow({
      procurementId: info.id, expediente: info.expediente, officialUrl: info.sourceUrl, capturedAt: deps.now(),
      publicationDate: info.publicationDate, openingDate: info.openingDate, status: info.status,
    });
    stale = Boolean(previous);
    if (!previous) snapshot = { ...snapshot, limitations: [...snapshot.limitations] };
  }
  return {
    info, snapshot, stale, tracking,
    text: formatCalendarMessage(snapshot, { title: info.title, buyer: info.buyer, firstDetectedAt: info.createdAt, stale, tracking }),
  };
}

export async function enableTracking(
  idOrNumber: string, chatId: string, userId: number | undefined, deps: CalendarDeps = defaultDeps,
): Promise<{ info: ProcurementInfo; baselineFrom: "portal" | "guardado" } | null> {
  const info = await deps.loadProcurement(idOrNumber);
  if (!info) return null;
  let baselineFrom: "portal" | "guardado" = "portal";
  try {
    await store.saveSnapshot(await captureCalendar(info, deps));
  } catch (err) {
    log.warn({ err, procurementId: info.id }, "Línea base del calendario tomada de lo guardado");
    baselineFrom = "guardado";
    if (!(await store.getSnapshot(info.id).catch(() => null))) {
      await store.saveSnapshot(calendarFromDbRow({
        procurementId: info.id, expediente: info.expediente, officialUrl: info.sourceUrl, capturedAt: deps.now(),
        publicationDate: info.publicationDate, openingDate: info.openingDate, status: info.status,
      }));
    }
  }
  await store.saveTracking(info.id, { enabled: true, chatId, by: userId, enabledAt: deps.now(), consecutiveFailures: 0 });
  if (info.sourceKey === "comprasmx") {
    await deps.watchdogEnable(info.id, userId).catch((err) => log.warn({ err }, "Watchdog no pudo activarse; el calendario sigue activo"));
  }
  return { info, baselineFrom };
}

export async function disableTracking(idOrNumber: string, deps: CalendarDeps = defaultDeps): Promise<ProcurementInfo | null> {
  const info = await deps.loadProcurement(idOrNumber);
  if (!info) return null;
  await store.saveTracking(info.id, { enabled: false, disabledAt: deps.now() });
  if (info.sourceKey === "comprasmx") {
    await deps.watchdogDisable(info.id).catch((err) => log.warn({ err }, "Watchdog no pudo desactivarse"));
  }
  return info;
}

export interface TrackingRunResult {
  tracked: number;
  baselines: number;
  notified: number;
  changes: number;
  portalFailures: number;
  unchanged: number;
}

/** Ciclo de avisos: un mensaje por expediente con fechas nuevas/modificadas, avisos o acta de fallo. */
export async function runCalendarTracking(
  deps: CalendarDeps = defaultDeps, options: { max?: number } = {},
): Promise<TrackingRunResult> {
  const result: TrackingRunResult = { tracked: 0, baselines: 0, notified: 0, changes: 0, portalFailures: 0, unchanged: 0 };
  const explicit = await store.listTrackedProcurementIds();
  const implicit: string[] = [];
  for (const id of await deps.implicitTrackedIds().catch((): string[] => [])) {
    if (!explicit.includes(id) && !(await store.getTracking(id))) implicit.push(id);
  }
  for (const id of [...explicit, ...implicit].slice(0, options.max ?? 10)) {
    result.tracked++;
    try {
      const info = await deps.loadProcurement(id);
      if (!info) continue;
      // La vigilancia prioritaria es la única que avisa estos folios (misma identidad de evento).
      if (isWatchedProcedure(info.expediente)) { result.tracked--; continue; }
      const baseline = await store.getSnapshot(id);
      let next: CalendarSnapshot;
      try {
        next = await captureCalendar(info, deps);
      } catch (err) {
        // Falla del portal: se conserva el último calendario confirmado y no se avisa nada.
        result.portalFailures++;
        // Solo se anotan fallas en seguimientos explícitos: uno implícito (autorizado en el
        // watchdog) no debe convertirse en registro propio, o sobreviviría a retirar ese permiso.
        const tracking = await store.getTracking(id);
        if (tracking) {
          await store.saveTracking(id, { ...tracking, lastFailureAt: deps.now(), consecutiveFailures: (tracking.consecutiveFailures ?? 0) + 1 });
        }
        log.warn({ err, procurementId: id }, "Calendario no actualizado: el portal falló; se conserva el último confirmado");
        continue;
      }
      if (!baseline || baseline.source === "db") {
        await store.saveSnapshot(next);
        result.baselines++;
        continue;
      }
      const notified = await store.getNotifiedKeys(id);
      const changes = diffCalendars(baseline, next).filter((change) => !notified.has(change.dedupeKey));
      if (changes.length === 0) {
        await store.saveSnapshot(next);
        result.unchanged++;
      } else {
        result.changes += changes.length;
        await deps.send(formatChangeMessage(next, changes, { detectedAt: deps.now(), title: info.title }), id, true);
        await store.addNotifiedKeys(id, changes.map((change) => change.dedupeKey));
        await store.saveSnapshot(next);
        result.notified++;
      }
      const current = await store.getTracking(id);
      if (current?.consecutiveFailures) await store.saveTracking(id, { ...current, lastFailureAt: null, consecutiveFailures: 0 });
      // Procedimiento terminado con acta de fallo publicada: ya no hay más hitos que vigilar.
      if (next.falloActa && TERMINAL_STATUS.test(next.portalStatus ?? "")) {
        await store.saveTracking(id, { enabled: false, disabledAt: deps.now() });
      }
    } catch (err) {
      log.warn({ err, procurementId: id }, "Seguimiento de calendario pendiente de reintento");
    }
  }
  return result;
}
