import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { NormalizedTrainStatusSchema, type NormalizedTrainStatus } from '@railtrack/shared';
import { ProviderError } from '../../src/lib/errors.ts';
import type { FetchLike } from '../../src/lib/http.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { finalizeStatus } from '../../src/providers/normalize.ts';
import { normalizeRailYatriLive, RailYatriScraperProvider, ScraperNotApplicableError } from '../../src/providers/railyatri.ts';
import { isPathAllowed, parseRobots } from '../../src/providers/robots.ts';
import { createProviderRegistry } from '../../src/providers/registry.ts';
import { ScrapeFirstProvider } from '../../src/providers/scrapeFirst.ts';
import type { TrainDataProvider } from '../../src/providers/types.ts';
import { testConfig } from '../helpers.ts';

/** Fixtures are trimmed copies of real public RailYatri pages captured on 2026-10-01. */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const asHtml = (pageProps: unknown) =>
  `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></body></html>`;
const ROBOTS = 'User-agent: *\nDisallow: /12756069/*\nDisallow: /intrcity/\n';
// 17:35 IST on 1 Oct 2026, shortly after the running fixture's last update (17:31 IST).
const NOW = new Date('2026-10-01T12:05:00Z');

function fakeSite(page: string, robots = ROBOTS) {
  return vi.fn<FetchLike>(async (url) => {
    if (url.endsWith('/robots.txt')) return new Response(robots, { status: 200 });
    return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
  });
}

function scraper(fetchImpl: FetchLike) {
  return new RailYatriScraperProvider({ userAgent: 'RailTrackLive/1.0 (+http://localhost:5173)', timeoutMs: 1000, fetchImpl, now: () => NOW });
}

describe('RailYatri scraper — parsing', () => {
  it('normalises a running (diverted) train from the embedded page data', () => {
    const s = normalizeRailYatriLive(fixture('railyatri-running.json'), '12627', '2026-09-30', NOW);
    expect(s.provider).toMatchObject({ id: 'railyatri', isDemo: false });
    expect(s.state).toBe('diverted');
    expect(s.lastReportedStation).toEqual({ code: 'BDI', name: 'Bhadli' });
    expect(s.lastReportedEvent).toBe('passed');
    expect(s.nextStation?.code).toBe('BSL');
    expect(s.delayMinutes).toBe(26);
    expect(s.exceptions[0]).toMatchObject({ type: 'diversion', stationCodes: ['BPL', 'MTJ'] });
    expect(s.providerUpdatedAt).toBe('2026-10-01T12:01:00.000Z');
    expect(s.stops.length).toBeGreaterThan(300);
    expect(s.stops.every((x) => x.lat !== null)).toBe(true);
    expect(() => NormalizedTrainStatusSchema.parse(s)).not.toThrow();
  });

  it('places reports from non-timetable points (signal cabins) on the route by distance', () => {
    const now = new Date('2026-10-01T12:10:00Z');
    const s = finalizeStatus('railyatri', normalizeRailYatriLive(fixture('railyatri-offroute.json'), '16525', '2026-10-01', now), now);
    expect(s.lastReportedStation).toEqual({ code: 'ERSD', name: 'Ernakulam D Cabin' });
    expect(s.lastReportedEvent).toBe('passed');
    expect(s.nextStation?.code).toBe('ERN');
    const ern = s.stops.findIndex((x) => x.stationCode === 'ERN');
    expect(s.stops[ern]!.status).toBe('upcoming');
    expect(s.stops[ern - 1]!.status).toBe('departed');
    expect(s.position).toMatchObject({ kind: 'estimated', segment: { toCode: 'ERN' } });
    expect(() => NormalizedTrainStatusSchema.parse(s)).not.toThrow();
  });

  it('normalises a train that has not started', () => {
    const s = normalizeRailYatriLive(fixture('railyatri-not-started.json'), '12627', '2026-10-01', NOW);
    expect(s.state).toBe('not_started');
    expect(s.lastReportedStation).toBeNull();
    expect(s.nextStation?.code).toBe('SBC');
    expect(s.nextStationEta).toBe('2026-10-01T13:50:00.000Z');
    expect(s.stops.every((x) => x.status === 'upcoming')).toBe(true);
  });
});

