import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { istWallClockToUtc, NormalizedTrainStatusSchema } from '@railtrack/shared';
import { ProviderError } from '../../src/lib/errors.ts';
import type { FetchLike } from '../../src/lib/http.ts';
import { IndianRailApiProvider, normalizeIndianRailLive, parse12h } from '../../src/providers/indianRailApi.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { normalizeRailKitLive, parseRailKitTime, RailKitProvider } from '../../src/providers/railkit.ts';
import { normalizeRailRadarLive, RailRadarProvider } from '../../src/providers/railradar.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const DATE = '2026-10-01';
const at = (hhmm: string, day = 1) => istWallClockToUtc(DATE, hhmm, day);

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const noSleep = async () => {};

describe('MockProvider (demo simulator)', () => {
  const provider = (now: Date) => new MockProvider({ now: () => now });

  it('labels every response as demo data and validates against the shared schema', async () => {
    const status = await provider(at('12:00')).getLiveStatus('12082', DATE);
    expect(status.provider.isDemo).toBe(true);
    expect(() => NormalizedTrainStatusSchema.parse(status)).not.toThrow();
  });

  it('is not started before departure, running mid-journey and arrived at the end', async () => {
    const before = await provider(at('03:00')).getLiveStatus('12082', DATE);
    expect(before.state).toBe('not_started');
    expect(before.nextStation?.code).toBe('CAN');
    expect(before.position?.kind).toBe('estimated');

    const mid = await provider(at('09:00')).getLiveStatus('12082', DATE);
    expect(['running', 'departed']).toContain(mid.state);
    expect(mid.lastReportedStation).not.toBeNull();
    expect(mid.nextStation).not.toBeNull();
    expect(mid.progressPercent).toBeGreaterThan(0);
    expect(mid.progressPercent).toBeLessThan(100);
    expect(mid.position?.kind).toBe('estimated');
    expect(mid.position?.basis).toMatch(/not (a )?GPS/i);

    const after = await provider(at('23:30')).getLiveStatus('12082', DATE);
    expect(after.state).toBe('arrived');
    expect(after.actualArrival).not.toBeNull();
    expect(after.progressPercent).toBe(100);
  });

  it('is deterministic for the same train, date and time', async () => {
    const a = await provider(at('09:00')).getLiveStatus('12627', DATE);
    const b = await provider(at('09:00')).getLiveStatus('12627', DATE);
    expect({ ...a, fetchedAt: '' }).toEqual({ ...b, fetchedAt: '' });
  });

  it('simulates a provider-reported coordinate for 12951', async () => {
    const s = await provider(at('13:00')).getLiveStatus('12951', DATE);
    expect(s.position?.kind).toBe('reported');
    expect(s.position?.basis).toMatch(/DEMO/);
  });

  it('covers cancellation, reschedule and diversion scenarios', async () => {
    const cancelled = await provider(at('15:00')).getLiveStatus('12859', DATE);
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.position).toBeNull();
    expect(cancelled.exceptions.map((e) => e.type)).toContain('cancellation');

    const rescheduled = await provider(at('10:30')).getLiveStatus('22691', DATE);
    expect(rescheduled.state).toBe('rescheduled');
    expect(rescheduled.exceptions[0]?.rescheduledByMinutes).toBe(150);

    const diverted = await provider(at('23:00')).getLiveStatus('12622', DATE);
    expect(diverted.state).toBe('diverted');
    expect(diverted.stops.filter((s) => s.status === 'skipped').map((s) => s.stationCode)).toEqual(['KZJ', 'WL']);
  });

  it('simulates provider failures and unknown trains', async () => {
    const p = provider(at('12:00'));
    await expect(p.getLiveStatus('99999', DATE)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 60 });
    await expect(p.getLiveStatus('99998', DATE)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(p.getLiveStatus('11111', DATE)).rejects.toMatchObject({ code: 'TRAIN_NOT_FOUND' });
  });

  it('returns a static route with HH:mm timings', async () => {
    const route = await provider(at('12:00')).getTrainRoute('12627');
    expect(route.stops[0]).toMatchObject({ stationCode: 'SBC', scheduledArrival: null, scheduledDeparture: '06:40' });
    expect(route.stops.at(-1)?.stationCode).toBe('NDLS');
    expect(route.totalDistanceKm).toBeGreaterThan(1500);
  });
});

