// Transient-failure retry for upstream HTTP calls. 17Track rate-limits at 3 req/s
// and occasionally returns 5xx; a single retry with backoff turns most of those
// transient blips into successful lookups instead of user-visible errors.

/** HTTP statuses worth retrying: rate limit and server errors. */
export function isRetriableHttp(status: number): boolean {
  return status === 429 || status >= 500;
}

export type RetryOpts<T> = {
  maxRetries: number;
  baseDelayMs: number;
  /** Retry when a (resolved) result is transient, e.g. an HTTP 429 body. */
  isRetriable: (result: T) => boolean;
  /** Retry when a thrown error is transient, e.g. a fetch timeout. */
  isRetriableError?: (err: Error) => boolean;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Exponential backoff with full jitter; never below baseDelayMs so we stay within
// 17Track's 3 req/s budget. baseDelayMs <= 0 disables the wait (used by tests).
function backoff(attempt: number, base: number): number {
  if (base <= 0) return 0;
  const exp = base * 2 ** attempt; // attempt 0 -> base, 1 -> 2*base, ...
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt < opts.maxRetries && opts.isRetriable(result)) {
        await sleep(backoff(attempt, opts.baseDelayMs));
        continue;
      }
      return result;
    } catch (err) {
      lastErr = err;
      const retriable =
        err instanceof Error && (opts.isRetriableError?.(err) ?? false);
      if (attempt < opts.maxRetries && retriable) {
        await sleep(backoff(attempt, opts.baseDelayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
