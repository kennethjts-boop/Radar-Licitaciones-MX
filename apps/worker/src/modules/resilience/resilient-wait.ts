import type { Page, Response } from "playwright";
import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import {
  getEndpointCircuit,
  normalizeEndpointKey,
  type CircuitSnapshot,
} from "./circuit-breaker";
import {
  FastTimeoutError,
  UpstreamError,
  waitForResponseFailFast,
  type ResponseMatcher,
} from "./fast-wait";

const log = createModuleLogger("resilience:resilient-wait");

const BACKOFF_MS = [60_000, 300_000, 900_000] as const;
const MAX_ATTEMPTS = 3;
const JITTER_RATIO = 0.2;

interface RetryState {
  attempts: number;
  nextAttemptAt: number;
}

const retryStates = new Map<string, RetryState>();

export interface ResilientWaitResponse {
  status: "response";
  response: Response;
}

export interface ResilientWaitSkipped {
  status: "skipped";
  reason: "circuit_open" | "backoff";
  key: string;
  msUntilRetry: number;
}

export type ResilientWaitResult = ResilientWaitResponse | ResilientWaitSkipped;

function retryDelayMs(attempt: number, random: () => number): number {
  const base = BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1];
  const jitterFactor = 1 + ((random() * 2) - 1) * JITTER_RATIO;
  return Math.max(0, Math.round(base * jitterFactor));
}

function circuitSkip(snapshot: CircuitSnapshot): ResilientWaitSkipped | null {
  if (snapshot.state !== "OPEN") return null;
  return {
    status: "skipped",
    reason: "circuit_open",
    key: snapshot.key,
    msUntilRetry: snapshot.msUntilRetry,
  };
}

export function preflightResilientWait(
  endpoint: string,
  nowMs = Date.now(),
): ResilientWaitSkipped | null {
  const circuit = getEndpointCircuit(endpoint);
  const open = circuitSkip(circuit.snapshot(nowMs));
  if (open) return open;

  const key = normalizeEndpointKey(endpoint);
  const retry = retryStates.get(key);
  if (!retry) return null;
  const msUntilRetry = Math.max(0, retry.nextAttemptAt - nowMs);
  if (msUntilRetry > 0) {
    return {
      status: "skipped",
      reason: "backoff",
      key,
      msUntilRetry,
    };
  }
  if (retry.attempts >= MAX_ATTEMPTS) {
    retryStates.delete(key);
  }
  return null;
}

export async function waitForResponseResilient(
  page: Page,
  endpoint: string,
  matcher: ResponseMatcher,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    now?: () => number;
    random?: () => number;
  } = {},
): Promise<ResilientWaitResult> {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const beforeWait = preflightResilientWait(endpoint, now());
  if (beforeWait) {
    log.info(
      {
        key: beforeWait.key,
        reason: beforeWait.reason,
        msUntilRetry: beforeWait.msUntilRetry,
      },
      "[CIRCUIT] Espera omitida por protección de resiliencia",
    );
    return beforeWait;
  }

  const circuit = getEndpointCircuit(endpoint);
  const permit = circuit.tryAcquire(now());
  if (!permit.allowed) {
    const skipped = circuitSkip(permit.snapshot) ?? {
      status: "skipped" as const,
      reason: "circuit_open" as const,
      key: permit.snapshot.key,
      msUntilRetry: permit.snapshot.msUntilRetry,
    };
    log.info(
      { key: skipped.key, msUntilRetry: skipped.msUntilRetry },
      "[CIRCUIT] Sondeo HALF_OPEN ya ocupado; espera omitida",
    );
    return skipped;
  }

  const timeoutMs = options.timeoutMs ?? getConfig().WATCHDOG_TIMEOUT_MS;
  try {
    const response = await waitForResponseFailFast(
      page,
      matcher,
      timeoutMs,
      options.signal,
    );
    circuit.recordSuccess();
    retryStates.delete(circuit.key);
    return { status: "response", response };
  } catch (error) {
    if (!(error instanceof UpstreamError) && !(error instanceof FastTimeoutError)) {
      throw error;
    }

    const previousAttempts = retryStates.get(circuit.key)?.attempts ?? 0;
    const attempts = Math.min(previousAttempts + 1, MAX_ATTEMPTS);
    const delayMs = retryDelayMs(attempts, random);
    retryStates.set(circuit.key, {
      attempts,
      nextAttemptAt: now() + delayMs,
    });
    circuit.recordFailure(now());
    log.warn(
      {
        key: circuit.key,
        attempt: attempts,
        maxAttempts: MAX_ATTEMPTS,
        retryInMs: delayMs,
        signal: error.name,
      },
      error instanceof UpstreamError
        ? "[FASTWAIT] Upstream respondió con saturación; aplicando backoff"
        : "[FASTWAIT] Upstream silencioso; aplicando backoff",
    );
    throw error;
  }
}

export function resetResilientWaitsForTests(): void {
  retryStates.clear();
}
