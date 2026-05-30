import { isCriticalCollectFailure } from "../scheduler";
import type { CollectJobResult } from "../collect.job";

function collectResult(overrides: Partial<CollectJobResult> = {}): CollectJobResult {
  return {
    status: "success",
    errorMessage: null,
    durationMs: 1_000,
    itemsSeen: 10,
    itemsCreated: 0,
    itemsUpdated: 0,
    totalMatches: 0,
    pagesScanned: 5,
    stopReason: "completed",
    ...overrides,
  };
}

describe("scheduler collect failure classification", () => {
  it("marca timeouts sin filas como fallo crítico de ComprasMX", () => {
    expect(
      isCriticalCollectFailure(
        collectResult({
          status: "error",
          errorMessage: "Timeout en operación: comprasmx-collection (1500000ms)",
          itemsSeen: 0,
          pagesScanned: 0,
          stopReason: "Timeout en operación: comprasmx-collection (1500000ms)",
        }),
      ),
    ).toBe(true);
  });

  it("no marca errores parciales como fallo crítico", () => {
    expect(
      isCriticalCollectFailure(
        collectResult({
          status: "error",
          errorMessage: "Sin datos API para: LA-001",
          itemsSeen: 12,
          pagesScanned: 5,
          stopReason: "completed",
        }),
      ),
    ).toBe(false);
  });

  it("ignora ciclos saltados por lock", () => {
    expect(
      isCriticalCollectFailure(
        collectResult({
          status: "skipped",
          reason: "collect-job lock active",
          itemsSeen: 0,
          pagesScanned: 0,
          stopReason: "collect-job lock active",
        }),
      ),
    ).toBe(false);
  });
});
