/** Ciclo de vigilancia prioritaria: captura → diff → bandeja (persistida) → entrega. */
import { createModuleLogger } from "../../core/logger";
import { eventIdFor, diffWatchSnapshots, partidaResultLines } from "./events";
import { formatWatchMessage, watchKeyboard, type SourceEvidence } from "./format";
import { buildWatchSnapshot, type PortalCapture } from "./snapshot";
import { deliverOutbox, enqueueEvents, type DeliverResult, type OutboxStore } from "./outbox";
import { emptyState, type StateStore, type WatchState } from "./store";
import { WATCHED_PROCEDURES, type WatchSnapshot, type WatchedProcedure } from "./types";
import type { OutboxEntry } from "./types";
import { MILESTONE_KEYS } from "../procurement-calendar/types";

const log = createModuleLogger("priority-watch");

export const BASE_INTERVAL_MS = 15 * 60_000;
export const MAX_BACKOFF_MS = 120 * 60_000;
/** Ciclos seguidos con la tabla de partidas incompleta para declarar la cobertura degradada. */
export const DEGRADED_AFTER = 3;

export const backoffMs = (failures: number): number =>
  failures <= 0 ? 0 : Math.min(BASE_INTERVAL_MS * 2 ** Math.min(failures - 1, 3), MAX_BACKOFF_MS);

export interface RunnerDeps {
  capture(watched: WatchedProcedure): Promise<PortalCapture>;
  state: StateStore;
  outbox: OutboxStore;
  send(entry: OutboxEntry, text: string, keyboardUrl: string | null, procurementId: string | null): Promise<number>;
  procurementId(procedure: string): Promise<string | null>;
  /** Mantiene al día la fila de `procurements` (estatus, fechas, moneda oficial) con lo confirmado. */
  syncRow?(watched: WatchedProcedure, snapshot: WatchSnapshot): Promise<void>;
  /** Contraste con fuentes de respaldo (DOF / datos abiertos). */
  evidence?(watched: WatchedProcedure, snapshot: WatchSnapshot): Promise<SourceEvidence[]>;
  saveCalendarSnapshot?(snapshot: WatchSnapshot): Promise<void>;
  now(): Date;
}

export interface FolioResult {
  procedure: string;
  checked: boolean;
  status: "ok" | "baseline" | "failed" | "backoff";
  events: number;
  delivery: DeliverResult | null;
  error?: string;
  nextAttemptAt?: string | null;
  partidasCoverage?: string;
}

/** El último estado confirmado se conserva cuando la fuente llega incompleta o deja de mostrar un dato. */
export function mergeConfirmed(prev: WatchSnapshot, next: WatchSnapshot): WatchSnapshot {
  const merged: WatchSnapshot = { ...next };
  if (!next.partidasComplete) {
    merged.partidas = prev.partidas; merged.partidasComplete = prev.partidasComplete;
  }
  // Conserva documentos conocidos y añade evidencia nueva incluso con paginación incompleta.
  merged.documents = [...new Map([...prev.documents, ...next.documents].map((doc) => [doc.id, doc])).values()];
  merged.docsComplete = prev.docsComplete || next.docsComplete;
  if (next.portalStatus === null) { merged.portalStatus = prev.portalStatus; merged.statusKind = prev.statusKind; }
  if (next.contracts.length === 0 && prev.contracts.length > 0) merged.contracts = prev.contracts;
  const milestones = { ...next.calendar.milestones };
  for (const key of MILESTONE_KEYS) if (!milestones[key].at && prev.calendar.milestones[key].at) milestones[key] = prev.calendar.milestones[key];
  merged.calendar = { ...next.calendar, milestones, falloActa: next.calendar.falloActa ?? prev.calendar.falloActa };
  return merged;
}

function localNow(now: Date): string {
  return new Date(now.getTime() - 6 * 3600_000).toISOString().slice(0, 19); // CDMX = UTC-6 (sin horario de verano)
}

export function updateCoverage(state: WatchState, next: WatchSnapshot, nowIso: string): WatchState["partidasCoverage"] {
  const previous = state.partidasCoverage;
  if (next.partidasComplete) return { status: "ok", since: null, consecutive: 0, reason: null };
  const consecutive = previous.consecutive + 1;
  return {
    status: consecutive >= DEGRADED_AFTER ? "degraded" : "transient",
    since: previous.since ?? nowIso, consecutive, reason: next.partidasReason,
  };
}

