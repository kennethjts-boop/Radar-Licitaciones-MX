/** Ciclo real de la vigilancia prioritaria: lock distribuido, telemetría y dependencias de producción. */
import { getSupabaseClient } from "../../storage/client";
import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { withDistributedLock } from "../../core/lock";
import { nowISO } from "../../core/time";
import { sendTelegramMessage } from "../../alerts/telegram.alerts";
import { saveSnapshot } from "../procurement-calendar/store";
import { gatherEvidence } from "./evidence";
import { watchKeyboard } from "./format";
import { runPriorityWatch, type FolioResult, type RunnerDeps } from "./runner";
import { capturePortal } from "./source";
import { dbOutboxStore, dbStateStore } from "./store";
import type { WatchSnapshot, WatchedProcedure } from "./types";

const log = createModuleLogger("priority-watch:job");
export const PRIORITY_WATCH_STATE_KEY = "priority_watch_last_run";

const STATUS_FOR_KIND: Record<string, string> = { adjudicado: "adjudicada", desierto: "desierta", cancelado: "cancelada", vigente: "activa" };

const idCache = new Map<string, string>();
async function procurementId(procedure: string): Promise<string | null> {
  const cached = idCache.get(procedure);
  if (cached) return cached;
  const { data } = await getSupabaseClient().from("procurements").select("id").eq("licitation_number", procedure).limit(1).maybeSingle();
  const id = (data?.id as string | undefined) ?? null;
  if (id) idCache.set(procedure, id);
  return id;
}

/** La fila de `procurements` se mantiene al día con lo que el portal confirma (estatus, fechas y moneda oficial). */
async function syncRow(watched: WatchedProcedure, snapshot: WatchSnapshot): Promise<void> {
  const id = await procurementId(watched.procedure);
  if (!id) return;
  const update: Record<string, unknown> = { updated_at: nowISO() };
  if (snapshot.portalStatus && STATUS_FOR_KIND[snapshot.statusKind]) update.status = STATUS_FOR_KIND[snapshot.statusKind];
  const apertura = snapshot.calendar.milestones.presentacion_apertura.at;
  if (apertura) update.opening_date = apertura.slice(0, 10);
  if (/peso mexicano|^mxn$/i.test(snapshot.currency ?? "")) update.currency = "MXN";
  const { error } = await getSupabaseClient().from("procurements").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

export function productionDeps(): RunnerDeps {
  return {
    capture: capturePortal, state: dbStateStore, outbox: dbOutboxStore, now: () => new Date(),
    procurementId, syncRow,
    evidence: (watched, snapshot) => gatherEvidence(watched, snapshot),
    saveCalendarSnapshot: async (snapshot) => {
      const id = await procurementId(snapshot.procedure);
      if (id) await saveSnapshot({ ...snapshot.calendar, procurementId: id });
    },
    async send(_entry, text, url, id) {
      const messageId = await sendTelegramMessage(text, "HTML", undefined, { replyMarkup: watchKeyboard(id, url ?? "") });
      if (messageId === null) throw new Error("Telegram no devolvió identificador de mensaje");
      return messageId;
    },
  };
}

export interface PriorityWatchSummary { at: string; deploymentSha: string | null; folios: FolioResult[] }

export async function runPriorityWatchJob(deps: RunnerDeps = productionDeps()): Promise<PriorityWatchSummary | null> {
  return withDistributedLock("priority-watch", "priority-watch", async () => {
    const folios = await runPriorityWatch(deps);
    const summary: PriorityWatchSummary = { at: nowISO(), deploymentSha: getConfig().RAILWAY_GIT_COMMIT_SHA ?? null, folios };
    const { error } = await getSupabaseClient().from("system_state")
      .upsert({ key: PRIORITY_WATCH_STATE_KEY, value_json: summary, updated_at: nowISO() }, { onConflict: "key" });
    if (error) log.warn({ error: error.message }, "No se pudo registrar el resumen de la vigilancia prioritaria");
    log.info({ folios: folios.map((f) => ({ p: f.procedure, s: f.status, e: f.events })) }, "Vigilancia prioritaria completada");
    return summary;
  });
}
