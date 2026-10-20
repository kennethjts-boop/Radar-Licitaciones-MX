import {
  deliverPendingWithinLimit,
  isDefinitiveTelegramRejection,
  isDeliveredAwaitingRecord,
  resetDeliveryLedgerForTests,
  type PendingNewTenderAlert,
} from "../delivery";

beforeEach(() => resetDeliveryLedgerForTests());

function buildPending(count: number): PendingNewTenderAlert[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `alert-${index + 1}`,
    telegramMessage: `Licitación ${index + 1}`,
  }));
}

describe("límite de entrega de alertas nuevas", () => {
  it("entrega 40 exactamente una vez en dos ciclos de 25", async () => {
    const pending = buildPending(40);
    const sentIds = new Set<string>();
    const send = jest.fn(async (alert: PendingNewTenderAlert) => Number(alert.id.slice(6)));
    const markSent = jest.fn(async (alert: PendingNewTenderAlert) => {
      sentIds.add(alert.id);
    });

    const first = await deliverPendingWithinLimit(pending, 25, send, { markSent });
    expect(first).toEqual({ sent: 25, failed: 0, remaining: 15, unrecorded: 0 });
    const secondPending = pending.filter((alert) => !sentIds.has(alert.id));
    const second = await deliverPendingWithinLimit(secondPending, 25, send, { markSent });

    expect(second).toEqual({ sent: 15, failed: 0, remaining: 0, unrecorded: 0 });
    expect(sentIds.size).toBe(40);
    expect(send).toHaveBeenCalledTimes(40);
    expect(new Set(send.mock.calls.map(([alert]) => alert.id)).size).toBe(40);
  });

  it("entregada sin asiento: no se reenvía, no se marca failed y se asienta al recuperarse la BD", async () => {
    const pending = buildPending(1);
    const send = jest.fn(async () => 4242);
    let dbDown = true;
    const markSent = jest.fn(async () => {
      if (dbDown) throw new Error("Supabase no responde");
    });
    const markFailed = jest.fn(async () => {
      throw new Error("Supabase no responde");
    });

    const first = await deliverPendingWithinLimit(pending, 10, send, { markSent, markFailed });
    expect(first).toEqual({ sent: 0, failed: 0, remaining: 0, unrecorded: 1 });
    expect(isDeliveredAwaitingRecord("alert-1")).toBe(true);

    // Siguiente ciclo, BD aún caída: la alerta sigue en pending pero no se reenvía.
    const second = await deliverPendingWithinLimit(pending, 10, send, { markSent, markFailed });
    expect(second.unrecorded).toBe(1);

    // BD recuperada: se asienta con el message_id original, sin nuevo envío.
    dbDown = false;
    const third = await deliverPendingWithinLimit(pending, 10, send, { markSent, markFailed });
    expect(third).toEqual({ sent: 1, failed: 0, remaining: 0, unrecorded: 0 });

    expect(send).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
    expect(markSent).toHaveBeenLastCalledWith(pending[0], 4242);
    expect(isDeliveredAwaitingRecord("alert-1")).toBe(false);
  });

  it("el reintento de asiento no consume el presupuesto de Telegram", async () => {
    const pending = buildPending(3);
    let failOnce = true;
    const send = jest.fn(async (alert: PendingNewTenderAlert) => Number(alert.id.slice(6)));
    const markSent = jest.fn(async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error("Supabase no responde");
      }
    });

    await deliverPendingWithinLimit(pending.slice(0, 1), 1, send, { markSent });
    const next = await deliverPendingWithinLimit(pending, 1, send, { markSent });

    // alert-1 se asienta sin reenviar y alert-2 sale dentro del límite de 1.
    expect(next.sent).toBe(2);
    expect(send.mock.calls.map(([alert]) => alert.id)).toEqual(["alert-1", "alert-2"]);
  });

  it("deja en pending los fallos transitorios y los registra", async () => {
    const pending = buildPending(2);
    const send = jest.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const markSent = jest.fn(async () => {});
    const markFailed = jest.fn(async () => {});

    const result = await deliverPendingWithinLimit(pending, 10, send, {
      markSent,
      markFailed,
    });

    expect(result).toEqual({ sent: 0, failed: 0, remaining: 2, unrecorded: 0 });
    expect(markFailed).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("marca como carta muerta un rechazo definitivo de la API de Telegram", async () => {
    const pending = buildPending(1);
    const apiError = Object.assign(new Error("Bad Request: can't parse entities"), {
      response: { statusCode: 400, body: { error_code: 400, description: "can't parse entities" } },
    });
    const send = jest.fn(async () => {
      throw apiError;
    });
    const markFailed = jest.fn(async () => {});

    const result = await deliverPendingWithinLimit(pending, 10, send, {
      markSent: async () => {},
      markFailed,
    });

    expect(result).toEqual({ sent: 0, failed: 1, remaining: 0, unrecorded: 0 });
    expect(markFailed).toHaveBeenCalledWith(pending[0], null);
  });

  it("acota el trabajo por ciclo cuando todos los envíos fallan", async () => {
    const pending = buildPending(50);
    const send = jest.fn(async () => {
      throw new Error("ETIMEDOUT");
    });

    const result = await deliverPendingWithinLimit(pending, 10, send, {
      markSent: async () => {},
    });

    // 10 enviados + 10 reintentos como máximo (2x el presupuesto).
    expect(send).toHaveBeenCalledTimes(20);
    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(50);
  });
});

describe("clasificación de rechazos de Telegram", () => {
  it("trata como definitivo un 400 de la API", () => {
    const err = Object.assign(new Error("Bad Request"), {
      response: { statusCode: 400, body: { error_code: 400 } },
    });
    expect(isDefinitiveTelegramRejection(err)).toBe(true);
  });

  it("no trata como definitivo un 429 ni un 500", () => {
    const tooMany = Object.assign(new Error("Too Many Requests"), {
      response: { statusCode: 429, body: { error_code: 429 } },
    });
    const serverError = Object.assign(new Error("Bad Gateway"), {
      response: { statusCode: 502, body: { error_code: 502 } },
    });
    expect(isDefinitiveTelegramRejection(tooMany)).toBe(false);
    expect(isDefinitiveTelegramRejection(serverError)).toBe(false);
  });

  it("no trata como definitivo un error del canal (token, bot expulsado, chat inexistente)", () => {
    const unauthorized = Object.assign(new Error("Unauthorized"), {
      response: { statusCode: 401, body: { error_code: 401, description: "Unauthorized" } },
    });
    const kicked = Object.assign(new Error("Forbidden"), {
      response: { statusCode: 403, body: { error_code: 403, description: "Forbidden: bot was kicked from the supergroup chat" } },
    });
    const chatNotFound = Object.assign(new Error("Bad Request"), {
      response: { statusCode: 400, body: { error_code: 400, description: "Bad Request: chat not found" } },
    });
    expect(isDefinitiveTelegramRejection(unauthorized)).toBe(false);
    expect(isDefinitiveTelegramRejection(kicked)).toBe(false);
    expect(isDefinitiveTelegramRejection(chatNotFound)).toBe(false);
  });

  it("no trata como definitivo un error desconocido", () => {
    expect(isDefinitiveTelegramRejection(new Error("boom"))).toBe(false);
  });
});
