import { EventEmitter } from "events";
import type { Page, Response } from "playwright";
import {
  FastTimeoutError,
  UpstreamError,
  waitForResponseFailFast,
} from "../fast-wait";

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

  emitResponse(response: Response): void {
    this.emitter.emit("response", response);
  }

  responseListenerCount(): number {
    return this.emitter.listenerCount("response");
  }
}

function fakeResponse(url: string, status: number): Response {
  return {
    url: () => url,
    status: () => status,
  } as unknown as Response;
}

describe("waitForResponseFailFast", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("resuelve la respuesta coincidente y siempre retira el listener", async () => {
    const fakePage = new FakePage();
    const page = fakePage as unknown as Page;
    const waiting = waitForResponseFailFast(
      page,
      (response) => response.url().endsWith("/detail"),
      1_000,
    );

    fakePage.emitResponse(fakeResponse("https://example.test/unrelated", 200));
    expect(fakePage.responseListenerCount()).toBe(1);
    const matching = fakeResponse("https://example.test/detail", 200);
    fakePage.emitResponse(matching);

    await expect(waiting).resolves.toBe(matching);
    expect(fakePage.responseListenerCount()).toBe(0);
  });

  it.each([429, 500, 502, 503, 504, 521, 522, 523, 524])(
    "rechaza inmediatamente el status upstream %i y limpia",
    async (status) => {
      const fakePage = new FakePage();
      const waiting = waitForResponseFailFast(
        fakePage as unknown as Page,
        (response) => response.url().includes("/detail"),
        10_000,
      );

      fakePage.emitResponse(fakeResponse("https://example.test/detail", status));

      await expect(waiting).rejects.toEqual(expect.objectContaining({
        name: "UpstreamError",
        status,
      }) satisfies Partial<UpstreamError>);
      expect(fakePage.responseListenerCount()).toBe(0);
    },
  );

  it("ignora errores HTTP de respuestas que no coinciden con el matcher", async () => {
    const fakePage = new FakePage();
    const waiting = waitForResponseFailFast(
      fakePage as unknown as Page,
      (response) => response.url().endsWith("/detail"),
      1_000,
    );

    fakePage.emitResponse(fakeResponse("https://example.test/asset", 500));
    const matching = fakeResponse("https://example.test/detail", 204);
    fakePage.emitResponse(matching);

    await expect(waiting).resolves.toBe(matching);
    expect(fakePage.responseListenerCount()).toBe(0);
  });

  it("vence con FastTimeoutError y limpia listener y timer", async () => {
    jest.useFakeTimers();
    const fakePage = new FakePage();
    const waiting = waitForResponseFailFast(
      fakePage as unknown as Page,
      () => true,
      25_000,
    );

    jest.advanceTimersByTime(25_000);

    await expect(waiting).rejects.toBeInstanceOf(FastTimeoutError);
    expect(fakePage.responseListenerCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("usa WATCHDOG_TIMEOUT_MS=45000 por default", async () => {
    jest.useFakeTimers();
    const fakePage = new FakePage();
    const waiting = waitForResponseFailFast(
      fakePage as unknown as Page,
      () => true,
    );

    jest.advanceTimersByTime(44_999);
    expect(fakePage.responseListenerCount()).toBe(1);
    jest.advanceTimersByTime(1);

    await expect(waiting).rejects.toMatchObject({
      name: "FastTimeoutError",
      timeoutMs: 45_000,
    });
    expect(fakePage.responseListenerCount()).toBe(0);
  });

  it("limpia también si el matcher lanza y el flag settled evita dobles salidas", async () => {
    const fakePage = new FakePage();
    const waiting = waitForResponseFailFast(
      fakePage as unknown as Page,
      () => {
        throw new Error("matcher inválido");
      },
      1_000,
    );

    fakePage.emitResponse(fakeResponse("https://example.test/detail", 200));
    fakePage.emitResponse(fakeResponse("https://example.test/detail", 503));

    await expect(waiting).rejects.toThrow("matcher inválido");
    expect(fakePage.responseListenerCount()).toBe(0);
  });
});
