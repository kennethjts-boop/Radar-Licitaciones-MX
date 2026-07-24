import { sendTelegramMessage } from "../../../alerts/telegram.alerts";
import {
  createPendingWatchdogHealthAlert,
  getRecentWatchdogHealthAlerts,
  markWatchdogHealthAlertSent,
} from "../repository";
import {
  EMPTY_WATCHDOG_HEALTH,
  enforceWatchdogVerdictSeverity,
  notifyWatchdogHealthIfNeeded,
  formatWatchdogHealthAlert,
  reconcileWatchdogColdStartHealth,
  relevantCircuit,
  resolveWatchdogHealthDecision,
  sanitizeFailureMessage,
  shouldSendWatchdogHealthAlert,
  transitionWatchdogHealth,
  type WatchdogHealthAlertHistory,
} from "../health";
import type { WatchdogHealthState } from "../types";
import { getSaturationAnalysis } from "../../alerting/saturation";
import { allCircuits, type CircuitSnapshot } from "../../resilience/circuit-breaker";

jest.mock("../../../alerts/telegram.alerts", () => ({
  sendTelegramMessage: jest.fn(),
}));
jest.mock("../repository", () => ({
  createPendingWatchdogHealthAlert: jest.fn(),
  getRecentWatchdogHealthAlerts: jest.fn(),
  markWatchdogHealthAlertFailed: jest.fn(),
  markWatchdogHealthAlertSent: jest.fn(),
}));
jest.mock("../../alerting/saturation", () => ({
  getSaturationAnalysis: jest.fn(),
}));
jest.mock("../../resilience/circuit-breaker", () => ({
  allCircuits: jest.fn(),
}));

const mockedSend = jest.mocked(sendTelegramMessage);
const mockedCreate = jest.mocked(createPendingWatchdogHealthAlert);
const mockedRecent = jest.mocked(getRecentWatchdogHealthAlerts);
const mockedMarkSent = jest.mocked(markWatchdogHealthAlertSent);
const mockedSaturation = jest.mocked(getSaturationAnalysis);
const mockedCircuits = jest.mocked(allCircuits);

function circuit(
  overrides: Partial<CircuitSnapshot> = {},
): CircuitSnapshot {
  return {
    key: "/whitney/sitiopublico/expedientes/:uuid",
    state: "CLOSED",
    consecutiveFailures: 0,
    msUntilRetry: 0,
    reopenedFromHalfOpen: false,
    openCount: 0,
    ...overrides,
  };
}

