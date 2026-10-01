import type { NormalizedRoute, NormalizedTrainStatus, ProviderHealth, ProviderId, ProviderInfo } from '@railtrack/shared';
import { AppError } from '../lib/errors.ts';
import { sleep as defaultSleep } from '../lib/http.ts';
import { ScraperNotApplicableError } from './scrapeUtil.ts';
import type { ProviderLimits, TrainDataProvider } from './types.ts';

export interface ScrapeFirstOptions {
  /** Attempts per scraper per lookup before moving to the next source (default 2). */
  maxAttempts: number;
  /** After this many consecutive failed lookups, skip a scraper for `cooldownMs` (default = maxAttempts). */
  pauseAfterFailures?: number;
  cooldownMs: number;
  /** Wait between attempts on the same scraper. */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (event: { type: 'fallback' | 'paused'; provider: ProviderId; next: ProviderId; reason: string }) => void;
}

interface ScraperState {
  failures: number;
  pausedUntil: number;
}

/**
 * Web scraping first, API last. Sources are tried in order:
 *   scraper 1 (up to `maxAttempts` tries) → scraper 2 (…) → … → API.
 * A scraper that keeps failing for site-level reasons (blocked, down, layout changed) is skipped for a
 * cooldown, but only when a configured API exists to fall back to. Every result keeps the provider label
 * of the source that actually produced it.
 */
export class ScrapeFirstProvider implements TrainDataProvider {
  private readonly state = new Map<ProviderId, ScraperState>();
  private readonly scrapers: TrainDataProvider[];

  constructor(
    scrapers: TrainDataProvider | TrainDataProvider[],
    private readonly api: TrainDataProvider,
    private readonly options: ScrapeFirstOptions,
  ) {
    this.scrapers = Array.isArray(scrapers) ? scrapers : [scrapers];
    if (!this.scrapers.length) throw new Error('ScrapeFirstProvider needs at least one scraper');
    for (const s of this.scrapers) this.state.set(s.id, { failures: 0, pausedUntil: 0 });
  }

  get id(): ProviderId {
    return this.scrapers[0]!.id;
  }

  get info(): ProviderInfo {
    return {
      id: this.id,
      name: `${this.scrapers.map((s) => s.info.name).join(' → ')} → ${this.api.info.name} fallback`,
      isDemo: false,
      attribution: `Web scraping first; ${this.api.info.name} API used when scraping cannot answer.`,
    };
  }

  /** Provider ids whose results this source can return. */
  get sourceIds(): ProviderId[] {
    return [...this.scrapers.map((s) => s.id), this.api.id];
  }

  /** The strictest of all members' limits. */
  get limits(): ProviderLimits {
    const all = [...this.scrapers, this.api].map((p) => p.limits);
    return {
      maxConcurrent: Math.min(...all.map((l) => l.maxConcurrent)),
      minIntervalMs: Math.max(...all.map((l) => l.minIntervalMs)),
      liveCacheSeconds: Math.min(...all.map((l) => l.liveCacheSeconds)),
      routeCacheSeconds: Math.min(...all.map((l) => l.routeCacheSeconds)),
      minPollMinutes: Math.max(...all.map((l) => l.minPollMinutes)),
    };
  }

  get docsUrl(): string | null {
    return this.scrapers[0]!.docsUrl;
  }

  isConfigured(): boolean {
    return true;
  }

  /** Latest pause end among paused scrapers (null when none is paused). */
  get scrapingPausedUntil(): Date | null {
    const until = Math.max(0, ...[...this.state.values()].map((s) => s.pausedUntil));
    return until > Date.now() ? new Date(until) : null;
  }

  getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus> {
    return this.withFallback(
      (p) => p.getLiveStatus(trainNumber, journeyDate),
      () => this.api.getLiveStatus(trainNumber, journeyDate),
    );
  }

  getTrainRoute(trainNumber: string): Promise<NormalizedRoute> {
    return this.withFallback(
      (p) => p.getTrainRoute(trainNumber),
      () => this.api.getTrainRoute(trainNumber),
    );
  }

  async healthCheck(): Promise<ProviderHealth> {
    return this.scrapers[0]!.healthCheck();
  }

  private async withFallback<T>(scrape: (p: TrainDataProvider) => Promise<T>, useApi: () => Promise<T>): Promise<T> {
    const wait = this.options.sleep ?? defaultSleep;
    // Without a working API there is nothing to fall back to, so never skip a scraper in that case.
    const apiAvailable = this.api.isConfigured();
    const errors: unknown[] = [];

    for (const [index, scraper] of this.scrapers.entries()) {
      const st = this.state.get(scraper.id)!;
      if (apiAvailable && Date.now() < st.pausedUntil) continue;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
        try {
          const result = await scrape(scraper);
          st.failures = 0;
          return result;
        } catch (err) {
          lastError = err;
          // The page can't answer this request at all (e.g. a date it doesn't cover): retrying won't help.
          if (err instanceof ScraperNotApplicableError) break;
          if (attempt < this.options.maxAttempts) await wait(this.options.retryDelayMs ?? 1_000);
        }
      }
      errors.push(lastError);
      const next = this.scrapers[index + 1]?.id ?? this.api.id;
      // Only site-level problems pause a scraper. "No data for this train" says nothing about the site's health.
      if (apiAvailable && isSiteProblem(lastError)) {
        st.failures++;
        if (st.failures >= (this.options.pauseAfterFailures ?? this.options.maxAttempts)) {
          st.pausedUntil = Date.now() + this.options.cooldownMs;
          st.failures = 0;
          this.options.onEvent?.({ type: 'paused', provider: scraper.id, next, reason: errorMessage(lastError) });
        }
      }
      this.options.onEvent?.({ type: 'fallback', provider: scraper.id, next, reason: errorMessage(lastError) });
    }

    try {
      return await useApi();
    } catch (apiError) {
      // An unconfigured API says nothing useful; report the most informative scraping error instead.
      if (errors.length && apiError instanceof AppError && apiError.code === 'PROVIDER_NOT_CONFIGURED') throw mostInformative(errors);
      throw apiError;
    }
  }
}

/** Train-level answers ("no data for this train", a date the page doesn't cover) are not site failures. */
function isSiteProblem(err: unknown): boolean {
  if (err instanceof ScraperNotApplicableError) return false;
  return !(err instanceof AppError && (err.code === 'TRAIN_NOT_FOUND' || err.code === 'NOT_RUNNING_ON_DATE'));
}

/** Prefer a real answer ("not found") over "this page can't answer", then the first error. */
function mostInformative(errors: unknown[]): unknown {
  return (
    errors.find((e) => e instanceof AppError && (e.code === 'TRAIN_NOT_FOUND' || e.code === 'NOT_RUNNING_ON_DATE')) ??
    errors.find((e) => !(e instanceof ScraperNotApplicableError)) ??
    errors[0]
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}
