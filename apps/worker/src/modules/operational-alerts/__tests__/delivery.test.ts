import { deliverPendingWithinLimit, type PendingNewTenderAlert } from "../delivery";

describe("límite de entrega de alertas nuevas", () => {
  it("entrega 40 exactamente una vez en dos ciclos de 25", async () => {
    const pending: PendingNewTenderAlert[] = Array.from({ length: 40 }, (_, index) => ({
      id: `alert-${index + 1}`,
      telegramMessage: `Licitación ${index + 1}`,
    }));
    const sentIds = new Set<string>();
    const send = jest.fn(async (alert: PendingNewTenderAlert) => Number(alert.id.slice(6)));
    const markSent = jest.fn(async (alert: PendingNewTenderAlert) => {
      sentIds.add(alert.id);
    });

    const first = await deliverPendingWithinLimit(pending, 25, send, markSent);
    expect(first).toEqual({ sent: 25, remaining: 15 });
    const secondPending = pending.filter((alert) => !sentIds.has(alert.id));
    const second = await deliverPendingWithinLimit(secondPending, 25, send, markSent);

    expect(second).toEqual({ sent: 15, remaining: 0 });
    expect(sentIds.size).toBe(40);
    expect(send).toHaveBeenCalledTimes(40);
    expect(new Set(send.mock.calls.map(([alert]) => alert.id)).size).toBe(40);
  });
});
