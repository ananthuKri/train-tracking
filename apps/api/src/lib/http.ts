import { ProviderError } from './errors.ts';

export interface RetryPolicy {
  /** Total attempts including the first one. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Retry a 429 only when the server asks us to wait no longer than this. */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 5_000,
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter: random(0, min(max, base·2^(attempt-1))). */
export function backoffDelay(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(random() * ceiling);
}

export interface RetryHooks {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: ProviderError }) => void;
}

/**
 * Retries only errors explicitly marked retryable by the provider adapter (timeouts, network errors,
 * 5xx, and 429s with a short Retry-After). Auth failures, 4xx and quota exhaustion are never retried.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, policy: RetryPolicy = DEFAULT_RETRY_POLICY, hooks: RetryHooks = {}): Promise<T> {
  const wait = hooks.sleep ?? sleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable || attempt >= policy.maxAttempts) throw err;
      let delayMs = backoffDelay(attempt, policy, hooks.random);
      if (err.retryAfterSeconds !== null) {
        const requested = err.retryAfterSeconds * 1000;
        if (requested > policy.maxRetryAfterMs) throw err;
        delayMs = Math.max(delayMs, requested);
      }
      hooks.onRetry?.({ attempt, delayMs, error: err });
      await wait(delayMs);
    }
  }
}

export function parseRetryAfter(header: string | null, now: Date = new Date()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now.getTime()) / 1000));
}

export interface JsonResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  body: unknown;
  latencyMs: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * GET a JSON document with a hard timeout. Network failures and timeouts become retryable
 * ProviderErrors; HTTP error statuses are returned for the adapter to classify.
 * The URL is never included in error messages because some providers put keys in the path.
 */
export async function getJson(
  provider: string,
  url: string,
  options: { headers?: Record<string, string>; timeoutMs: number; fetchImpl?: FetchLike },
): Promise<JsonResponse> {
  const started = performance.now();
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: 'error',
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new ProviderError(provider, timedOut ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE', timedOut ? 'Provider request timed out' : 'Could not reach provider', {
      retryable: true,
      cause: err,
    });
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, ok: response.ok, headers: response.headers, body, latencyMs: Math.round(performance.now() - started) };
}
