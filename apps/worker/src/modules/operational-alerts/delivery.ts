export interface PendingNewTenderAlert {
  id: string;
  telegramMessage: string;
}

export async function deliverPendingWithinLimit(
  pending: readonly PendingNewTenderAlert[],
  maxPerCycle: number,
  send: (alert: PendingNewTenderAlert) => Promise<number | null>,
  markSent: (alert: PendingNewTenderAlert, messageId: number) => Promise<void>,
): Promise<{ sent: number; remaining: number }> {
  let sent = 0;
  for (const alert of pending) {
    if (sent >= maxPerCycle) break;
    try {
      const messageId = await send(alert);
      if (messageId === null) continue;
      await markSent(alert, messageId);
      sent++;
    } catch {
      // Permanece pending para reintento en el siguiente ciclo.
    }
  }
  return { sent, remaining: Math.max(0, pending.length - sent) };
}
