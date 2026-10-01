import type {
  NormalizedRoute,
  NormalizedTrainStatus,
  ProviderHealth,
  ProviderId,
  ProviderInfo,
  StopStatus,
  TrainState,
} from '@railtrack/shared';
import { ProviderError } from '../lib/errors.ts';
import { DEFAULT_RETRY_POLICY, getJson, withRetry, type FetchLike, type JsonResponse, type RetryPolicy } from '../lib/http.ts';
import { healthLimits, notConfiguredError } from './normalize.ts';
import type { ProviderLimits, TrainDataProvider } from './types.ts';

export interface HttpProviderOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  retryPolicy?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** Common plumbing for licensed HTTP providers: key handling, timeouts, retry with backoff, health probe. */
export abstract class HttpProvider implements TrainDataProvider {
  abstract readonly id: ProviderId;
  abstract readonly info: ProviderInfo;
  abstract readonly limits: ProviderLimits;
  abstract readonly docsUrl: string | null;
  protected abstract readonly keyEnvVar: string;

  constructor(protected readonly options: HttpProviderOptions) {}

  abstract getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus>;
  abstract getTrainRoute(trainNumber: string): Promise<NormalizedRoute>;
  /** Cheapest documented call that proves credentials and connectivity. */
  protected abstract probe(): Promise<void>;

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  protected now(): Date {
    return this.options.now?.() ?? new Date();
  }

  protected requireKey(): string {
    if (!this.options.apiKey) throw notConfiguredError(this, this.keyEnvVar);
    return this.options.apiKey;
  }

  protected get baseUrl(): string {
    return this.options.baseUrl.replace(/\/+$/, '');
  }

  /** GET JSON with timeout + retries; `classify` returns the payload or throws a ProviderError. */
  protected async fetchJson<T>(url: string, headers: Record<string, string>, classify: (res: JsonResponse) => T): Promise<T> {
    return withRetry(
      async () => classify(await getJson(this.id, url, { headers, timeoutMs: this.options.timeoutMs, fetchImpl: this.options.fetchImpl })),
      this.options.retryPolicy ?? DEFAULT_RETRY_POLICY,
      { sleep: this.options.sleep },
    );
  }

  async healthCheck(): Promise<ProviderHealth> {
    const base = {
      provider: this.id,
      name: this.info.name,
      active: false,
      configured: this.isConfigured(),
      isDemo: false,
      docsUrl: this.docsUrl,
      limits: healthLimits(this.limits),
    };
    if (!this.isConfigured()) {
      return { ...base, status: 'not_configured', latencyMs: null, checkedAt: this.now().toISOString(), message: `Set ${this.keyEnvVar} to enable.` };
    }
    const started = performance.now();
    try {
      await this.probe();
      return { ...base, status: 'up', latencyMs: Math.round(performance.now() - started), checkedAt: this.now().toISOString(), message: null };
    } catch (err) {
      const e = err instanceof ProviderError ? err : null;
      return {
        ...base,
        status: e?.code === 'RATE_LIMITED' ? 'degraded' : 'down',
        latencyMs: Math.round(performance.now() - started),
        checkedAt: this.now().toISOString(),
        message: e?.message ?? 'Health check failed',
      };
    }
  }
}

/** Standard HTTP status → ProviderError mapping; adapters refine 400/404 semantics. */
export function classifyHttpFailure(
  provider: string,
  res: JsonResponse,
  options: { notFoundMessage: string; retryOn429?: boolean },
): ProviderError {
  const retryAfter = res.headers.get('retry-after');
  const retryAfterSeconds = retryAfter && Number.isFinite(Number(retryAfter)) ? Math.ceil(Number(retryAfter)) : null;
  if (res.status === 401 || res.status === 403) {
    return new ProviderError(provider, 'PROVIDER_AUTH_FAILED', 'The data provider rejected our credentials or plan. Live data temporarily unavailable.', {
      httpStatus: res.status,
    });
  }
  if (res.status === 404) return new ProviderError(provider, 'TRAIN_NOT_FOUND', options.notFoundMessage, { httpStatus: 404 });
  if (res.status === 429) {
    return new ProviderError(provider, 'RATE_LIMITED', 'The data provider rate limit was reached. Please try again later.', {
      httpStatus: 429,
      retryAfterSeconds: retryAfterSeconds ?? 60,
      retryable: options.retryOn429 ?? true,
    });
  }
  if (res.status >= 500) {
    return new ProviderError(provider, 'PROVIDER_UNAVAILABLE', 'The data provider is temporarily unavailable.', {
      httpStatus: res.status,
      retryable: true,
    });
  }
  return new ProviderError(provider, 'PROVIDER_UNAVAILABLE', `The data provider could not answer this request (HTTP ${res.status}).`, {
    httpStatus: res.status,
  });
}

/** Map free-text station status from providers to the normalised stop status. */
export function stopStatusFromText(value: unknown): StopStatus {
  const t = String(value ?? '').toLowerCase();
  if (t.includes('skip') || t.includes('not served')) return 'skipped';
  if (t.includes('cancel')) return 'cancelled';
  if (t.includes('divert')) return 'diverted';
  if (t.includes('current') || t.includes('halt') || t === 'at' || t.includes('arriving')) return 'current';
  if (t.includes('depart') || t.includes('pass') || t.includes('cross') || t.includes('complete') || t.includes('left')) return 'departed';
  if (t.includes('arrived') || t.includes('reached')) return 'arrived';
  return 'upcoming';
}

/** Map free-text journey status to the normalised state (null when the text is inconclusive). */
export function stateFromText(value: unknown): TrainState | null {
  const t = String(value ?? '').toLowerCase();
  if (!t) return null;
  if (t.includes('cancel')) return 'cancelled';
  if (t.includes('resched')) return 'rescheduled';
  if (t.includes('divert')) return 'diverted';
  if (t.includes('yet to start') || t.includes('not started') || t.includes('not_started') || t.includes('yet_to_start') || t === 'scheduled') {
    return 'not_started';
  }
  if (t.includes('reached destination') || t.includes('completed') || t.includes('terminated') || t.includes('arrived at destination') || t === 'arrived' || t === 'completed') {
    return 'arrived';
  }
  if (t.includes('depart')) return 'departed';
  if (t.includes('running') || t.includes('arriv') || t.includes('pass') || t.includes('cross')) return 'running';
  return null;
}
