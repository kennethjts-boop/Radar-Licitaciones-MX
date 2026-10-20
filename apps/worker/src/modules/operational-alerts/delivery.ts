/**
 * DELIVERY — entrega de alertas nuevas pendientes de Telegram.
 *
 * Requisitos operativos que este módulo garantiza:
 *
 * 1. Observabilidad: todo fallo de envío queda registrado con el identificador
 *    de la alerta.
 * 2. Sin duplicados dentro del proceso: si el mensaje YA llegó a Telegram y lo
 *    que falla es el asiento en base de datos, el `message_id` se guarda en un
 *    registro en memoria. En los ciclos siguientes esa alerta NO se reenvía:
 *    sólo se reintenta el asiento (`markSent`, que además activa el watchdog
 *    elegible). La alerta sigue en `pending` hasta asentarse, así que tampoco
 *    se pierde ni queda fuera de la conciliación del watchdog.
 * 3. Sin reintentos infinitos: un rechazo definitivo de la API de Telegram
 *    atribuible al MENSAJE (HTTP 400 por formato/longitud) se marca `failed`
 *    para recuperación manual. Los errores del CANAL (token inválido, bot
 *    expulsado, chat inexistente: 401/403/404 o 400 "chat not found") no son
 *    culpa de la alerta y se tratan como transitorios: marcarlos `failed`
 *    descartaría en bloque alertas legítimas por un error de configuración.
 *
 * Límite conocido (no evitable sin transacción con Telegram): Telegram no
 * admite envío idempotente. Si el proceso se reinicia DESPUÉS de entregar un
 * mensaje y ANTES de poder asentarlo (BD caída durante todo ese intervalo), el
 * registro en memoria se pierde y la alerta se reenviará una vez: la garantía
 * es "al menos una vez" ante reinicios y "exactamente una vez" en otro caso.
 * Se prefiere un posible duplicado a perder una oportunidad.
 */
import { createModuleLogger } from "../../core/logger";
import { describeTelegramSendError } from "../../alerts/telegram.alerts";

const log = createModuleLogger("operational-alerts:delivery");

export interface PendingNewTenderAlert {
  id: string;
  telegramMessage: string;
}

export interface DeliveryOutcome {
  /** Alertas entregadas y asentadas correctamente (incluye asientos recuperados). */
  sent: number;
  /** Alertas marcadas como carta muerta (rechazo definitivo). */
  failed: number;
  /** Alertas que siguen pendientes para el siguiente ciclo. */
  remaining: number;
  /** Entregadas a Telegram cuyo asiento sigue pendiente (no se reenvían). */
  unrecorded: number;
}

export interface DeliveryOptions {
  /** Asienta la entrega (puede fallar si la base de datos no responde). */
  markSent: (alert: PendingNewTenderAlert, messageId: number) => Promise<void>;
  /** Marca la alerta como carta muerta (sólo rechazos definitivos, nunca entregadas). */
  markFailed?: (alert: PendingNewTenderAlert, messageId: number | null) => Promise<void>;
  /** Clasifica si el error es un rechazo definitivo (no reintentable). */
  isDefinitiveRejection?: (err: unknown) => boolean;
}

/**
 * Entregadas a Telegram pero sin asiento en base de datos: alertId → message_id.
 * Vive mientras viva el proceso (ver límite conocido en la cabecera).
 */
const deliveredAwaitingRecord = new Map<string, number>();

/** `true` si la alerta ya llegó a Telegram y sólo falta asentarla. */
export function isDeliveredAwaitingRecord(alertId: string): boolean {
  return deliveredAwaitingRecord.has(alertId);
}

/** Sólo para pruebas. */
export function resetDeliveryLedgerForTests(): void {
  deliveredAwaitingRecord.clear();
}

const CHANNEL_LEVEL_REJECTION =
  /chat not found|bot was blocked|bot was kicked|not a member|not enough rights|have no rights|need administrator|unauthorized|forbidden|chat_id|group chat was (upgraded|deactivated)|user is deactivated/i;

