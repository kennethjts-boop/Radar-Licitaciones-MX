import {
  isCriticalCollectFailure,
  recordCollectResultForCircuitBreaker,
  resetComprasMxIncidentStateForTests,
} from "../scheduler";
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

  it("manda una sola alerta en el primer fallo consecutivo de extracción", () => {
    const failure = collectResult({
      status: "site_accessible_extraction_failed",
      itemsSeen: 0,
      pagesScanned: 0,
    });

    expect(recordCollectResultForCircuitBreaker(failure)).toContain(
      "El sitio carga, pero el scraper no logró activar Buscar o capturar la respuesta API",
    );
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

  it("manda recuperación una sola vez cuando vuelven las filas", () => {
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
    expect(recordCollectResultForCircuitBreaker(recovered)).toBe(
      "🟢 ComprasMX volvió a extraer información correctamente.",
    );
    expect(recordCollectResultForCircuitBreaker(recovered)).toBeNull();
  });

  it("manda una nueva alerta si vuelve a fallar después de recuperarse", () => {
    const failure = collectResult({
      status: "site_accessible_extraction_failed",
      itemsSeen: 0,
      pagesScanned: 0,
    });
    const recovered = collectResult({ status: "success" });

    expect(recordCollectResultForCircuitBreaker(failure)).not.toBeNull();
    expect(recordCollectResultForCircuitBreaker(recovered)).not.toBeNull();
    expect(recordCollectResultForCircuitBreaker(failure)).not.toBeNull();
  });
});