describe('RailYatri scraper — fetching', () => {
  it('checks robots.txt, identifies itself honestly and requests the right journey day', async () => {
    const fetchImpl = fakeSite(asHtml(fixture('railyatri-running.json')));
    const s = await scraper(fetchImpl).getLiveStatus('12627', '2026-09-30');
    expect(s.state).toBe('diverted');
    expect(s.position?.kind).toBe('estimated');
    const urls = fetchImpl.mock.calls.map(([u]) => u);
    expect(urls).toEqual(['https://www.railyatri.in/robots.txt', 'https://www.railyatri.in/live-train-status/12627?start_day=1']);
    expect(new Headers(fetchImpl.mock.calls[1]![1]?.headers).get('user-agent')).toBe('RailTrackLive/1.0 (+http://localhost:5173)');
  });

  it('does not fetch pages robots.txt disallows', async () => {
    const fetchImpl = fakeSite('unused', 'User-agent: *\nDisallow: /live-train-status/\n');
    await expect(scraper(fetchImpl).getLiveStatus('12627', '2026-10-01')).rejects.toBeInstanceOf(ScraperNotApplicableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never tries to get past a CAPTCHA or bot check', async () => {
    const fetchImpl = fakeSite('<html><div class="g-recaptcha">Please complete the captcha</div></html>');
    await expect(scraper(fetchImpl).getLiveStatus('12627', '2026-10-01')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: expect.stringMatching(/not bypassing/) });
  });

  it('maps an expired/unknown train to TRAIN_NOT_FOUND', async () => {
    const fetchImpl = fakeSite(asHtml(fixture('railyatri-expired.json')));
    await expect(scraper(fetchImpl).getLiveStatus('11111', '2026-10-01')).rejects.toMatchObject({ code: 'TRAIN_NOT_FOUND' });
  });

  it('does not attempt future journey dates (the page cannot show them)', async () => {
    const fetchImpl = fakeSite('unused');
    await expect(scraper(fetchImpl).getLiveStatus('12627', '2026-10-02')).rejects.toBeInstanceOf(ScraperNotApplicableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects pages for a different journey than requested', async () => {
    const fetchImpl = fakeSite(asHtml(fixture('railyatri-running.json')));
    await expect(scraper(fetchImpl).getLiveStatus('12627', '2026-10-01')).rejects.toBeInstanceOf(ScraperNotApplicableError);
  });
});

describe('robots.txt', () => {
  it('uses the most specific group and the longest matching rule', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/public$\n\nUser-agent: OtherBot\nDisallow: /\n', 'railtracklive');
    expect(isPathAllowed(rules, '/live-train-status/12627')).toBe(true);
    expect(isPathAllowed(rules, '/private/x')).toBe(false);
    expect(isPathAllowed(rules, '/private/public')).toBe(true);
    const ours = parseRobots('User-agent: *\nAllow: /\n\nUser-agent: RailTrackLive\nDisallow: /live-*\n', 'railtracklive');
    expect(isPathAllowed(ours, '/live-train-status/1')).toBe(false);
  });
});

describe('provider wiring', () => {
  it('puts the scraper in front of the configured API, but never in demo mode', () => {
    const registry = createProviderRegistry(testConfig({ TRAIN_DATA_PROVIDER: 'railradar', SCRAPER_PROVIDER: 'railyatri' }), () => {});
    expect(registry.active.id).toBe('railyatri');
    expect(registry.active.sourceIds).toEqual(['railyatri', 'railradar']);
    expect(registry.active.info.name).toBe('RailYatri (web) → RailRadar fallback');

    const demo = createProviderRegistry(testConfig({ TRAIN_DATA_PROVIDER: 'mock', SCRAPER_PROVIDER: 'railyatri' }), () => {});
    expect(demo.active.id).toBe('mock');
    expect(demo.list().map((p) => p.id)).not.toContain('railyatri');

    const apiOnly = createProviderRegistry(testConfig({ TRAIN_DATA_PROVIDER: 'railradar' }), () => {});
    expect(apiOnly.active.sourceIds).toEqual(['railradar']);
  });
});