/**
 * Clasificación por defecto de un rechazo definitivo de Telegram.
 *
 * Sólo es definitivo un HTTP 400 atribuible al contenido del mensaje. Los
 * errores de canal/configuración (401, 403, 404, "chat not found", bot
 * expulsado) y cualquier error desconocido se tratan como transitorios: es
 * preferible reintentar una alerta a descartarla.
 */
export function isDefinitiveTelegramRejection(err: unknown): boolean {
  const details = describeTelegramSendError(err);
  if (details.kind !== "api" || details.retryable) return false;
  const status = details.apiErrorCode ?? details.statusCode;
  if (status !== 400) return false;
  const text = `${details.apiDescription ?? ""} ${details.summary ?? ""}`;
  return !CHANNEL_LEVEL_REJECTION.test(text);
}

export async function deliverPendingWithinLimit(
  pending: readonly PendingNewTenderAlert[],
  maxPerCycle: number,
  send: (alert: PendingNewTenderAlert) => Promise<number | null>,
  options: DeliveryOptions,
): Promise<DeliveryOutcome> {
  let sent = 0;
  // Mensajes nuevos llevados a Telegram en este ciclo: es lo que limita el cupo.
  let delivered = 0;
  let failed = 0;
  let unrecorded = 0;
  let attempts = 0;
  // Techo de trabajo por ciclo: impide que una caída total de Telegram
  // provoque cientos de reintentos en un mismo ciclo.
  const maxAttempts = Math.max(1, maxPerCycle * 2);

  for (const alert of pending) {
    // Ya entregada en un ciclo anterior: sólo se reintenta el asiento. No
    // consume presupuesto de Telegram porque no se envía nada.
    const deliveredMessageId = deliveredAwaitingRecord.get(alert.id);
    if (deliveredMessageId !== undefined) {
      if (await tryRecordDelivery(options, alert, deliveredMessageId)) sent++;
      else unrecorded++;
      continue;
    }

    if (delivered >= maxPerCycle || attempts >= maxAttempts) continue;
    attempts++;

    let messageId: number | null = null;
    try {
      messageId = await send(alert);
    } catch (err) {
      const definitive = options.isDefinitiveRejection
        ? options.isDefinitiveRejection(err)
        : isDefinitiveTelegramRejection(err);
      if (definitive) {
        failed++;
        log.error(
          { err, alertId: alert.id },
          "Telegram rechazó la alerta de forma definitiva; se marca como no entregable",
        );
        await safeMarkFailed(options, alert, null);
      } else {
        log.warn(
          { err, alertId: alert.id },
          "Fallo transitorio al enviar alerta a Telegram; permanece pendiente",
        );
      }
      continue;
    }

    if (messageId === null) {
      log.warn(
        { alertId: alert.id },
        "Telegram no devolvió identificador de mensaje; la alerta permanece pendiente",
      );
      continue;
    }

    // A partir de aquí el mensaje está en el canal: nunca debe reenviarse.
    delivered++;
    deliveredAwaitingRecord.set(alert.id, messageId);
    if (await tryRecordDelivery(options, alert, messageId)) sent++;
    else unrecorded++;
  }

  return {
    sent,
    failed,
    remaining: Math.max(0, pending.length - sent - failed - unrecorded),
    unrecorded,
  };
}

async function tryRecordDelivery(
  options: DeliveryOptions,
  alert: PendingNewTenderAlert,
  messageId: number,
): Promise<boolean> {
  try {
    await options.markSent(alert, messageId);
    deliveredAwaitingRecord.delete(alert.id);
    return true;
  } catch (err) {
    log.error(
      { err, alertId: alert.id, messageId },
      "Mensaje entregado pero no se pudo asentar en base de datos; se reintentará el asiento sin reenviar",
    );
    return false;
  }
}

async function safeMarkFailed(
  options: DeliveryOptions,
  alert: PendingNewTenderAlert,
  messageId: number | null,
): Promise<void> {
  if (!options.markFailed) return;
  try {
    await options.markFailed(alert, messageId);
  } catch (err) {
    log.error(
      { err, alertId: alert.id },
      "No se pudo marcar la alerta como fallida; podría volver a la cola",
    );
  }
}
