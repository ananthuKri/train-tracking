import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { NormalizedTrainStatusSchema, type NormalizedTrainStatus } from '@railtrack/shared';
import { ProviderError } from '../../src/lib/errors.ts';
import type { FetchLike } from '../../src/lib/http.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { finalizeStatus } from '../../src/providers/normalize.ts';
import { createProviderRegistry } from '../../src/providers/registry.ts';
import { ScrapeFirstProvider } from '../../src/providers/scrapeFirst.ts';
import { looksLikeBotChallenge, ScraperNotApplicableError } from '../../src/providers/scrapeUtil.ts';
import type { TrainDataProvider } from '../../src/providers/types.ts';
import { normalizeWimtLive, parseWimtPage, WhereIsMyTrainScraperProvider } from '../../src/providers/whereIsMyTrain.ts';
import { testConfig } from '../helpers.ts';

/** Fixtures are real public whereismytrain.org.in pages captured on 2026-10-01 (scripts removed). */
const html = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
// 18:00 IST on 1 Oct 2026, a few minutes after the 12627 fixture's "Last Updated: 05:57:11 PM".
const NOW = new Date('2026-10-01T12:30:00Z');

describe('WhereIsMyTrain.org.in scraper', () => {
  it('parses the server-rendered station cards', () => {
    const page = parseWimtPage(html('wimt-12627.html'));
    expect(page).toMatchObject({ trainNumber: '12627', trainName: 'Karnataka Express', lastUpdated: '05:57:11 PM', delayText: '36min Late' });
    expect(page.cards).toHaveLength(36);
    expect(page.cards[0]).toMatchObject({ code: 'SBC', name: 'KSR Bengaluru City Jn', state: 'passed', platform: '2' });
    expect(page.cards.findIndex((c) => c.hasTrainMarker)).toBe(24);
    expect(page.cards[1]!.arrival).toEqual({ main: '07:46 PM', scheduled: '07:31 PM' });
  });

  it('works out the journey date from the times and normalises a running train', () => {
    const s = finalizeStatus('whereismytrain', normalizeWimtLive(parseWimtPage(html('wimt-12627.html')), '12627', '2026-09-30', NOW), NOW);
    expect(s.provider).toMatchObject({ id: 'whereismytrain', isDemo: false });
    expect(s.state).toBe('departed');
    expect(s.lastReportedStation).toEqual({ code: 'DSK', name: 'Duskheda' });
    expect(s.nextStation).toEqual({ code: 'BAU', name: 'Burhanpur' });
    expect(s.delayMinutes).toBe(36);
    expect(s.providerUpdatedAt).toBe('2026-10-01T12:27:00.000Z');
    expect(s.stops[1]!.actualArrival).toBe('2026-09-30T14:16:00.000Z');
    expect(s.stops[25]!.expectedArrival).toBe('2026-10-01T13:07:00.000Z');
    expect(() => NormalizedTrainStatusSchema.parse(s)).not.toThrow();
  });

  it('refuses journeys it cannot date: other dates, finished/unknown trains, stale pages', () => {
    const page = parseWimtPage(html('wimt-12627.html'));
    expect(() => normalizeWimtLive(page, '12627', '2026-10-01', NOW)).toThrow(ScraperNotApplicableError);
    expect(() => normalizeWimtLive(parseWimtPage(html('wimt-11111.html')), '11111', '2026-10-01', NOW)).toThrow(ScraperNotApplicableError);
    expect(() => normalizeWimtLive(page, '12627', '2026-09-30', new Date('2026-10-02T06:00:00Z'))).toThrow(/out of date/);
  });

  it('ignores the passive Cloudflare script but treats a real challenge page as a failure', async () => {
    const passive = { status: 200, headers: new Headers(), text: '<html><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></html>' };
    expect(looksLikeBotChallenge(passive)).toBe(false);
    const challenge = { status: 403, headers: new Headers({ 'cf-mitigated': 'challenge' }), text: '<title>Just a moment...</title>' };
    expect(looksLikeBotChallenge(challenge)).toBe(true);

    const fetchImpl = vi.fn<FetchLike>(async (url) =>
      url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow:\n') : new Response('<title>Just a moment...</title>', { status: 403 }),
    );
    const p = new WhereIsMyTrainScraperProvider({ userAgent: 'RailTrackLive/1.0', timeoutMs: 1000, fetchImpl, now: () => NOW });
    await expect(p.getLiveStatus('12627', '2026-09-30')).rejects.toThrow(/not bypassing/);
    const pageRequest = fetchImpl.mock.calls.find(([u]) => u.includes('trainNo'))!;
    // No browser cookies (e.g. cf_clearance) are ever sent.
    expect(new Headers(pageRequest[1]?.headers).get('cookie')).toBeNull();
  });
});