describe('RailRadarProvider', () => {
  it('normalises the documented live payload', () => {
    const now = new Date('2026-06-22T19:50:00Z');
    const s = normalizeRailRadarLive(fixture('railradar-live.json').data, '12919', '2026-06-22', now);
    expect(s.trainName).toBe('Malwa SF Express');
    expect(s.state).toBe('diverted');
    expect(s.lastReportedStation).toEqual({ code: 'UJN', name: 'Ujjain Junction' });
    expect(s.lastReportedEvent).toBe('departed');
    expect(s.nextStation?.code).toBe('MKSM');
    expect(s.delayMinutes).toBe(12);
    expect(s.exceptions.map((e) => e.type)).toEqual(['diversion', 'skipped_stop']);
    // Segment progress is a provider figure, not a coordinate → estimated, clearly labelled.
    expect(s.position?.kind).toBe('estimated');
    expect(s.position?.basis).toMatch(/RailRadar's reported segment progress/);
    expect(s.stops[2]?.expectedArrival).toBe('2026-06-22T20:52:00.000Z');
    expect(s.stops[2]?.actualArrival).toBeNull();
    expect(s.providerUpdatedAt).toBe('2026-06-22T19:44:00.000Z');
  });

  it('sends the bearer key and the YYYY-MM-DD date, and validates output', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(200, fixture('railradar-live.json')));
    const p = new RailRadarProvider({ apiKey: 'rr_live_test', baseUrl: 'https://api.example/v1', timeoutMs: 1000, fetchImpl, sleep: noSleep });
    const s = await p.getLiveStatus('12919', '2026-06-22');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example/v1/trains/12919/live?date=2026-06-22&includeCoordinates=true');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer rr_live_test');
    expect(() => NormalizedTrainStatusSchema.parse(s)).not.toThrow();
  });

  it('maps errors and retries only transient failures', async () => {
    const make = (responses: Response[]) => {
      const fetchImpl = vi.fn<FetchLike>(async () => responses.shift()!);
      return { fetchImpl, p: new RailRadarProvider({ apiKey: 'k', baseUrl: 'https://x/v1', timeoutMs: 1000, fetchImpl, sleep: noSleep }) };
    };
    const auth = make([jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'bad key' } })]);
    await expect(auth.p.getLiveStatus('12919', DATE)).rejects.toMatchObject({ code: 'PROVIDER_AUTH_FAILED' });
    expect(auth.fetchImpl).toHaveBeenCalledTimes(1);

    const missing = make([jsonResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Train 99999 not found' } })]);
    await expect(missing.p.getLiveStatus('99999', DATE)).rejects.toMatchObject({ code: 'TRAIN_NOT_FOUND' });

    const flaky = make([jsonResponse(503, {}), jsonResponse(200, fixture('railradar-live.json'))]);
    await expect(flaky.p.getLiveStatus('12919', '2026-06-22')).resolves.toMatchObject({ trainNumber: '12919' });
    expect(flaky.fetchImpl).toHaveBeenCalledTimes(2);

    const limited = make([jsonResponse(429, {}, { 'retry-after': '120' })]);
    await expect(limited.p.getLiveStatus('12919', DATE)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 120 });
    expect(limited.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports not configured without making a request', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const p = new RailRadarProvider({ baseUrl: 'https://x/v1', timeoutMs: 1000, fetchImpl });
    expect(p.isConfigured()).toBe(false);
    await expect(p.getLiveStatus('12919', DATE)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect((await p.healthCheck()).status).toBe('not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('RailKitProvider (v1, NTES-backed)', () => {
  it('parses NTES-style times; an asterisk marks an expected time', () => {
    expect(parseRailKitTime('16:05 28-Aug', '2026-08-28')).toEqual({ iso: '2026-08-28T10:35:00.000Z', expected: false });
    expect(parseRailKitTime('20:40 28-Aug*', '2026-08-28')?.expected).toBe(true);
    expect(parseRailKitTime('SRC', '2026-08-28')).toBeNull();
    // Journey starting 31 Dec reaching on 1 Jan of the next year.
    expect(parseRailKitTime('06:00 01-Jan', '2026-12-31')?.iso).toBe('2027-01-01T00:30:00.000Z');
  });

  it('normalises the live timeline', () => {
    const s = normalizeRailKitLive(fixture('railkit-live.json').data, '12345', '2026-08-28', new Date('2026-08-28T13:00:00Z'));
    expect(s.trainName).toBe('Saraighat Exp');
    expect(s.state).toBe('departed');
    expect(s.lastReportedStation?.code).toBe('KGP');
    expect(s.lastReportedEvent).toBe('departed');
    expect(s.delayMinutes).toBe(22);
    expect(s.stops[2]).toMatchObject({ stationCode: 'TATA', isHalt: false, actualArrival: null, expectedArrival: '2026-08-28T15:10:00.000Z' });
  });

  it('uses DD-MM-YYYY in the URL, the x-api-key header, and never retries an exhausted quota', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(429, { success: false, error: 'Monthly usage limit exceeded' }));
    const p = new RailKitProvider({ apiKey: 'rk', baseUrl: 'https://api.railkit.example', timeoutMs: 1000, fetchImpl, sleep: noSleep });
    await expect(p.getLiveStatus('12345', '2026-08-28')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.railkit.example/api/v1/trains/12345/live/28-08-2026');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('rk');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('IndianRailApiProvider', () => {
  it('parses 12-hour times', () => {
    expect(parse12h('04:27PM')).toBe('16:27');
    expect(parse12h('12:05AM')).toBe('00:05');
    expect(parse12h('Source')).toBeNull();
  });

  it('normalises the live payload and infers day roll-over', () => {
    const s = normalizeIndianRailLive(fixture('indianrailapi-live.json'), '12565', '2026-09-15', new Date('2026-09-15T12:00:00Z'));
    expect(s.state).toBe('departed');
    expect(s.lastReportedStation?.code).toBe('JTB');
    expect(s.delayMinutes).toBe(14);
    expect(s.stops[2]?.scheduledArrival).toBe('2026-09-16T00:00:00.000Z');
    expect(s.stops[2]?.expectedArrival).toBe('2026-09-16T00:15:00.000Z');
  });

  it('keeps the API key (which lives in the URL path) out of error messages', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });
    const p = new IndianRailApiProvider({ apiKey: 'SECRET-KEY-123', baseUrl: 'https://irapi.example/api/v2', timeoutMs: 1000, fetchImpl, sleep: noSleep });
    const err = await p.getLiveStatus('12565', '2026-09-15').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(JSON.stringify({ message: (err as Error).message })).not.toContain('SECRET-KEY-123');
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/livetrainstatus/apikey/SECRET-KEY-123/trainnumber/12565/date/20260915/');
  });

  it('maps a non-200 ResponseCode to not found', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(200, { ResponseCode: '204', Message: 'No data' }));
    const p = new IndianRailApiProvider({ apiKey: 'k', baseUrl: 'https://irapi.example/api/v2', timeoutMs: 1000, fetchImpl, sleep: noSleep });
    await expect(p.getLiveStatus('12565', '2026-09-15')).rejects.toMatchObject({ code: 'TRAIN_NOT_FOUND' });
  });
});
