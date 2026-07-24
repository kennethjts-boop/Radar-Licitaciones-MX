import type { Page, Response } from "playwright";
import { createModuleLogger } from "../../core/logger";

const log = createModuleLogger("resilience:fast-wait");

const FAIL_FAST_STATUSES = new Set([429, 500, 502, 503, 504, 521, 522, 523, 524]);

export type ResponseMatcher = (response: Response) => boolean;

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`Upstream respondió HTTP ${status}: ${url}`);
    this.name = "UpstreamError";
  }
}

export class FastTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Sin respuesta coincidente del upstream en ${timeoutMs}ms`);
    this.name = "FastTimeoutError";
  }
}

export class FastWaitAbortedError extends Error {
  constructor() {
    super("Espera de respuesta cancelada");
    this.name = "FastWaitAbortedError";
  }
}

export function waitForResponseFailFast(
  page: Page,
  matcher: ResponseMatcher,
  timeoutMs = 25_000,
  signal?: AbortSignal,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const cleanup = (): void => {
      page.off("response", onResponse);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      signal?.removeEventListener("abort", onAbort);
    };

    const settle = (
      outcome: "resolved" | "rejected",
      value: Response | Error,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const latencyMs = Date.now() - startedAt;
      if (outcome === "resolved") {
        log.info({ latencyMs }, "[FASTWAIT] Respuesta coincidente recibida");
        resolve(value as Response);
      } else {
        log.warn(
          { latencyMs, errorType: (value as Error).name },
          "[FASTWAIT] Espera finalizada sin respuesta utilizable",
        );
        reject(value);
      }
    };

    function onAbort(): void {
      settle("rejected", new FastWaitAbortedError());
    }

    function onResponse(response: Response): void {
      if (settled) return;
      let matches: boolean;
      try {
        matches = matcher(response);
      } catch (error) {
        settle(
          "rejected",
          error instanceof Error ? error : new Error(String(error)),
        );
        return;
      }
      if (!matches) return;
      if (FAIL_FAST_STATUSES.has(response.status())) {
        settle("rejected", new UpstreamError(response.status(), response.url()));
        return;
      }
      settle("resolved", response);
    }

    page.on("response", onResponse);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timeoutHandle = setTimeout(() => {
      settle("rejected", new FastTimeoutError(timeoutMs));
    }, timeoutMs);
  });
}
