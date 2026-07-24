import {
  EndpointCircuitBreaker,
  allCircuits,
  getEndpointCircuit,
  normalizeEndpointKey,
  resetEndpointCircuitsForTests,
} from "../circuit-breaker";

describe("EndpointCircuitBreaker", () => {
  beforeEach(() => {
    resetEndpointCircuitsForTests();
  });

  it("normaliza el UUID y comparte circuito por endpoint lógico", () => {
    const first = "/whitney/sitiopublico/expedientes/abc123/anexos?page=1";
    const second = "https://upstream.example/whitney/sitiopublico/expedientes/def456/anexos?page=2";

    expect(normalizeEndpointKey(first))
      .toBe("/whitney/sitiopublico/expedientes/:uuid/anexos");
    expect(getEndpointCircuit(first)).toBe(getEndpointCircuit(second));
    expect(allCircuits()).toEqual([
      expect.objectContaining({
        key: "/whitney/sitiopublico/expedientes/:uuid/anexos",
        state: "CLOSED",
      }),
    ]);
  });

  it("abre al umbral, permite un solo sondeo HALF_OPEN y cierra con éxito", () => {
    const circuit = new EndpointCircuitBreaker("/endpoint", {
      failureThreshold: 3,
      openMs: 1_000,
    });

    circuit.recordFailure(0);
    circuit.recordFailure(0);
    expect(circuit.snapshot(0)).toEqual({
      key: "/endpoint",
      state: "CLOSED",
      consecutiveFailures: 2,
      msUntilRetry: 0,
      reopenedFromHalfOpen: false,
      openCount: 0,
    });

    circuit.recordFailure(0);
    expect(circuit.snapshot(0)).toEqual({
      key: "/endpoint",
      state: "OPEN",
      consecutiveFailures: 3,
      msUntilRetry: 1_000,
      reopenedFromHalfOpen: false,
      openCount: 1,
    });
    expect(circuit.tryAcquire(999).allowed).toBe(false);

    expect(circuit.tryAcquire(1_000)).toEqual({
      allowed: true,
      snapshot: {
        key: "/endpoint",
        state: "HALF_OPEN",
        consecutiveFailures: 3,
        msUntilRetry: 0,
        reopenedFromHalfOpen: false,
        openCount: 1,
      },
    });
    expect(circuit.tryAcquire(1_000).allowed).toBe(false);

    circuit.recordSuccess();
    expect(circuit.snapshot(1_001)).toEqual({
      key: "/endpoint",
      state: "CLOSED",
      consecutiveFailures: 0,
      msUntilRetry: 0,
      reopenedFromHalfOpen: false,
      openCount: 1,
    });
  });

  it("un fallo HALF_OPEN vuelve a abrir y reinicia el reloj", () => {
    const circuit = new EndpointCircuitBreaker("/endpoint", {
      failureThreshold: 1,
      openMs: 1_000,
    });

    circuit.recordFailure(100);
    expect(circuit.tryAcquire(1_100).allowed).toBe(true);
    circuit.recordFailure(1_200);

    expect(circuit.snapshot(1_200)).toEqual({
      key: "/endpoint",
      state: "OPEN",
      consecutiveFailures: 2,
      msUntilRetry: 1_000,
      reopenedFromHalfOpen: true,
      openCount: 2,
    });
    expect(circuit.snapshot(1_700).msUntilRetry).toBe(500);
  });
});
