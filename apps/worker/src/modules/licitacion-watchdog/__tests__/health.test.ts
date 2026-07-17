import { sendTelegramMessage } from "../../../alerts/telegram.alerts";
import {
  createPendingWatchdogHealthAlert,
  getRecentWatchdogHealthAlerts,
  markWatchdogHealthAlertSent,
} from "../repository";
import {
  EMPTY_WATCHDOG_HEALTH,
  notifyWatchdogHealthIfNeeded,
  formatWatchdogHealthAlert,
  sanitizeFailureMessage,
  shouldSendWatchdogHealthAlert,
  transitionWatchdogHealth,
  type WatchdogHealthAlertHistory,
} from "../health";
import type { WatchdogHealthState } from "../types";

jest.mock("../../../alerts/telegram.alerts", () => ({
  sendTelegramMessage: jest.fn(),
}));
jest.mock("../repository", () => ({
  createPendingWatchdogHealthAlert: jest.fn(),
  getRecentWatchdogHealthAlerts: jest.fn(),
  markWatchdogHealthAlertFailed: jest.fn(),
  markWatchdogHealthAlertSent: jest.fn(),
}));

const mockedSend = jest.mocked(sendTelegramMessage);
const mockedCreate = jest.mocked(createPendingWatchdogHealthAlert);
const mockedRecent = jest.mocked(getRecentWatchdogHealthAlerts);
const mockedMarkSent = jest.mocked(markWatchdogHealthAlertSent);

function critical(overrides: Partial<WatchdogHealthState> = {}): WatchdogHealthState {
  return {
    ...EMPTY_WATCHDOG_HEALTH,
    consecutiveFailures: 4,
    cause: "NETWORK_INFRA",
    severity: "CRITICAL",
    incidentStartedAt: "2026-07-16T04:00:00.000Z",
    lastFailureAt: "2026-07-16T05:00:00.000Z",
    ...overrides,
  };
}

function history(overrides: Partial<WatchdogHealthAlertHistory> = {}): WatchdogHealthAlertHistory {
  return {
    severity: "CRITICAL",
    cause: "NETWORK_INFRA",
    consecutiveFailures: 4,
    sentAt: "2026-07-16T05:00:00.000Z",
    ...overrides,
  };
}

describe("salud y cooldown persistente watchdog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRecent.mockResolvedValue([]);
    mockedCreate.mockResolvedValue("alert-1");
    mockedSend.mockResolvedValue(42);
    mockedMarkSent.mockResolvedValue(undefined);
  });

  it("eleva a CRITICAL exactamente en el cuarto fallo consecutivo", () => {
    let state = EMPTY_WATCHDOG_HEALTH;
    for (let index = 0; index < 3; index++) {
      state = transitionWatchdogHealth(state, { success: false, cause: "NETWORK_INFRA" });
    }
    expect(state.severity).toBe("DEGRADED");
    state = transitionWatchdogHealth(state, { success: false, cause: "NETWORK_INFRA" });
    expect(state).toEqual(expect.objectContaining({ consecutiveFailures: 4, severity: "CRITICAL" }));
  });

  it("colapsa un DEGRADED repetido por la misma causa durante el incidente", () => {
    const health: WatchdogHealthState = {
      ...critical({ consecutiveFailures: 2, severity: "DEGRADED" }),
    };
    expect(shouldSendWatchdogHealthAlert({
      health,
      history: [history({ severity: "DEGRADED", consecutiveFailures: 1 })],
      now: new Date("2026-07-16T06:00:00.000Z"),
    })).toBe(false);
  });

  it("aplica cooldown de 30 minutos por severidad aunque cambie la causa", () => {
    expect(shouldSendWatchdogHealthAlert({
      health: critical(),
      history: [history({ cause: "SITE_STRUCTURE", sentAt: "2026-07-16T05:45:00.000Z" })],
      now: new Date("2026-07-16T06:00:00.000Z"),
    })).toBe(false);
  });

  it("realerta CRITICAL tras cooldown si cambia el conteo", () => {
    expect(shouldSendWatchdogHealthAlert({
      health: critical({ consecutiveFailures: 6 }),
      history: [history({ consecutiveFailures: 4 })],
      now: new Date("2026-07-16T05:31:00.000Z"),
    })).toBe(true);
  });

  it("realerta CRITICAL con conteo igual solo después de más de 2 horas", () => {
    const health = critical();
    expect(shouldSendWatchdogHealthAlert({
      health,
      history: [history()],
      now: new Date("2026-07-16T07:00:00.000Z"),
    })).toBe(false);
    expect(shouldSendWatchdogHealthAlert({
      health,
      history: [history()],
      now: new Date("2026-07-16T07:00:00.001Z"),
    })).toBe(true);
  });

  it("persiste pending antes de Telegram y confirma el mensaje enviado", async () => {
    await expect(notifyWatchdogHealthIfNeeded(critical())).resolves.toBe(true);
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
      severity: "CRITICAL",
      cause: "NETWORK_INFRA",
    }));
    expect(mockedSend).toHaveBeenCalledWith(expect.stringContaining("Fallos consecutivos: 4"), "HTML");
    expect(mockedMarkSent).toHaveBeenCalledWith("alert-1", 42);
    expect(mockedCreate.mock.invocationCallOrder[0]).toBeLessThan(mockedSend.mock.invocationCallOrder[0]);
  });

  it("no envía si no puede comprobar el cooldown persistido", async () => {
    mockedRecent.mockRejectedValue(new Error("alerts no disponible"));
    await expect(notifyWatchdogHealthIfNeeded(critical())).resolves.toBe(false);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("incluye etapa, tipo y mensaje sanitizado sin secretos", () => {
    const health = transitionWatchdogHealth(EMPTY_WATCHDOG_HEALTH, {
      success: false,
      cause: "SITE_STRUCTURE",
      stage: "annex_pagination",
      errorType: "TypeError<script>",
      message: "HTTP 401 https://api.example/x?token=secreto Authorization=abc\nfalló",
    });
    const alert = formatWatchdogHealthAlert(health);

    expect(alert).toContain("annex_pagination");
    expect(alert).toContain("TypeError_script_");
    expect(alert).toContain("?…");
    expect(alert).not.toContain("secreto");
    expect(alert).not.toContain("Authorization=abc");
  });

  it("limita mensajes de fallo para Telegram", () => {
    expect(sanitizeFailureMessage("x".repeat(500))).toHaveLength(221);
  });
});
