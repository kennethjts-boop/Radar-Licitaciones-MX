import { describeTelegramSendError } from "../telegram.alerts";

describe("describeTelegramSendError", () => {
  it("clasifica timeout como retryable", () => {
    const err = new Error("Request timed out while contacting Telegram");
    const details = describeTelegramSendError(err);

    expect(details.kind).toBe("timeout");
    expect(details.retryable).toBe(true);
  });

  it("clasifica error de API de Telegram con status 400 como no retryable", () => {
    const err = Object.assign(new Error("ETELEGRAM: 400 Bad Request"), {
      code: "ETELEGRAM",
      response: {
        statusCode: 400,
        body: {
          error_code: 400,
          description: "Bad Request: chat not found",
        },
      },
    });

    const details = describeTelegramSendError(err);

    expect(details.kind).toBe("api");
    expect(details.retryable).toBe(false);
    expect(details.statusCode).toBe(400);
    expect(details.apiDescription).toContain("chat not found");
  });

  it("clasifica error de API de Telegram con 503 como retryable", () => {
    const err = Object.assign(new Error("ETELEGRAM: 503 Service Unavailable"), {
      code: "ETELEGRAM",
      response: {
        statusCode: 503,
        body: {
          error_code: 503,
          description: "Service Unavailable",
        },
      },
    });

    const details = describeTelegramSendError(err);

    expect(details.kind).toBe("api");
    expect(details.retryable).toBe(true);
  });

  it("extrae detalle útil de AggregateError de red", () => {
    const aggregate = new AggregateError(
      [new Error("connect ETIMEDOUT"), new Error("read ECONNRESET")],
      "EFATAL",
    );

    const details = describeTelegramSendError(aggregate);

    expect(["timeout", "network"]).toContain(details.kind);
    expect(details.summary).toContain("ETIMEDOUT");
    expect(details.retryable).toBe(true);
  });
});
