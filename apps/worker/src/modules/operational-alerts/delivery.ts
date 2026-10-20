/**
 * DELIVERY — entrega de alertas nuevas pendientes de Telegram.
 *
 * Requisitos operativos que este módulo garantiza:
 *
 * 1. Observabilidad: todo fallo de envío queda registrado con el identificador
 *    de la alerta. Antes el `catch` era silencioso y una alerta que Telegram
 *    rechazaba una y otra vez no dejaba ninguna rastro visible.
 * 2. Sin duplicados: si el mensaje YA llegó a Telegram y lo que falla es el
 *    asiento en base de datos, la alerta no debe reenviarse. Un duplicado en
 *    el canal del operador es peor que perder la traza interna.
 * 3. Sin reintentos infinitos: una rechazo definitivo de la API de Telegram
 *    (payload inválido, chat bloqueado) no se va a resolver reintentando. Esas
 *    alertas se marcan como `failed` (carta muerta) y quedan visibles para
 *    recuperación manual; los fallos transitorios (red, timeout, 5xx, 429)
 *    siguen en `pending` y se reintentan en el siguiente ciclo.
 */
import { createModuleLogger } from "../../core/logger";
import { describeTelegramSendError } from "../../alerts/telegram.alerts";

const log = createModuleLogger("operational-alerts:delivery");

export interface PendingNewTenderAlert {
  id: string;
  telegramMessage: string;
}

export interface DeliveryOutcome {
  /** Alertas entregadas y asentadas correctamente. */
  sent: number;
  /** Alertas marcadas como carta muerta (rechazo definitivo). */
  failed: number;
  /** Alertas que siguen pendientes para el siguiente ciclo. */
  remaining: number;
}

export interface DeliveryOptions {
  /** Asienta la entrega (puede fallar si la base de datos no responde). */
  markSent: (alert: PendingNewTenderAlert, messageId: number) => Promise<void>;
  /** Marca la alerta como carta muerta. */
  markFailed?: (alert: PendingNewTenderAlert, messageId: number | null) => Promise<void>;
  /** Clasifica si el error es un rechazo definitivo (no reintentable). */
  isDefinitiveRejection?: (err: unknown) => boolean;
}

/**
 * Clasificación por defecto de un rechazo definitivo de Telegram.
 *
 * Sólo se consideran definitivos los rechazos explícitos de la API (4xx sin
 * reintento). Cualquier error desconocido se trata como transitorio: es
 * preferible reintentar una alerta a perder una oportunidad.
 */
export function isDefinitiveTelegramRejection(err: unknown): boolean {
  const details = describeTelegramSendError(err);
  return details.kind === "api" && !details.retryable;
}

export async function deliverPendingWithinLimit(
  pending: readonly PendingNewTenderAlert[],
  maxPerCycle: number,
  send: (alert: PendingNewTenderAlert) => Promise<number | null>,
  options: DeliveryOptions,
): Promise<DeliveryOutcome> {
  let sent = 0;
  let failed = 0;
  let attempts = 0;
  // Techo de trabajo por ciclo: impide que una caída total de Telegram
  // provoque cientos de reintentos en un mismo ciclo.
  const maxAttempts = Math.max(1, maxPerCycle * 2);

  for (const alert of pending) {
    if (sent >= maxPerCycle || attempts >= maxAttempts) break;
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

    try {
      await options.markSent(alert, messageId);
      sent++;
    } catch (err) {
      // El mensaje ya está entregado. Reenviarlo duplicaría la alerta en el
      // canal del operador, así que se marca como fallida conservando el
      // identificador del mensaje entregado.
      log.error(
        { err, alertId: alert.id, messageId },
        "Mensaje entregado pero no se pudo asentar en base de datos; no se reenviará",
      );
      failed++;
      await safeMarkFailed(options, alert, messageId);
    }
  }

  return {
    sent,
    failed,
    remaining: Math.max(0, pending.length - sent - failed),
  };
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