describe('scrape first, API as fallback', () => {
  function fakeProvider(id: 'railyatri' | 'railradar', behaviour: () => Promise<NormalizedTrainStatus>, configured = true) {
    const getLiveStatus = vi.fn(behaviour);
    const inner = new MockProvider();
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
  }
  const status = (id: string) => ({ trainNumber: '12627', provider: { id } }) as unknown as NormalizedTrainStatus;
  const failing = () => Promise.reject(new ProviderError('railyatri', 'PROVIDER_UNAVAILABLE', 'page layout changed'));
  const options = { maxAttempts: 2, cooldownMs: 60_000, sleep: async () => {} };

  it('uses the scraped result when scraping works', async () => {
    const s = fakeProvider('railyatri', async () => status('railyatri'));
    const api = fakeProvider('railradar', async () => status('railradar'));
    const result = await new ScrapeFirstProvider(s.p, api.p, options).getLiveStatus('12627', '2026-10-01');
    expect(result.provider.id).toBe('railyatri');
    expect(api.getLiveStatus).not.toHaveBeenCalled();
  });

  it('tries scraping twice, then uses the API', async () => {
    const s = fakeProvider('railyatri', failing);
    const api = fakeProvider('railradar', async () => status('railradar'));
    const result = await new ScrapeFirstProvider(s.p, api.p, options).getLiveStatus('12627', '2026-10-01');
    expect(s.getLiveStatus).toHaveBeenCalledTimes(2);
    expect(result.provider.id).toBe('railradar');
  });

  it('goes straight to the API when the page cannot answer (no retries)', async () => {
    const s = fakeProvider('railyatri', () => Promise.reject(new ScraperNotApplicableError('railyatri', 'future date')));
    const api = fakeProvider('railradar', async () => status('railradar'));
    await new ScrapeFirstProvider(s.p, api.p, options).getLiveStatus('12627', '2026-10-05');
    expect(s.getLiveStatus).toHaveBeenCalledTimes(1);
    expect(api.getLiveStatus).toHaveBeenCalledTimes(1);
  });

  it('pauses scraping after two failed lookups in a row and uses only the API', async () => {
    const s = fakeProvider('railyatri', failing);
    const api = fakeProvider('railradar', async () => status('railradar'));
    const events: string[] = [];
    const provider = new ScrapeFirstProvider(s.p, api.p, { ...options, onEvent: (e) => events.push(e.type) });
    await provider.getLiveStatus('12627', '2026-10-01');
    await provider.getLiveStatus('12627', '2026-10-01');
    expect(s.getLiveStatus).toHaveBeenCalledTimes(4);
    expect(provider.scrapingPausedUntil).not.toBeNull();
    await provider.getLiveStatus('12627', '2026-10-01');
    expect(s.getLiveStatus).toHaveBeenCalledTimes(4);
    expect(api.getLiveStatus).toHaveBeenCalledTimes(3);
    expect(events).toContain('paused');
  });

  it('does not pause scraping when the site simply has no data for a train', async () => {
    const s = fakeProvider('railyatri', () => Promise.reject(new ProviderError('railyatri', 'TRAIN_NOT_FOUND', 'no data for this train')));
    const api = fakeProvider('railradar', async () => status('railradar'));
    const provider = new ScrapeFirstProvider(s.p, api.p, options);
    for (let i = 0; i < 3; i++) await provider.getLiveStatus('12082', '2026-10-01');
    expect(provider.scrapingPausedUntil).toBeNull();
    expect(s.getLiveStatus).toHaveBeenCalledTimes(6);
  });

  it('never pauses scraping when there is no configured API to fall back to', async () => {
    const s = fakeProvider('railyatri', failing);
    const api = fakeProvider('railradar', () => Promise.reject(new ProviderError('railradar', 'PROVIDER_NOT_CONFIGURED', 'no key')), false);
    const provider = new ScrapeFirstProvider(s.p, api.p, options);
    for (let i = 0; i < 3; i++) await provider.getLiveStatus('12627', '2026-10-01').catch(() => undefined);
    expect(provider.scrapingPausedUntil).toBeNull();
    expect(s.getLiveStatus).toHaveBeenCalledTimes(6);
  });

  it('reports the scraping error when the API is not configured', async () => {
    const s = fakeProvider('railyatri', failing);
    const api = fakeProvider('railradar', () => Promise.reject(new ProviderError('railradar', 'PROVIDER_NOT_CONFIGURED', 'no key')));
    await expect(new ScrapeFirstProvider(s.p, api.p, options).getLiveStatus('12627', '2026-10-01')).rejects.toThrow('page layout changed');
  });
});
