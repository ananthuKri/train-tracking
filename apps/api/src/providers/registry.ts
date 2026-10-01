import type { NormalizedRoute, NormalizedTrainStatus, ProviderHealth, ProviderId, ProviderInfo } from '@railtrack/shared';
import type { AppConfig, ScraperId } from '../config/env.ts';
import { AppError, ProviderError } from '../lib/errors.ts';
import type { FetchLike } from '../lib/http.ts';
import { RateLimiter } from '../lib/rateLimiter.ts';
import { IndianRailApiProvider } from './indianRailApi.ts';
import { MockProvider } from './mock.ts';
import { RailKitProvider } from './railkit.ts';
import { RailRadarProvider } from './railradar.ts';
import { RailYatriScraperProvider } from './railyatri.ts';
import { WhereIsMyTrainScraperProvider } from './whereIsMyTrain.ts';
import { ScrapeFirstProvider, type ScrapeFirstOptions } from './scrapeFirst.ts';
import type { ProviderLimits, TrainDataProvider } from './types.ts';

export type CallOutcome = 'success' | 'error' | 'rate_limited' | 'not_found';

export interface ProviderCallRecord {
  provider: ProviderId;
  operation: 'live' | 'route' | 'health';
  trainNumber: string | null;
  outcome: CallOutcome;
  httpStatus: number | null;
  latencyMs: number;
  errorCode: string | null;
  message: string | null;
}

export type UsageSink = (record: ProviderCallRecord) => void;

const HEALTH_CACHE_MS = 5 * 60_000;

/**
 * Wraps a provider with the outbound rate limiter, usage logging and cached health checks.
 * Every provider call in the system goes through this guard.
 */
export class GuardedProvider implements TrainDataProvider {
  private readonly limiter: RateLimiter;
  private healthCache: { at: number; value: ProviderHealth } | null = null;

  private readonly effectiveLimits: ProviderLimits;

  constructor(
    private readonly inner: TrainDataProvider,
    private readonly usage: UsageSink,
    overrides: Partial<ProviderLimits> = {},
  ) {
    this.effectiveLimits = { ...inner.limits, ...overrides };
    this.limiter = new RateLimiter({
      name: inner.id,
      maxConcurrent: this.effectiveLimits.maxConcurrent,
      minIntervalMs: this.effectiveLimits.minIntervalMs,
      maxPerMinute: this.effectiveLimits.maxPerMinute,
    });
  }

  get id(): ProviderId {
    return this.inner.id;
  }
  get info(): ProviderInfo {
    return this.inner.info;
  }
  get limits(): ProviderLimits {
    return this.effectiveLimits;
  }
  get docsUrl(): string | null {
    return this.inner.docsUrl;
  }
  get sourceIds(): ProviderId[] {
    return [this.inner.id];
  }
  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus> {
    return this.run('live', trainNumber, () => this.inner.getLiveStatus(trainNumber, journeyDate));
  }

  getTrainRoute(trainNumber: string): Promise<NormalizedRoute> {
    return this.run('route', trainNumber, () => this.inner.getTrainRoute(trainNumber));
  }

  async healthCheck(options: { force?: boolean } = {}): Promise<ProviderHealth> {
    if (!options.force && this.healthCache && Date.now() - this.healthCache.at < HEALTH_CACHE_MS) return this.healthCache.value;
    const value = this.inner.isConfigured()
      ? await this.run('health', null, () => this.inner.healthCheck()).catch((err: unknown) => failedHealth(this.inner, err))
      : await this.inner.healthCheck();
    this.healthCache = { at: Date.now(), value };
    return value;
  }

  private async run<T>(operation: ProviderCallRecord['operation'], trainNumber: string | null, fn: () => Promise<T>): Promise<T> {
    if (!this.inner.isConfigured()) {
      // No network call happens; nothing to log against the provider's quota.
      return fn();
    }
    return this.limiter.schedule(async () => {
      const started = performance.now();
      try {
        const result = await fn();
        const health = operation === 'health' ? (result as ProviderHealth) : null;
        this.record(operation, trainNumber, health && health.status !== 'up' ? 'error' : 'success', started, null);
        return result;
      } catch (err) {
        this.record(operation, trainNumber, outcomeFor(err), started, err);
        throw err;
      }
    });
  }

  private record(operation: ProviderCallRecord['operation'], trainNumber: string | null, outcome: CallOutcome, started: number, err: unknown) {
    const e = err instanceof AppError ? err : null;
    this.usage({
      provider: this.inner.id,
      operation,
      trainNumber,
      outcome,
      httpStatus: err instanceof ProviderError ? err.httpStatus : null,
      latencyMs: Math.round(performance.now() - started),
      errorCode: e?.code ?? (err ? 'INTERNAL_ERROR' : null),
      message: e?.message ?? (err ? 'Unexpected provider error' : null),
    });
  }
}

function outcomeFor(err: unknown): CallOutcome {
  if (err instanceof AppError) {
    if (err.code === 'RATE_LIMITED') return 'rate_limited';
    if (err.code === 'TRAIN_NOT_FOUND' || err.code === 'NOT_RUNNING_ON_DATE') return 'not_found';
  }
  return 'error';
}

