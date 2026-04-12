export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void | Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 750;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_DELAY_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  const stack = (error.stack ?? "").toLowerCase();

  const candidates = [
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "econnrefused",
    "enotfound",
    "network",
    "socket hang up",
    "503",
    "gateway",
    "fetch failed",
    "net::err",
  ];

  return candidates.some(
    (token) => message.includes(token) || name.includes(token) || stack.includes(token),
  );
}

export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const backoffMultiplier = options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let attempt = 1;
  let delayMs = initialDelayMs;

  while (attempt <= maxAttempts) {
    try {
      return await fn(attempt);
    } catch (error) {
      const isLastAttempt = attempt >= maxAttempts;
      const shouldRetry = options.shouldRetry
        ? options.shouldRetry(error, attempt)
        : isRetryableNetworkError(error);

      if (isLastAttempt || !shouldRetry) {
        throw error;
      }

      await options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);

      attempt += 1;
      delayMs = Math.min(Math.floor(delayMs * backoffMultiplier), maxDelayMs);
    }
  }

  throw new Error("withRetries exhausted unexpectedly");
}
