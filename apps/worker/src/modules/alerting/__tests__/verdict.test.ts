import {
  appendVerdict,
  determineVerdict,
  formatPausedInformation,
  formatVerdictBlock,
} from "../verdict";
import type { CircuitSnapshot } from "../../resilience/circuit-breaker";

function circuit(
  overrides: Partial<CircuitSnapshot> = {},
): CircuitSnapshot {
  return {
    key: "/endpoint",
    state: "CLOSED",
    consecutiveFailures: 0,
    msUntilRetry: 0,
    reopenedFromHalfOpen: false,
    openCount: 0,
    ...overrides,
  };
}

describe("determineVerdict", () => {
  it("cubre PAUSAR con minutos exactos para circuito watchdog abierto", () => {
    const verdict = determineVerdict({
      source: "watchdog",
      circuit: circuit({ state: "OPEN", msUntilRetry: 17 * 60_000 }),
    });
    expect(verdict).toMatchObject({
      category: "PAUSAR",
      suggestedPauseMinutes: 17,
    });
    expect(verdict.reason).toContain("17 minutos");
  });

  it("pausa watchdog tras diez fallos aunque el circuito siga CLOSED", () => {
    expect(determineVerdict({
      source: "watchdog",
      cause: "NETWORK_INFRA",
      consecutiveFailures: 10,
      circuit: circuit({ state: "CLOSED", consecutiveFailures: 2 }),
    }).category).toBe("PAUSAR");
  });

  it("interviene ante cualquier causa watchdog distinta de NETWORK_INFRA", () => {
    expect(determineVerdict({
      source: "watchdog",
      cause: "APPLICATION_ERROR",
      consecutiveFailures: 1,
      circuit: circuit(),
    }).category).toBe("INTERVENIR");
  });

  it("cubre VIGILAR por dos fallos consecutivos", () => {
    expect(determineVerdict({
      source: "watchdog",
      consecutiveFailures: 2,
    }).category).toBe("VIGILAR");
  });

  it("cubre PAUSAR por reapertura tras HALF_OPEN", () => {
    const verdict = determineVerdict({
      source: "watchdog",
      consecutiveFailures: 3,
      circuit: circuit({
        state: "OPEN",
        reopenedFromHalfOpen: true,
        openCount: 2,
      }),
      defaultPauseMinutes: 60,
    });
    expect(verdict.category).toBe("PAUSAR");
    expect(verdict.action).toContain("/pausa 60");
  });

  it("cubre INTERVENIR para Telegram 409", () => {
    const verdict = determineVerdict({
      source: "telegram_polling",
      telegramConflict: true,
      httpStatus: 409,
    });
    expect(verdict.category).toBe("INTERVENIR");
    expect(verdict.action).toContain("réplicas en Railway");
  });

  it("mantiene ESPERAR con circuito CLOSED y menos de diez fallos aun en hora pico", () => {
    expect(determineVerdict({
      source: "watchdog",
      consecutiveFailures: 3,
      saturation: {
        currentHour: 10,
        sampleCount: 20,
        sufficient: true,
        peakHours: [10],
        isPeakHour: true,
        isAnomalous: false,
        message: "Hora de saturación conocida del portal.",
      },
      circuit: circuit({ state: "CLOSED", consecutiveFailures: 2 }),
    }).category).toBe("ESPERAR");
  });

  it("vigila un fallo fuera de hora pico por ser anómalo", () => {
    const verdict = determineVerdict({
      source: "watchdog",
      consecutiveFailures: 1,
      saturation: {
        currentHour: 12,
        sampleCount: 20,
        sufficient: true,
        peakHours: [10],
        isPeakHour: false,
        isAnomalous: true,
        message: "Fallo anómalo.",
      },
    });
    expect(verdict.category).toBe("VIGILAR");
    expect(verdict.reason).toContain("anómalo");
  });
});

describe("bloques de comandos", () => {
  const categories = [
    determineVerdict({ source: "watchdog" }),
    determineVerdict({ source: "watchdog", consecutiveFailures: 2 }),
    determineVerdict({
      source: "watchdog",
      circuit: circuit({ state: "OPEN", reopenedFromHalfOpen: true }),
    }),
    determineVerdict({ source: "telegram_polling", telegramConflict: true }),
  ];

  it.each(categories)(
    "añade comandos al final para $category",
    (verdict) => {
      const message = appendVerdict("ALARMA", verdict, true);
      expect(message.startsWith("ALARMA")).toBe(true);
      expect(message).toContain(`🎯 VEREDICTO: ${verdict.category}`);
      expect(message).toContain("🎮 COMANDOS");
      expect(message.indexOf("🎮 COMANDOS")).toBeGreaterThan(
        message.indexOf("🎯 VEREDICTO"),
      );
    },
  );

  it("adapta PAUSAR, ESPERAR/VIGILAR e INTERVENIR", () => {
    expect(formatVerdictBlock(categories[2], true)).toContain(
      "/pausa watchdog",
    );
    expect(formatVerdictBlock(categories[0], true)).toContain("/estado");
    expect(formatVerdictBlock(categories[1], true)).toContain("/pausa 30");
    expect(formatVerdictBlock(categories[3], true)).toContain(
      "mientras resuelves",
    );
  });

  it("no sugiere escritura cuando no hay administradores configurados", () => {
    const block = formatVerdictBlock(categories[2], false);
    expect(block).toContain("comandos de escritura están deshabilitados");
    expect(block).not.toContain("/pausa 60");
    expect(block).not.toContain("/reanudar");
  });

  it("un radar pausado es informativo y no incluye veredicto", () => {
    const message = formatPausedInformation({
      scope: "watchdog",
      resumeAt: "2026-07-23T18:00:00.000Z",
      adminCommandsAreEnabled: true,
    });
    expect(message).toContain("Radar pausado manualmente");
    expect(message).toContain("/reanudar");
    expect(message).not.toContain("VEREDICTO");
  });
});
