import {
  isCriticalCollectFailure,
  recordCollectResultForCircuitBreaker,
  resetComprasMxIncidentStateForTests,
} from "../scheduler";
import {
  buildCollectRunPersistenceStatus,
  type CollectJobResult,
} from "../collect.job";

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
  beforeEach(() => {
    resetComprasMxIncidentStateForTests();
  });

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

  it("no marca ComprasMX temporalmente no disponible como fallo crítico", () => {
    expect(
      isCriticalCollectFailure(
        collectResult({
          status: "source_unavailable",
          errorMessage: null,
          itemsSeen: 0,
          pagesScanned: 0,
          stopReason: "source_unavailable — ComprasMX temporalmente no disponible",
        }),
      ),
    ).toBe(false);
  });

  it("no marca una falla parcial de extracción como fallo crítico", () => {
    expect(
      isCriticalCollectFailure(
        collectResult({
          status: "site_accessible_extraction_failed",
          itemsSeen: 0,
          pagesScanned: 0,
          stopReason: "site_accessible_extraction_failed",
        }),
      ),
    ).toBe(false);
  });

  it("mantiene vivo el scheduler cuando ComprasMX está degradado por 401", () => {
    const degraded = collectResult({
      status: "degraded",
      itemsSeen: 0,
      pagesScanned: 0,
      stopReason: "COMPRASMX_TRANSIENT_AUTH_401",
    });

    expect(isCriticalCollectFailure(degraded)).toBe(false);
    expect(recordCollectResultForCircuitBreaker(degraded)).toBeNull();
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

describe("scheduler ComprasMX incident alerts", () => {
  beforeEach(() => {
    resetComprasMxIncidentStateForTests();
  });

  it("no manda alertas inmediatas por fallos parciales de extracción", () => {
    const failure = collectResult({
      status: "site_accessible_extraction_failed",
      itemsSeen: 0,
      pagesScanned: 0,
    });

    expect(recordCollectResultForCircuitBreaker(failure)).toBeNull();
    expect(recordCollectResultForCircuitBreaker(failure)).toBeNull();
  });

  it("no trata empty_result como error crítico ni abre un incidente", () => {
    const empty = collectResult({
      status: "empty_result",
      itemsSeen: 0,
      pagesScanned: 1,
      stopReason: "empty_result",
    });

    expect(isCriticalCollectFailure(empty)).toBe(false);
    expect(recordCollectResultForCircuitBreaker(empty)).toBeNull();
  });

  it("delega la recuperación a la telemetría persistente del collect job", () => {
    const failure = collectResult({
      status: "site_accessible_extraction_failed",
      itemsSeen: 0,
      pagesScanned: 0,
    });
    const recovered = collectResult({
      status: "success",
      itemsSeen: 12,
      pagesScanned: 1,
    });

    recordCollectResultForCircuitBreaker(failure);
    expect(recordCollectResultForCircuitBreaker(recovered)).toBeNull();
    expect(recordCollectResultForCircuitBreaker(recovered)).toBeNull();
  });

  it("no duplica alertas al alternar fallo y recuperación", () => {
    const failure = collectResult({
      status: "site_accessible_extraction_failed",
      itemsSeen: 0,
      pagesScanned: 0,
    });
    const recovered = collectResult({ status: "success" });

    expect(recordCollectResultForCircuitBreaker(failure)).toBeNull();
    expect(recordCollectResultForCircuitBreaker(recovered)).toBeNull();
    expect(recordCollectResultForCircuitBreaker(failure)).toBeNull();
  });
});

describe("collect run persistence status", () => {
  it("no persiste stopReason exitoso como error falso", () => {
    expect(
      buildCollectRunPersistenceStatus({
        errorMessage: null,
      }),
    ).toEqual({
      status: "success",
      errorMessage: null,
    });
  });

  it("persiste error real cuando existe errorMessage", () => {
    expect(
      buildCollectRunPersistenceStatus({
        errorMessage: "Timeout en comprasmx-collection",
      }),
    ).toEqual({
      status: "error",
      errorMessage: "Timeout en comprasmx-collection",
    });
  });
});
