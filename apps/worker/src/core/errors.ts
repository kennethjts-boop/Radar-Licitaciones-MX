/**
 * ERRORS — Jerarquía de errores del sistema con contexto estructurado.
 */

export class RadarError extends Error {
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RadarError";
    this.code = code;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class CollectorError extends RadarError {
  constructor(
    message: string,
    collectorKey: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, "COLLECTOR_ERROR", { collectorKey, ...context });
    this.name = "CollectorError";
  }
}

export class StorageError extends RadarError {
  constructor(
    message: string,
    operation: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, "STORAGE_ERROR", { operation, ...context });
    this.name = "StorageError";
  }
}

export class TelegramError extends RadarError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, "TELEGRAM_ERROR", context);
    this.name = "TelegramError";
  }
}

export class MatcherError extends RadarError {
  constructor(
    message: string,
    radarKey: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, "MATCHER_ERROR", { radarKey, ...context });
    this.name = "MatcherError";
  }
}

export class TimeoutError extends RadarError {
  constructor(operation: string, timeoutMs: number) {
    super(`Timeout en operación: ${operation} (${timeoutMs}ms)`, "TIMEOUT", {
      operation,
      timeoutMs,
    });
    this.name = "TimeoutError";
  }
}

/**
 * Envuelve una Promise con timeout. Lanza TimeoutError si excede.
 */
export async function withTimeout<T>(
  promise: Promise<T> | PromiseLike<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer!);
    return result;
  } catch (e) {
    clearTimeout(timer!);
    throw e;
  }
}

