import { EventEmitter } from "events";
import type { Page, Response } from "playwright";
import {
  allCircuits,
  resetEndpointCircuitsForTests,
} from "../circuit-breaker";
import {
  preflightResilientWait,
  resetResilientWaitsForTests,
  waitForResponseResilient,
} from "../resilient-wait";

class FakePage {
  private readonly emitter = new EventEmitter();

  on(event: "response", listener: (response: Response) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: "response", listener: (response: Response) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  emit(status: number): void {
    this.emitter.emit("response", {
      url: () => "https://upstream.test/whitney/sitiopublico/expedientes/abc",
      status: () => status,
    } as unknown as Response);
  }

  listeners(): number {
    return this.emitter.listenerCount("response");
  }
}

describe("waitForResponseResilient", () => {
  const endpoint = "/whitney/sitiopublico/expedientes/abc";

  beforeEach(() => {
    resetEndpointCircuitsForTests();
    resetResilientWaitsForTests();
  });

  it("aplica backoff no bloqueante 60s → 300s y abre tras el tercer fallo", async () => {
    let nowMs = 0;
    const random = () => 0.5;
    const matcher = () => true;

    const firstPage = new FakePage();
    const first = waitForResponseResilient(
      firstPage as unknown as Page,
      endpoint,
      matcher,
      { now: () => nowMs, random },
    );
    firstPage.emit(503);
    await expect(first).rejects.toMatchObject({ name: "UpstreamError" });
    expect(preflightResilientWait(endpoint, nowMs)).toEqual({
      status: "skipped",
      reason: "backoff",
      key: "/whitney/sitiopublico/expedientes/:uuid",
      msUntilRetry: 60_000,
    });

    const blockedPage = new FakePage();
    await expect(waitForResponseResilient(
      blockedPage as unknown as Page,
      endpoint,
      matcher,
      { now: () => nowMs, random },
    )).resolves.toMatchObject({ status: "skipped", reason: "backoff" });
    expect(blockedPage.listeners()).toBe(0);

    nowMs = 60_000;
    const secondPage = new FakePage();
    const second = waitForResponseResilient(
      secondPage as unknown as Page,
      endpoint,
      matcher,
      { now: () => nowMs, random },
    );
    secondPage.emit(503);
    await expect(second).rejects.toMatchObject({ name: "UpstreamError" });
    expect(preflightResilientWait(endpoint, nowMs)?.msUntilRetry).toBe(300_000);

    nowMs = 360_000;
    const thirdPage = new FakePage();
    const third = waitForResponseResilient(
      thirdPage as unknown as Page,
      endpoint,
      matcher,
      { now: () => nowMs, random },
    );
    thirdPage.emit(503);
    await expect(third).rejects.toMatchObject({ name: "UpstreamError" });

    expect(allCircuits(nowMs)).toEqual([
      expect.objectContaining({
        key: "/whitney/sitiopublico/expedientes/:uuid",
        state: "OPEN",
        consecutiveFailures: 3,
      }),
    ]);
    expect(preflightResilientWait(endpoint, nowMs)).toEqual(expect.objectContaining({
      status: "skipped",
      reason: "circuit_open",
      msUntilRetry: 1_800_000,
    }));
  });

  it("el jitter mantiene el primer backoff dentro de ±20%", async () => {
    const lowPage = new FakePage();
    const low = waitForResponseResilient(
      lowPage as unknown as Page,
      endpoint,
      () => true,
      { now: () => 0, random: () => 0 },
    );
    lowPage.emit(503);
    await expect(low).rejects.toMatchObject({ name: "UpstreamError" });
    expect(preflightResilientWait(endpoint, 0)?.msUntilRetry).toBe(48_000);

    resetEndpointCircuitsForTests();
    resetResilientWaitsForTests();

    const highPage = new FakePage();
    const high = waitForResponseResilient(
      highPage as unknown as Page,
      endpoint,
      () => true,
      { now: () => 0, random: () => 1 },
    );
    highPage.emit(503);
    await expect(high).rejects.toMatchObject({ name: "UpstreamError" });
    expect(preflightResilientWait(endpoint, 0)?.msUntilRetry).toBe(72_000);
  });
});
