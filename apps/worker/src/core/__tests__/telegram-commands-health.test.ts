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
      category: "DUPLICATE_POLLING_INSTANCE",
      severity: "DEGRADED",
    });
  });

  it("polling_error aislado no alerta ni persiste incidente", async () => {
    const send = jest.fn();
    const result = await recordTelegramPollingFailure(
      pollingError("socket timeout", undefined, "ETIMEDOUT"),
      send,
      new Date("2026-06-10T00:00:00.000Z"),
    );

    expect(result.alerted).toBe(false);
    expect(result.failures).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(mockSetState).not.toHaveBeenCalled();
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
      "No afecta extracción de ComprasMX",
    );
    expect(mockState).toMatchObject({
      telegram_commands_consecutive_failures: 4,
      telegram_polling_ok: false,
      telegram_send_message_ok: true,
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
  });
});
