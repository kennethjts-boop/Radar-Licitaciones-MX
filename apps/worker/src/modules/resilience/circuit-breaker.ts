import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";

const log = createModuleLogger("resilience:circuit-breaker");

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitSnapshot {
  key: string;
  state: CircuitState;
  consecutiveFailures: number;
  msUntilRetry: number;
  reopenedFromHalfOpen: boolean;
  openCount: number;
}

export interface CircuitPermit {
  allowed: boolean;
  snapshot: CircuitSnapshot;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
}

const circuits = new Map<string, EndpointCircuitBreaker>();

export function normalizeEndpointKey(endpoint: string): string {
  const url = new URL(endpoint, "https://watchdog.invalid");
  const collapsedSlashes = url.pathname.replace(/\/{2,}/g, "/");
  const normalizedUuid = collapsedSlashes.replace(
    /(\/whitney\/sitiopublico\/expedientes\/)[^/]+/i,
    "$1:uuid",
  );
  if (normalizedUuid.length > 1 && normalizedUuid.endsWith("/")) {
    return normalizedUuid.slice(0, -1);
  }
  return normalizedUuid;
}

export class EndpointCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenProbeInFlight = false;
  private reopenedFromHalfOpen = false;
  private openCount = 0;

  constructor(
    readonly key: string,
    private readonly options: CircuitBreakerOptions,
  ) {}

  private refreshState(nowMs: number): void {
    if (
      this.state === "OPEN" &&
      this.openedAt !== null &&
      nowMs - this.openedAt >= this.options.openMs
    ) {
      this.state = "HALF_OPEN";
      this.halfOpenProbeInFlight = false;
      this.reopenedFromHalfOpen = false;
      log.info(
        { key: this.key },
        "[CIRCUIT] OPEN → HALF_OPEN; habilitando un sondeo",
      );
    }
  }

  tryAcquire(nowMs = Date.now()): CircuitPermit {
    this.refreshState(nowMs);
    if (this.state === "OPEN") {
      return { allowed: false, snapshot: this.snapshot(nowMs) };
    }
    if (this.state === "HALF_OPEN") {
      if (this.halfOpenProbeInFlight) {
        return { allowed: false, snapshot: this.snapshot(nowMs) };
      }
      this.halfOpenProbeInFlight = true;
    }
    return { allowed: true, snapshot: this.snapshot(nowMs) };
  }

  recordSuccess(): void {
    const recovered = this.state !== "CLOSED" || this.consecutiveFailures > 0;
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.halfOpenProbeInFlight = false;
    this.reopenedFromHalfOpen = false;
    if (recovered) {
      log.info({ key: this.key }, "[CIRCUIT] Circuito cerrado tras respuesta exitosa");
    }
  }

  recordFailure(nowMs = Date.now()): void {
    const wasHalfOpen = this.state === "HALF_OPEN";
    this.consecutiveFailures += 1;
    if (
      this.state === "HALF_OPEN" ||
      this.consecutiveFailures >= this.options.failureThreshold
    ) {
      this.state = "OPEN";
      this.openedAt = nowMs;
      this.halfOpenProbeInFlight = false;
      this.reopenedFromHalfOpen = wasHalfOpen;
      this.openCount += 1;
      log.warn(
        {
          key: this.key,
          consecutiveFailures: this.consecutiveFailures,
          openMs: this.options.openMs,
        },
        "[CIRCUIT] Circuito abierto por fallos consecutivos",
      );
      return;
    }
    log.warn(
      {
        key: this.key,
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.options.failureThreshold,
      },
      "[CIRCUIT] Fallo registrado con circuito aún cerrado",
    );
  }

  snapshot(nowMs = Date.now()): CircuitSnapshot {
    this.refreshState(nowMs);
    const msUntilRetry = this.state === "OPEN" && this.openedAt !== null
      ? Math.max(0, this.options.openMs - (nowMs - this.openedAt))
      : 0;
    return {
      key: this.key,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      msUntilRetry,
      reopenedFromHalfOpen: this.reopenedFromHalfOpen,
      openCount: this.openCount,
    };
  }
}

export function getEndpointCircuit(endpoint: string): EndpointCircuitBreaker {
  const key = normalizeEndpointKey(endpoint);
  const existing = circuits.get(key);
  if (existing) return existing;
  const config = getConfig();
  const circuit = new EndpointCircuitBreaker(key, {
    failureThreshold: config.CIRCUIT_FAILURE_THRESHOLD,
    openMs: config.CIRCUIT_OPEN_MS,
  });
  circuits.set(key, circuit);
  return circuit;
}

export function allCircuits(nowMs = Date.now()): CircuitSnapshot[] {
  return Array.from(circuits.values())
    .map((circuit) => circuit.snapshot(nowMs))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function resetEndpointCircuits(): void {
  circuits.clear();
}

export function resetEndpointCircuitsForTests(): void {
  resetEndpointCircuits();
}
