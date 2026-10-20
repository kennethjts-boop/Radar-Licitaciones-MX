import {
  deliverPendingWithinLimit,
  isDefinitiveTelegramRejection,
  type PendingNewTenderAlert,
} from "../delivery";

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
    expect(first).toEqual({ sent: 25, failed: 0, remaining: 15 });
    const secondPending = pending.filter((alert) => !sentIds.has(alert.id));
    const second = await deliverPendingWithinLimit(secondPending, 25, send, { markSent });

    expect(second).toEqual({ sent: 15, failed: 0, remaining: 0 });
    expect(sentIds.size).toBe(40);
    expect(send).toHaveBeenCalledTimes(40);
    expect(new Set(send.mock.calls.map(([alert]) => alert.id)).size).toBe(40);
  });

  it("no reenvía una alerta cuyo mensaje ya fue entregado pero no se pudo asentar", async () => {
    const pending = buildPending(1);
    const send = jest.fn(async () => 4242);
    const markSent = jest.fn(async () => {
      throw new Error("Supabase no responde");
    });
    const markFailed = jest.fn(async () => {});

    const result = await deliverPendingWithinLimit(pending, 10, send, {
      markSent,
      markFailed,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    // La carta muerta conserva el id del mensaje entregado para que la
    // recuperación manual no lo reenvíe (evita duplicados en el canal).
    expect(markFailed).toHaveBeenCalledWith(pending[0], 4242);
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

    expect(result).toEqual({ sent: 0, failed: 0, remaining: 2 });
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

    expect(result).toEqual({ sent: 0, failed: 1, remaining: 0 });
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

  it("no trata como definitivo un error desconocido", () => {
    expect(isDefinitiveTelegramRejection(new Error("boom"))).toBe(false);
  });
});