function critical(overrides: Partial<WatchdogHealthState> = {}): WatchdogHealthState {
  return {
    ...EMPTY_WATCHDOG_HEALTH,
    consecutiveFailures: 10,
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
    stage: "api_responses",
    consecutiveFailures: 10,
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
    mockedCircuits.mockReturnValue([circuit()]);
    mockedSaturation.mockResolvedValue({
      currentHour: 10,
      sampleCount: 0,
      sufficient: false,
      peakHours: [],
      isPeakHour: false,
      isAnomalous: false,
      message: "Sin patrón histórico suficiente.",
    });
  });

  it("mantiene WARN provisional hasta que el veredicto gobierna la severidad", () => {
    let state = EMPTY_WATCHDOG_HEALTH;
    for (let index = 0; index < 10; index++) {
      state = transitionWatchdogHealth(state, { success: false, cause: "NETWORK_INFRA" });
    }
    expect(state).toEqual(expect.objectContaining({
      consecutiveFailures: 10,
      severity: "WARN",
    }));
  });

  it("limita explícitamente a WARN cualquier veredicto ESPERAR", () => {
    expect(enforceWatchdogVerdictSeverity({
      category: "ESPERAR",
      reason: "backoff activo",
      action: "esperar",
      reviewAt: "30 minutos",
      suggestedPauseMinutes: 30,
    }, "CRITICAL")).toBe("WARN");
  });

  it("entrega al veredicto el circuito CLOSED con más fallos", () => {
    const selected = relevantCircuit([
      circuit({ key: "/anexos", consecutiveFailures: 1 }),
      circuit({ key: "/detalle", consecutiveFailures: 3 }),
    ]);
    expect(selected).toMatchObject({
      key: "/detalle",
      state: "CLOSED",
      consecutiveFailures: 3,
    });
  });

  it("un circuito CLOSED y menos de 10 fallos NETWORK_INFRA produce WARN sin CRITICAL", async () => {
    const decision = await resolveWatchdogHealthDecision(critical({
      consecutiveFailures: 4,
      severity: "WARN",
      lastFailureStage: "api_responses",
    }));
    expect(decision.circuit?.state).toBe("CLOSED");
    expect(decision.verdict.category).toBe("ESPERAR");
    expect(decision.health.severity).toBe("WARN");
    const message = await formatWatchdogHealthAlert(decision.health);
    expect(message).toContain("[WARN]");
    expect(message).not.toContain("[CRITICAL]");
  });

  it("eleva a CRITICAL con 10 fallos, circuito OPEN o causa no NETWORK_INFRA", async () => {
    const tenFailures = await resolveWatchdogHealthDecision(critical());
    expect(tenFailures.verdict.category).toBe("PAUSAR");
    expect(tenFailures.health.severity).toBe("CRITICAL");

    mockedCircuits.mockReturnValue([
      circuit({ state: "OPEN", consecutiveFailures: 3, msUntilRetry: 60_000 }),
    ]);
    const open = await resolveWatchdogHealthDecision(critical({
      consecutiveFailures: 3,
      severity: "WARN",
    }));
    expect(open.verdict.category).toBe("PAUSAR");
    expect(open.health.severity).toBe("CRITICAL");

    mockedCircuits.mockReturnValue([circuit()]);
    const application = await resolveWatchdogHealthDecision(critical({
      consecutiveFailures: 1,
      cause: "APPLICATION_ERROR",
      severity: "WARN",
    }));
    expect(application.verdict.category).toBe("INTERVENIR");
    expect(application.health.severity).toBe("CRITICAL");
  });

  it("resetea fallos persistidos en cold start solo si todos los circuitos están CLOSED", () => {
    const persisted = critical({ consecutiveFailures: 6 });
    expect(reconcileWatchdogColdStartHealth(
      persisted,
      [circuit()],
    )).toMatchObject({
      reset: true,
      health: {
        consecutiveFailures: 0,
        cause: null,
        severity: null,
        incidentStartedAt: null,
      },
    });
    expect(reconcileWatchdogColdStartHealth(
      persisted,
      [circuit({ state: "OPEN" })],
    )).toEqual({ reset: false, health: persisted });
  });

  it("colapsa un WARN repetido para la misma tupla durante el cooldown", () => {
    const health: WatchdogHealthState = {
      ...critical({
        consecutiveFailures: 2,
        severity: "WARN",
        lastFailureStage: "api_responses",
      }),
    };
    expect(shouldSendWatchdogHealthAlert({
      health,
      history: [history({
        severity: "WARN",
        consecutiveFailures: 1,
        sentAt: "2026-07-16T05:45:00.000Z",
      })],
      now: new Date("2026-07-16T06:00:00.000Z"),
    })).toBe(false);
  });

  it("permite una tupla distinta y la escalación aunque exista otra alerta reciente", () => {
    expect(shouldSendWatchdogHealthAlert({
      health: critical({ lastFailureStage: "annex_pagination" }),
      history: [history({ sentAt: "2026-07-16T05:45:00.000Z" })],
      now: new Date("2026-07-16T06:00:00.000Z"),
    })).toBe(true);
    expect(shouldSendWatchdogHealthAlert({
      health: critical({ lastFailureStage: "api_responses" }),
      history: [history({
        severity: "WARN",
        sentAt: "2026-07-16T05:45:00.000Z",
      })],
      now: new Date("2026-07-16T06:00:00.000Z"),
    })).toBe(true);
  });

  it("no reenvía una degradación CRITICAL a WARN dentro del cooldown", () => {
    expect(shouldSendWatchdogHealthAlert({
      health: critical({
        severity: "WARN",
        consecutiveFailures: 3,
        lastFailureStage: "api_responses",
      }),
      history: [history({
        severity: "CRITICAL",
        sentAt: "2026-07-16T05:45:00.000Z",
      })],
      now: new Date("2026-07-16T06:00:00.000Z"),
    })).toBe(false);
  });

  it("no usa el cambio de conteo para evadir el cooldown de la misma tupla", () => {
    expect(shouldSendWatchdogHealthAlert({
      health: critical({
        consecutiveFailures: 12,
        lastFailureStage: "api_responses",
      }),
      history: [history({
        consecutiveFailures: 10,
        sentAt: "2026-07-16T05:45:00.000Z",
      })],
      now: new Date("2026-07-16T06:00:00.000Z"),
    })).toBe(false);
    expect(shouldSendWatchdogHealthAlert({
      health: critical({
        consecutiveFailures: 12,
        lastFailureStage: "api_responses",
      }),
      history: [history()],
      now: new Date("2026-07-16T05:30:00.000Z"),
    })).toBe(true);
  });

  it("persiste pending antes de Telegram y confirma el mensaje enviado", async () => {
    await expect(notifyWatchdogHealthIfNeeded(critical())).resolves.toBe(true);
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
      severity: "CRITICAL",
      cause: "NETWORK_INFRA",
    }));
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
      stage: "N/D",
    }));
    expect(mockedSend).toHaveBeenCalledWith(expect.stringContaining("Fallos consecutivos: 10"), "HTML");
    expect(mockedSend).toHaveBeenCalledWith(expect.stringContaining("🎯 VEREDICTO:"), "HTML");
    expect(mockedMarkSent).toHaveBeenCalledWith("alert-1", 42);
    expect(mockedCreate.mock.invocationCallOrder[0]).toBeLessThan(mockedSend.mock.invocationCallOrder[0]);
  });

  it("deduplica desde persistencia por nivel, causa y etapa", async () => {
    const now = new Date();
    mockedRecent.mockResolvedValue([{
      id: "previous",
      alert_type:
        "licitacion_watchdog_health_critical_network_infra_api_responses",
      telegram_message: [
        "🔴 <b>[CRITICAL] Licitación Watchdog</b>",
        "🧩 Etapa: <code>api_responses</code>",
        "📊 Fallos consecutivos: 10",
      ].join("\n"),
      telegram_status: "sent",
      telegram_message_id: 7,
      sent_at: now.toISOString(),
      created_at: now.toISOString(),
    }]);

    await expect(notifyWatchdogHealthIfNeeded(critical({
      lastFailureStage: "api_responses",
    }))).resolves.toBe(false);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
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
