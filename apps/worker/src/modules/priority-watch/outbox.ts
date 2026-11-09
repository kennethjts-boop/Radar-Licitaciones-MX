/**
 * Bandeja de avisos persistente: el evento se guarda ANTES de intentar el envío.
 * Distingue tres desenlaces de un envío:
 *  - rechazo definitivo de Telegram → `dead` (no se reintenta);
 *  - fallo sin entrega (la petición no llegó a Telegram) → `pending` con espera progresiva;
 *  - entrega incierta (tiempo agotado, conexión cortada o reinicio con el envío en vuelo)
 *    → se reenvía UNA vez marcada como «reenvío». Ventana de duplicación que permanece:
 *    Telegram entrega y el proceso muere antes de asentar `sent`; el reenvío marcado
 *    puede aparecer duplicado (preferimos duplicar con marca antes que perder un aviso).
 */
import { createModuleLogger } from "../../core/logger";
import { isDefinitiveTelegramRejection } from "../operational-alerts/delivery";
import type { OutboxEntry, WatchEvent } from "./types";

const log = createModuleLogger("priority-watch:outbox");

export const MAX_PER_CYCLE = 10;
export const SENDING_STALE_MS = 2 * 60_000;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

export interface OutboxStore {
  load(procedure: string): Promise<OutboxEntry[]>;
  save(procedure: string, entries: OutboxEntry[]): Promise<void>;
}

export type SendFailure = "definitive" | "not_sent" | "uncertain";

/** Clasifica un fallo de envío a Telegram. */
export function classifySendFailure(err: unknown): SendFailure {
  if (isDefinitiveTelegramRejection(err)) return "definitive";
  const text = `${(err as { code?: string })?.code ?? ""} ${(err as Error)?.message ?? err}`.toLowerCase();
  if (/econnrefused|enotfound|eai_again|429|too many requests|getaddrinfo/.test(text)) return "not_sent";
  return "uncertain"; // ETIMEDOUT, ECONNRESET, EPIPE, timeouts y cualquier otro: Telegram pudo haber entregado
}

export function enqueueEvents(
  entries: OutboxEntry[], events: Array<{ event: WatchEvent; text: string; url: string | null }>, nowIso: string,
): { entries: OutboxEntry[]; added: number } {
  const known = new Set(entries.map((entry) => entry.eventId));
  const next = [...entries];
  let added = 0;
  for (const { event, text, url } of events) {
    if (known.has(event.eventId)) continue; // misma identidad: un solo aviso
    known.add(event.eventId);
    next.push({
      eventId: event.eventId, kind: event.kind, text, url, createdAt: nowIso, state: "pending", attempts: 0,
      nextAttemptAt: nowIso, sendingAt: null, sentAt: null, messageId: null, lastError: null, uncertain: false,
    });
    added++;
  }
  // No expulsar pendientes ni identidades ya entregadas: perderlas al alcanzar un
  // límite descarta avisos o permite repetir eventos tras una captura incompleta.
  return { entries: next, added };
}

const awaitingRecord = new Map<string, { messageId: number; sentAt: string }>();
export const _resetAwaitingRecordForTests = (): void => awaitingRecord.clear();

export interface DeliverDeps {
  send(entry: OutboxEntry, text: string): Promise<number>;
  now(): Date;
}

export interface DeliverResult { sent: number; retried: number; uncertainResent: number; dead: number; remaining: number }

export async function deliverOutbox(
  procedure: string, store: OutboxStore, deps: DeliverDeps, options: { max?: number } = {},
): Promise<DeliverResult> {
  const result: DeliverResult = { sent: 0, retried: 0, uncertainResent: 0, dead: 0, remaining: 0 };
  const entries = await store.load(procedure);
  const now = deps.now();
  let budget = options.max ?? MAX_PER_CYCLE;
  for (const entry of entries) {
    // Entrega ya hecha en este proceso pero sin asiento: solo se reintenta el asiento.
    const recorded = awaitingRecord.get(entry.eventId);
    if (recorded && entry.state !== "sent") {
      Object.assign(entry, { state: "sent", messageId: recorded.messageId, sentAt: recorded.sentAt, sendingAt: null, lastError: null });
      try { await store.save(procedure, entries); awaitingRecord.delete(entry.eventId); result.sent++; } catch (err) { log.error({ err }, "Asiento de entrega pendiente"); }
      continue;
    }
    if (entry.state === "sent" || entry.state === "dead") continue;
    const stale = entry.state === "sending" && entry.sendingAt !== null && now.getTime() - Date.parse(entry.sendingAt) >= SENDING_STALE_MS;
    if (entry.state === "sending" && !stale) continue; // otra ejecución lo está enviando
    if (entry.state === "pending" && entry.nextAttemptAt && Date.parse(entry.nextAttemptAt) > now.getTime()) continue;
    if (budget <= 0) continue;
    budget--;

    const uncertain = entry.uncertain || stale; // un envío en vuelo tras reinicio = entrega incierta
    Object.assign(entry, { state: "sending", attempts: entry.attempts + 1, sendingAt: now.toISOString(), uncertain });
    await store.save(procedure, entries); // se persiste la intención ANTES de enviar
    const text = uncertain && !entry.text.includes("Reenvío:")
      ? `↩️ <i>Reenvío: la entrega anterior de este aviso no pudo confirmarse.</i>\n${entry.text}` : entry.text;
    try {
      const messageId = await deps.send(entry, text);
      Object.assign(entry, { state: "sent", messageId, sentAt: deps.now().toISOString(), sendingAt: null, lastError: null });
      awaitingRecord.set(entry.eventId, { messageId, sentAt: entry.sentAt! });
      await store.save(procedure, entries);
      awaitingRecord.delete(entry.eventId);
      result.sent++;
      if (uncertain) result.uncertainResent++;
    } catch (err) {
      const failure = classifySendFailure(err);
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      if (failure === "definitive") {
        Object.assign(entry, { state: "dead", sendingAt: null, lastError: message });
        result.dead++;
      } else if (failure === "not_sent") {
        const wait = BACKOFF_MS[Math.min(entry.attempts - 1, BACKOFF_MS.length - 1)];
        Object.assign(entry, { state: "pending", sendingAt: null, lastError: message, nextAttemptAt: new Date(now.getTime() + wait).toISOString() });
        result.retried++;
      } else {
        // Entrega incierta: queda `sending`; el siguiente ciclo (≥2 min) lo reenvía marcado.
        Object.assign(entry, { uncertain: true, lastError: message });
      }
      try { await store.save(procedure, entries); } catch (saveErr) { log.error({ err: saveErr }, "No se pudo asentar el fallo de envío"); }
    }
  }
  result.remaining = entries.filter((entry) => entry.state === "pending" || entry.state === "sending").length;
  return result;
}