function failedHealth(provider: TrainDataProvider, err: unknown): ProviderHealth {
  return {
    provider: provider.id,
    name: provider.info.name,
    active: false,
    configured: provider.isConfigured(),
    isDemo: provider.info.isDemo,
    status: err instanceof AppError && err.code === 'RATE_LIMITED' ? 'degraded' : 'down',
    latencyMs: null,
    checkedAt: new Date().toISOString(),
    message: err instanceof AppError ? err.message : 'Health check failed',
    docsUrl: provider.docsUrl,
    limits: {
      maxConcurrent: provider.limits.maxConcurrent,
      minIntervalMs: provider.limits.minIntervalMs,
      liveCacheSeconds: provider.limits.liveCacheSeconds,
      routeCacheSeconds: provider.limits.routeCacheSeconds,
      minPollMinutes: provider.limits.minPollMinutes,
    },
  };
}

/** What the tracking service talks to: one provider, or the scraper with an API fallback. */
export interface ActiveProvider extends TrainDataProvider {
  /** Provider ids whose results it can return (used to find the last verified result). */
  readonly sourceIds: ProviderId[];
}

export interface ScrapingSetup {
  /** Scrapers in priority order; the active API provider is the last resort. */
  scraperIds: ProviderId[];
  maxAttempts: number;
  cooldownMs: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: ScrapeFirstOptions['onEvent'];
}

export class ProviderRegistry {
  private readonly providers: Map<ProviderId, GuardedProvider>;
  private readonly activeProvider: ActiveProvider;

  constructor(
    providers: TrainDataProvider[],
    private readonly activeId: ProviderId,
    usage: UsageSink,
    /** Limit overrides applied to the active provider (e.g. a higher plan quota). */
    activeOverrides: Partial<ProviderLimits> = {},
    /** When set, the scrapers are tried first (in order) and the active provider is the fallback. */
    scraping?: ScrapingSetup,
  ) {
    this.providers = new Map(providers.map((p) => [p.id, new GuardedProvider(p, usage, p.id === activeId ? activeOverrides : {})]));
    if (!this.providers.has(activeId)) throw new Error(`Unknown TRAIN_DATA_PROVIDER "${activeId}"`);
    const api = this.providers.get(activeId)!;
    const scrapers = (scraping?.scraperIds ?? []).map((id) => {
      const scraper = this.providers.get(id);
      if (!scraper) throw new Error(`Unknown scraper "${id}"`);
      return scraper;
    });
    this.activeProvider = scraping && scrapers.length
      ? new ScrapeFirstProvider(scrapers, api, {
          maxAttempts: scraping.maxAttempts,
          cooldownMs: scraping.cooldownMs,
          retryDelayMs: scraping.retryDelayMs,
          sleep: scraping.sleep,
          onEvent: scraping.onEvent,
        })
      : api;
  }

  /** The provider used for all lookups. There is deliberately no silent fallback to demo data. */
  get active(): ActiveProvider {
    return this.activeProvider;
  }

  list(): GuardedProvider[] {
    return [...this.providers.values()];
  }

  async health(options: { force?: boolean } = {}): Promise<ProviderHealth[]> {
    const activeIds = this.activeProvider.sourceIds;
    return Promise.all(this.list().map(async (p) => ({ ...(await p.healthCheck(options)), active: activeIds.includes(p.id) })));
  }
}

export interface RegistryOptions {
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Hook for scraper fallback/pause events (logging). */
  onScrapeEvent?: ScrapeFirstOptions['onEvent'];
}

export function createProviderRegistry(config: AppConfig, usage: UsageSink, options: RegistryOptions = {}): ProviderRegistry {
  const common = { timeoutMs: config.PROVIDER_TIMEOUT_MS, fetchImpl: options.fetchImpl, now: options.now };
  // Scraping never mixes with demo mode: the simulator stays fully simulated.
  const scraperIds = config.TRAIN_DATA_PROVIDER === 'mock' ? [] : config.scrapers;
  const providers: TrainDataProvider[] = [
    new RailRadarProvider({ ...common, apiKey: config.RAILRADAR_API_KEY, baseUrl: config.RAILRADAR_BASE_URL }),
    new RailKitProvider({ ...common, apiKey: config.RAILKIT_API_KEY, baseUrl: config.RAILKIT_BASE_URL }),
    new IndianRailApiProvider({ ...common, apiKey: config.INDIAN_RAIL_API_KEY, baseUrl: config.INDIAN_RAIL_API_BASE_URL }),
    new MockProvider({ failureRate: config.MOCK_FAILURE_RATE, now: options.now }),
  ];
  const scraperOptions = {
    userAgent: config.SCRAPER_USER_AGENT ?? `RailTrackLive/1.0 (+${config.APP_BASE_URL})`,
    timeoutMs: config.PROVIDER_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
    now: options.now,
  };
  const scraperFactories: Record<ScraperId, () => TrainDataProvider> = {
    railyatri: () => new RailYatriScraperProvider(scraperOptions),
    whereismytrain: () => new WhereIsMyTrainScraperProvider(scraperOptions),
  };
  providers.unshift(...scraperIds.map((id) => scraperFactories[id]()));
  return new ProviderRegistry(
    providers,
    config.TRAIN_DATA_PROVIDER,
    usage,
    config.PROVIDER_MAX_PER_MINUTE ? { maxPerMinute: config.PROVIDER_MAX_PER_MINUTE } : {},
    scraperIds.length
      ? {
          scraperIds,
          maxAttempts: config.SCRAPER_MAX_ATTEMPTS,
          cooldownMs: config.SCRAPER_COOLDOWN_MINUTES * 60_000,
          onEvent: options.onScrapeEvent,
        }
      : undefined,
  );
}
