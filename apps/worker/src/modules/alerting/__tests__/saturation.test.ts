import {
  analyzeSaturation,
  type NetworkFailureHistogram,
} from "../saturation";

function histogram(hours: number[]): NetworkFailureHistogram {
  return {
    startedAt: "2026-07-15T16:00:00.000Z",
    samples: hours.map((hour, index) => ({
      at: new Date(
        Date.UTC(2026, 6, 21, 6 + hour, index % 60),
      ).toISOString(),
      hour,
    })),
  };
}

describe("analyzeSaturation", () => {
  it("no inventa patrón con muestras insuficientes", () => {
    const result = analyzeSaturation({
      histogram: histogram([10, 10, 11]),
      now: new Date("2026-07-22T16:00:00.000Z"),
      windowDays: 7,
      minSamples: 20,
    });
    expect(result).toMatchObject({
      sufficient: false,
      isPeakHour: false,
      isAnomalous: false,
      message: "Sin patrón histórico suficiente.",
    });
  });

  it("no declara patrón aunque haya muestras si aún no cumple siete días", () => {
    const result = analyzeSaturation({
      histogram: {
        ...histogram(Array.from({ length: 20 }, () => 10)),
        startedAt: "2026-07-21T16:00:00.000Z",
      },
      now: new Date("2026-07-22T16:00:00.000Z"),
      windowDays: 7,
      minSamples: 20,
    });
    expect(result.sufficient).toBe(false);
    expect(result.message).toContain("Sin patrón histórico suficiente");
  });

  it("identifica una hora de incidencia máxima", () => {
    const result = analyzeSaturation({
      histogram: histogram([10, 10, 10, 10, 11, 12]),
      now: new Date("2026-07-22T16:30:00.000Z"),
      windowDays: 7,
      minSamples: 5,
    });
    expect(result).toMatchObject({
      sufficient: true,
      peakHours: [10],
      isPeakHour: true,
      isAnomalous: false,
    });
    expect(result.message).toContain("Hora de saturación conocida");
  });

  it("marca como anómalo un fallo fuera de hora pico", () => {
    const result = analyzeSaturation({
      histogram: histogram([10, 10, 10, 10, 11, 12]),
      now: new Date("2026-07-22T17:30:00.000Z"),
      windowDays: 7,
      minSamples: 5,
    });
    expect(result).toMatchObject({
      sufficient: true,
      peakHours: [10],
      isPeakHour: false,
      isAnomalous: true,
    });
    expect(result.message).toContain("anómalo");
  });
});
