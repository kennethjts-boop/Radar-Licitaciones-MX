const mockSetTelegramHealth = jest.fn();
let mockState: Record<string, unknown> | null = null;
const mockSetState = jest.fn(async (_key: string, value: Record<string, unknown>) => {
  mockState = value;
});
const mockGetState = jest.fn(async () => mockState);

jest.mock("../healthcheck", () => ({
  healthTracker: {
    setTelegramHealth: mockSetTelegramHealth,
  },
}));

jest.mock("../system-state", () => ({
  getState: mockGetState,
  setState: mockSetState,
  STATE_KEYS: {
    TELEGRAM_COMMANDS_TELEMETRY: "telegram_commands_telemetry",
  },
}));

import {
  classifyTelegramPollingError,
  getTelegramPollingRetryDelayMs,
  recordTelegramPollingFailure,
  recordTelegramPollingSuccess,
  resetTelegramCommandsHealthForTests,
} from "../telegram-commands-health";

function pollingError(
  message: string,
  statusCode?: number,
  code?: string,
): Error {
  return Object.assign(new Error(message), {
    code,
    response: {
      statusCode,
      body: {
        error_code: statusCode,
        description: message,
      },
    },
  });
}

describe("Telegram commands polling health", () => {
  beforeEach(() => {
    mockState = null;
    jest.clearAllMocks();
    resetTelegramCommandsHealthForTests();
  });

  it("clasifica 409 como posible instancia duplicada", () => {
    expect(
      classifyTelegramPollingError(
        pollingError(
          "Conflict: terminated by other getUpdates request",
          409,
          "ETELEGRAM",
        ),
      ),
    ).toMatchObject({
      origin: "OUR_INFRA",
      kind: "telegram_conflict",
      severity: "DEGRADED",
    });
  });

  it("clasifica errores de red transitorios", () => {
    for (const error of [
      pollingError("socket hang up"),
      pollingError("fetch failed"),
      pollingError("request timeout"),
      pollingError("network timeout", undefined, "ETIMEDOUT"),
      pollingError("connection reset", undefined, "ECONNRESET"),
      pollingError("dns retry", undefined, "EAI_AGAIN"),
    ]) {
      expect(classifyTelegramPollingError(error)).toMatchObject({
        kind: "transient_network",
        severity: "WARN",
      });
    }
  });

  it("clasifica auth y unknown", () => {
    expect(classifyTelegramPollingError(
      pollingError("Forbidden: bot was blocked by the user", 403, "ETELEGRAM"),
    )).toMatchObject({
      kind: "telegram_auth",
      severity: "DEGRADED",
    });

    expect(classifyTelegramPollingError(new Error("unexpected parser crash"))).toMatchObject({
      kind: "unknown",
      severity: "WARN",
    });
  });

  it("calcula backoff con jitter acotado", () => {
    process.env.TELEGRAM_POLLING_RETRY_INITIAL_DELAY_MS = "1000";
    process.env.TELEGRAM_POLLING_RETRY_BACKOFF_MULTIPLIER = "2";
    process.env.TELEGRAM_POLLING_RETRY_MAX_DELAY_MS = "10000";
    process.env.TELEGRAM_POLLING_RETRY_JITTER_RATIO = "0.25";

    expect(getTelegramPollingRetryDelayMs(1, () => 0.5)).toBe(1000);
    expect(getTelegramPollingRetryDelayMs(3, () => 1)).toBe(5000);

    delete process.env.TELEGRAM_POLLING_RETRY_INITIAL_DELAY_MS;
    delete process.env.TELEGRAM_POLLING_RETRY_BACKOFF_MULTIPLIER;
    delete process.env.TELEGRAM_POLLING_RETRY_MAX_DELAY_MS;
    delete process.env.TELEGRAM_POLLING_RETRY_JITTER_RATIO;
  });

  it("polling_error aislado registra telemetría pero no alerta ni contamina health global", async () => {
    const send = jest.fn();
    const result = await recordTelegramPollingFailure(
      pollingError("socket timeout", undefined, "ETIMEDOUT"),
      send,
      new Date("2026-06-10T00:00:00.000Z"),
    );

    expect(result.alerted).toBe(false);
    expect(result.failures).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(mockState).toMatchObject({
      telegram_commands_consecutive_failures: 1,
      telegram_polling_ok: false,
      last_telegram_commands_error_reason: "transient_network",
    });
    expect(mockSetTelegramHealth).not.toHaveBeenCalled();
  });

  it("tercer error en diez minutos envía alerta amarilla una vez", async () => {
    const send = jest.fn().mockResolvedValue({ message_id: 1 });
    const error = pollingError("socket timeout", undefined, "ETIMEDOUT");

    await recordTelegramPollingFailure(
      error,
      send,
      new Date("2026-06-10T00:00:00.000Z"),
    );
    await recordTelegramPollingFailure(
      error,
      send,
      new Date("2026-06-10T00:01:00.000Z"),
    );
    const third = await recordTelegramPollingFailure(
      error,
      send,
      new Date("2026-06-10T00:02:00.000Z"),
    );
    await recordTelegramPollingFailure(
      error,
      send,
      new Date("2026-06-10T00:03:00.000Z"),
    );

    expect(third.alerted).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain(
      "[DEGRADADO] Telegram commands",
    );
    expect(send.mock.calls[0][0]).toContain(
      "No afecta ComprasMX ni matches",
    );
    expect(mockState).toMatchObject({
      telegram_commands_consecutive_failures: 4,
      telegram_polling_ok: false,
      telegram_send_message_ok: true,
      last_telegram_commands_error_reason: "transient_network",
    });
    expect(mockSetTelegramHealth).not.toHaveBeenCalledWith("down");
  });

  it("conflictos duplicados se deduplican durante treinta minutos", async () => {
    const send = jest.fn().mockResolvedValue({ message_id: 1 });
    const conflict = pollingError(
      "Conflict: terminated by other getUpdates request",
      409,
      "ETELEGRAM",
    );

    await recordTelegramPollingFailure(
      conflict,
      send,
      new Date("2026-06-10T00:00:00.000Z"),
    );
    await recordTelegramPollingFailure(
      conflict,
      send,
      new Date("2026-06-10T00:00:30.000Z"),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("🎯 VEREDICTO: INTERVENIR");
    expect(send.mock.calls[0][0]).toContain("réplicas en Railway");
    expect(send.mock.calls[0][0]).toContain("🎮 COMANDOS");
  });

  it("sendMessage OK con polling degradado no marca Telegram global DOWN", async () => {
    const send = jest.fn().mockResolvedValue({ message_id: 1 });
    const conflict = pollingError(
      "Conflict: another bot instance",
      409,
      "ETELEGRAM",
    );

    await recordTelegramPollingFailure(
      conflict,
      send,
      new Date("2026-06-10T00:00:00.000Z"),
    );

    expect(mockSetTelegramHealth).toHaveBeenCalledWith("ok");
    expect(mockSetTelegramHealth).not.toHaveBeenCalledWith("down");
  });

  it("envía una sola recuperación después de un incidente alertado", async () => {
    const send = jest.fn().mockResolvedValue({ message_id: 1 });
    const conflict = pollingError(
      "Conflict: another bot instance",
      409,
      "ETELEGRAM",
    );
    await recordTelegramPollingFailure(
      conflict,
      send,
      new Date("2026-06-10T00:00:00.000Z"),
    );
    send.mockClear();

    await recordTelegramPollingSuccess(
      send,
      new Date("2026-06-10T00:05:00.000Z"),
    );
    await recordTelegramPollingSuccess(
      send,
      new Date("2026-06-10T00:06:00.000Z"),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain(
      "Telegram commands recuperado",
    );
    expect(send.mock.calls[0][0]).not.toContain("VEREDICTO");
  });
});