describe('scraper chain', () => {
  const make = (id: 'railyatri' | 'whereismytrain' | 'railradar', behaviour: () => Promise<NormalizedTrainStatus>, configured = true) => {
    const inner = new MockProvider();
    const getLiveStatus = vi.fn(behaviour);
    const p: TrainDataProvider = {
      id,
      info: { id, name: id, isDemo: false, attribution: null },
      limits: inner.limits,
      docsUrl: null,
      isConfigured: () => configured,
      getLiveStatus,
      getTrainRoute: (n) => inner.getTrainRoute(n),
      healthCheck: () => inner.healthCheck(),
    };
    return { p, getLiveStatus };
  };
  const ok = (id: string) => async () => ({ provider: { id } }) as unknown as NormalizedTrainStatus;
  const down = () => Promise.reject(new ProviderError('x', 'PROVIDER_UNAVAILABLE', 'site down'));
  const opts = { maxAttempts: 2, cooldownMs: 60_000, sleep: async () => {} };

  it('tries each scraper twice in order before the API', async () => {
    const a = make('railyatri', down);
    const b = make('whereismytrain', ok('whereismytrain'));
    const api = make('railradar', ok('railradar'));
    const result = await new ScrapeFirstProvider([a.p, b.p], api.p, opts).getLiveStatus('12627', '2026-10-01');
    expect(result.provider.id).toBe('whereismytrain');
    expect(a.getLiveStatus).toHaveBeenCalledTimes(2);
    expect(b.getLiveStatus).toHaveBeenCalledTimes(1);
    expect(api.getLiveStatus).not.toHaveBeenCalled();
  });

  it('uses the API only after every scraper has failed', async () => {
    const a = make('railyatri', () => Promise.reject(new ScraperNotApplicableError('railyatri', 'future date')));
    const b = make('whereismytrain', down);
    const api = make('railradar', ok('railradar'));
    const result = await new ScrapeFirstProvider([a.p, b.p], api.p, opts).getLiveStatus('12627', '2026-10-01');
    expect(result.provider.id).toBe('railradar');
    expect(a.getLiveStatus).toHaveBeenCalledTimes(1);
    expect(b.getLiveStatus).toHaveBeenCalledTimes(2);
  });

  it('reports "not found" from a scraper when there is no API key', async () => {
    const a = make('railyatri', () => Promise.reject(new ProviderError('railyatri', 'TRAIN_NOT_FOUND', 'no data for 12082')));
    const b = make('whereismytrain', () => Promise.reject(new ScraperNotApplicableError('whereismytrain', 'not en route')));
    const api = make('railradar', () => Promise.reject(new ProviderError('railradar', 'PROVIDER_NOT_CONFIGURED', 'no key')), false);
    await expect(new ScrapeFirstProvider([a.p, b.p], api.p, opts).getLiveStatus('12082', '2026-10-01')).rejects.toMatchObject({
      code: 'TRAIN_NOT_FOUND',
    });
  });

  it('is configured from SCRAPER_PROVIDERS in order', () => {
    const registry = createProviderRegistry(testConfig({ TRAIN_DATA_PROVIDER: 'railradar', SCRAPER_PROVIDERS: 'railyatri, whereismytrain' }), () => {});
    expect(registry.active.sourceIds).toEqual(['railyatri', 'whereismytrain', 'railradar']);
    expect(registry.active.info.name).toBe('RailYatri (web) → WhereIsMyTrain.org.in (web) → RailRadar fallback');
  });
});

describe('coordinate enrichment', () => {
  it('borrows coordinates and distances from the route for sources that have none', async () => {
    const { TrackingService } = await import('../../src/services/trackingService.ts');
    const { ProviderRegistry } = await import('../../src/providers/registry.ts');
    const { MemoryCache } = await import('../../src/lib/cache.ts');
    const { createLogger } = await import('../../src/lib/logger.ts');
    const mock = new MockProvider({ now: () => new Date('2026-10-01T03:30:00Z') });
    const live = await mock.getLiveStatus('12082', '2026-10-01');
    // Simulate a scraped source without coordinates or distances.
    const bare = { ...live, position: null, progressPercent: null, distanceTravelledKm: null, distanceRemainingKm: null, stops: live.stops.map((s) => ({ ...s, lat: null, lng: null, distanceKm: null })) };
    const source: TrainDataProvider = {
      id: 'whereismytrain',
      info: { id: 'whereismytrain', name: 'wimt', isDemo: false, attribution: null },
      limits: mock.limits,
      docsUrl: null,
      isConfigured: () => true,
      getLiveStatus: async () => bare,
      getTrainRoute: (n) => mock.getTrainRoute(n),
      healthCheck: () => mock.healthCheck(),
    };
    const tracking = new TrackingService({
      providers: new ProviderRegistry([source], 'whereismytrain', () => {}),
      cache: new MemoryCache(),
      db: null,
      logger: createLogger({ level: 'silent' }),
      now: () => new Date('2026-10-01T03:30:00Z'),
    });
    const result = await tracking.getLiveStatus('12082', '2026-10-01');
    expect(result.status!.stops.every((s) => s.lat !== null && s.distanceKm !== null)).toBe(true);
    expect(result.status!.position?.kind).toBe('estimated');
    expect(result.status!.progressPercent).not.toBeNull();
  });
});