async function processFolio(watched: WatchedProcedure, deps: RunnerDeps): Promise<FolioResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const state = await deps.state.load(watched.procedure);
  const result: FolioResult = { procedure: watched.procedure, checked: false, status: "ok", events: 0, delivery: null };
  const deliver = async () => {
    result.delivery = await deliverOutbox(watched.procedure, deps.outbox, {
      now: () => deps.now(),
      send: async (entry, text) => deps.send(entry, text, entry.url, await deps.procurementId(watched.procedure)),
    });
  };

  if (state.nextAttemptAt && Date.parse(state.nextAttemptAt) > now.getTime()) {
    result.status = "backoff"; result.nextAttemptAt = state.nextAttemptAt;
    await deliver(); // la bandeja se entrega aunque el portal esté en espera
    return result;
  }

  let snapshot: WatchSnapshot | null = null;
  try {
    const capture = await deps.capture(watched);
    snapshot = buildWatchSnapshot(watched, capture);
    if (!snapshot) throw new Error("El detalle del portal llegó sin el registro del expediente");
    if (snapshot.expediente !== watched.expediente) throw new Error(`El expediente del portal (${snapshot.expediente}) no coincide con el vigilado (${watched.expediente})`);
  } catch (err) {
    const failures = state.consecutiveFailures + 1;
    state.consecutiveFailures = failures; state.lastAttemptAt = nowIso;
    state.lastError = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    state.nextAttemptAt = new Date(now.getTime() + backoffMs(failures)).toISOString();
    await deps.state.save(watched.procedure, state); // el último estado confirmado no se toca
    Object.assign(result, { status: "failed", error: state.lastError, nextAttemptAt: state.nextAttemptAt, checked: false });
    log.warn({ procedure: watched.procedure, failures, nextAttemptAt: state.nextAttemptAt }, "Portal sin respuesta útil; se conserva el último estado confirmado");
    await deliver();
    return result;
  }
  result.checked = true;

  const coverage = updateCoverage(state, snapshot, nowIso);
  if (!state.baseline) {
    // Lectura inicial: lo ya publicado es la línea base (sin avisos históricos en lote).
    const pending: string[] = [];
    if (snapshot.documents.some((doc) => doc.category === "acta_fallo")) {
      pending.push("Resultado por renglón/partida, participantes y ofertas: constan en el acta de fallo (PDF con CAPTCHA); revisar el documento.");
    }
    if (snapshot.statusKind === "vigente" && !snapshot.calendar.milestones.fallo.at) pending.push("Fecha del fallo: sin publicar.");
    state.baseline = snapshot; state.pendingVerification = pending;
    state.initialReport = {
      capturedAt: snapshot.capturedAt, portalStatus: snapshot.portalStatus, statusKind: snapshot.statusKind, currency: snapshot.currency,
      fallo: snapshot.calendar.milestones.fallo.at, actaFallo: snapshot.documents.find((d) => d.category === "acta_fallo")?.createdAt ?? null,
      contracts: snapshot.contracts.map((c) => ({ numero: c.numero, licitante: c.licitante, importeMax: c.importeMax, moneda: c.moneda, estatus: c.estatus })),
      resultadoPorPartida: partidaResultLines(snapshot, snapshot.contracts),
      partidas: snapshot.partidas.length, partidasCompletas: snapshot.partidasComplete,
    };
    result.status = "baseline";
  } else {
    const events = diffWatchSnapshots(watched, state.baseline, snapshot);
    result.events = events.length;
    if (events.length > 0) {
      const evidence = deps.evidence ? await deps.evidence(watched, snapshot).catch(() => []) : [];
      const url = snapshot.officialUrl;
      const prepared = events.map((event) => ({
        event, url,
        text: formatWatchMessage(watched, snapshot!, event, { detectedAt: nowIso, evidence, nowLocal: localNow(now) }),
      }));
      // 1) Persistir las novedades ANTES de enviar y ANTES de adelantar la línea base.
      const entries = await deps.outbox.load(watched.procedure);
      const queued = enqueueEvents(entries, prepared, nowIso);
      if (queued.added > 0) await deps.outbox.save(watched.procedure, queued.entries);
    }
    state.baseline = mergeConfirmed(state.baseline, snapshot);
    if (events.some((e) => e.kind === "fallo") && !state.pendingVerification.some((item) => /acta de fallo/i.test(item))) {
      state.pendingVerification.push("Resultado por partida, participantes y ofertas: pendientes de verificar en el acta de fallo (PDF con CAPTCHA).");
    }
  }
  state.partidasCoverage = coverage;
  Object.assign(state, { lastSuccessAt: nowIso, lastAttemptAt: nowIso, consecutiveFailures: 0, nextAttemptAt: null, lastError: null });
  await deps.state.save(watched.procedure, state);
  result.partidasCoverage = coverage.status;
  await deps.syncRow?.(watched, snapshot).catch((err) => log.warn({ err }, "No se pudo actualizar la fila del procedimiento"));
  await deps.saveCalendarSnapshot?.(state.baseline).catch(() => undefined);
  await deliver();
  return result;
}

export async function runPriorityWatch(deps: RunnerDeps, procedures: readonly WatchedProcedure[] = WATCHED_PROCEDURES): Promise<FolioResult[]> {
  const results: FolioResult[] = [];
  for (const watched of procedures) {
    try {
      results.push(await processFolio(watched, deps));
    } catch (err) {
      log.error({ err, procedure: watched.procedure }, "Vigilancia prioritaria: error contenido; el folio se reintenta en el siguiente ciclo");
      results.push({ procedure: watched.procedure, checked: false, status: "failed", events: 0, delivery: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

export { eventIdFor, emptyState };
