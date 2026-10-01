import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { istWallClockToUtc, todayInIst, type AlertRules, type NormalizedTrainStatus } from '@railtrack/shared';
import { MemoryCache } from '../../src/lib/cache.ts';
import { hashPassword, verifyPassword } from '../../src/lib/crypto.ts';
import { ProviderError } from '../../src/lib/errors.ts';
import { backoffDelay, DEFAULT_RETRY_POLICY, parseRetryAfter, withRetry } from '../../src/lib/http.ts';
import { createLogger } from '../../src/lib/logger.ts';
import { RateLimiter } from '../../src/lib/rateLimiter.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { ProviderRegistry } from '../../src/providers/registry.ts';
import type { TrainDataProvider } from '../../src/providers/types.ts';
import { evaluateAlerts, summarize } from '../../src/services/alertRules.ts';
import { redactStatus } from '../../src/services/emailReportService.ts';
import { buildReport, escapeHtml } from '../../src/services/reportBuilder.ts';
import { TrackingService } from '../../src/services/trackingService.ts';
import { buildUploadPreview, detectFileType } from '../../src/services/uploadService.ts';

const DATE = '2026-10-01';
const at = (hhmm: string) => istWallClockToUtc(DATE, hhmm);
const demoStatus = (train: string, hhmm: string) => new MockProvider({ now: () => at(hhmm) }).getLiveStatus(train, DATE);

describe('retry with exponential backoff', () => {
  it('retries retryable provider errors and then succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new ProviderError('x', 'PROVIDER_UNAVAILABLE', 'down', { retryable: true });
        return 'ok';
      },
      DEFAULT_RETRY_POLICY,
      { sleep: async (ms) => void sleeps.push(ms), random: () => 1 },
    );
    expect(result).toBe('ok');
    expect(sleeps).toEqual([500, 1000]);
  });

  it('does not retry non-retryable errors or long Retry-After waits', async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError('x', 'PROVIDER_AUTH_FAILED', 'no');
    });
    await expect(withRetry(fn, DEFAULT_RETRY_POLICY, { sleep: async () => {} })).rejects.toThrow('no');
    expect(fn).toHaveBeenCalledTimes(1);

    const limited = vi.fn(async () => {
      throw new ProviderError('x', 'RATE_LIMITED', 'slow', { retryable: true, retryAfterSeconds: 60 });
    });
    await expect(withRetry(limited, DEFAULT_RETRY_POLICY, { sleep: async () => {} })).rejects.toThrow('slow');
    expect(limited).toHaveBeenCalledTimes(1);
  });

  it('caps backoff and parses Retry-After', () => {
    expect(backoffDelay(10, DEFAULT_RETRY_POLICY, () => 1)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())).toBeGreaterThanOrEqual(9);
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('RateLimiter', () => {
  it('limits concurrency and spaces request starts', async () => {
    const limiter = new RateLimiter({ name: 't', maxConcurrent: 2, minIntervalMs: 20 });
    let active = 0;
    let peak = 0;
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, () =>
        limiter.schedule(async () => {
          starts.push(Date.now());
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 30));
          active--;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(15);
  });

  it('rejects when the queue is full', async () => {
    const limiter = new RateLimiter({ name: 't', maxConcurrent: 1, minIntervalMs: 0, maxQueue: 1 });
    const slow = () => new Promise((r) => setTimeout(r, 50));
    const first = limiter.schedule(slow);
    const second = limiter.schedule(slow);
    await expect(limiter.schedule(slow)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await Promise.all([first, second]);
  });
});

describe('TrackingService', () => {
  function setup(provider: TrainDataProvider) {
    const registry = new ProviderRegistry([provider], provider.id, () => {});
    const cache = new MemoryCache();
    const tracking = new TrackingService({ providers: registry, cache, db: null, logger: createLogger({ level: 'silent' }) });
    return { tracking, cache };
  }

  function flakyProvider(): TrainDataProvider & { fail: boolean; calls: number } {
    const inner = new MockProvider({ now: () => at('09:00') });
    const p = {
      id: 'mock' as const,
      info: inner.info,
      limits: { ...inner.limits, liveCacheSeconds: 0.05 },
      docsUrl: null,
      fail: false,
      calls: 0,
      isConfigured: () => true,
      async getLiveStatus(n: string, d: string) {
        p.calls++;
        if (p.fail) throw new ProviderError('mock', 'PROVIDER_UNAVAILABLE', 'outage', { retryable: false });
        return inner.getLiveStatus(n, d);
      },
      getTrainRoute: (n: string) => inner.getTrainRoute(n),
      healthCheck: () => inner.healthCheck(),
    };
    return p;
  }

  it('serves repeated requests from the cache', async () => {
    const provider = flakyProvider();
    const { tracking } = setup(provider);
    const first = await tracking.getLiveStatus('12082', DATE);
    const second = await tracking.getLiveStatus('12082', DATE);
    expect(first.status?.freshness).toBe('live');
    expect(second.status?.freshness).toBe('cached');
    expect(provider.calls).toBe(1);
  });

  it('coalesces concurrent requests for the same train', async () => {
    const provider = flakyProvider();
    const { tracking } = setup(provider);
    await Promise.all([tracking.getLiveStatus('12082', DATE), tracking.getLiveStatus('12082', DATE), tracking.getLiveStatus('12082', DATE)]);
    expect(provider.calls).toBe(1);
  });

  it('falls back to the last verified result, clearly labelled, when the provider fails', async () => {
    const provider = flakyProvider();
    const { tracking } = setup(provider);
    await tracking.getLiveStatus('12082', DATE);
    await new Promise((r) => setTimeout(r, 80)); // let the live cache expire
    provider.fail = true;
    const result = await tracking.getLiveStatus('12082', DATE);
    expect(result.ok).toBe(true);
    expect(result.error?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(result.status?.freshness).toBe('stale');
    expect(result.status?.notice).toMatch(/Live data temporarily unavailable/);
  });

  it('returns a safe error (no stale data) when nothing was ever verified', async () => {
    const provider = flakyProvider();
    provider.fail = true;
    const { tracking } = setup(provider);
    const result = await tracking.getLiveStatus('12082', DATE);
    expect(result).toMatchObject({ ok: false, status: null, error: { code: 'PROVIDER_UNAVAILABLE' } });
  });

  it('tracks many trains and keeps input order', async () => {
    const { tracking } = setup(new MockProvider({ now: () => at('09:00') }));
    const { results } = await tracking.trackMany(
      ['12627', '11111', '12082'].map((trainNumber) => ({ trainNumber, journeyDate: DATE })),
      { source: 'MANUAL' },
    );
    expect(results.map((r) => [r.trainNumber, r.ok])).toEqual([
      ['12627', true],
      ['11111', false],
      ['12082', true],
    ]);
    expect(results[1]?.error?.code).toBe('TRAIN_NOT_FOUND');
  });
});

describe('alert rules', () => {
  const rules: AlertRules = { nextStation: true, delayAboveMinutes: 10, exceptions: true, arrival: true };

  it('uses the first check as a baseline for station changes', async () => {
    const s = await demoStatus('12082', '09:00');
    const first = evaluateAlerts(null, s, { ...rules, delayAboveMinutes: null }, []);
    expect(first.alerts.filter((a) => a.key.startsWith('station:'))).toHaveLength(0);
  });

  it('alerts when the train reaches a new station, once', async () => {
    const earlier = await demoStatus('12082', '07:00');
    const later = await demoStatus('12082', '09:00');
    const r = evaluateAlerts(summarize(earlier), later, { ...rules, delayAboveMinutes: null }, []);
    expect(r.alerts.some((a) => a.key === `station:${later.lastReportedStation!.code}`)).toBe(true);
    const again = evaluateAlerts(summarize(earlier), later, { ...rules, delayAboveMinutes: null }, r.fired);
    expect(again.alerts).toHaveLength(0);
  });

  it('alerts on delay above threshold with hysteresis', async () => {
    const s = await demoStatus('12082', '09:00');
    const late = { ...s, delayMinutes: 25 };
    const r1 = evaluateAlerts(summarize(s), late, rules, []);
    expect(r1.alerts.map((a) => a.key)).toContain('delay-above:10');
    const stillLate = evaluateAlerts(summarize(late), { ...s, delayMinutes: 30 }, rules, r1.fired);
    expect(stillLate.alerts.map((a) => a.key)).not.toContain('delay-above:10');
    const recovered = evaluateAlerts(summarize(late), { ...s, delayMinutes: 2 }, rules, r1.fired);
    expect(recovered.fired).not.toContain('delay-above:10');
  });

  it('alerts immediately on diversion/cancellation and marks arrival terminal', async () => {
    const diverted = await demoStatus('12622', '23:00');
    expect(evaluateAlerts(null, diverted, rules, []).alerts.map((a) => a.key)).toContain('exception:diversion');
    const cancelled = await demoStatus('12859', '15:00');
    const c = evaluateAlerts(null, cancelled, rules, []);
    expect(c.alerts.map((a) => a.key)).toContain('exception:cancellation');
    expect(c.terminal).toBe(true);
    const arrived = await demoStatus('12082', '23:00');
    const a = evaluateAlerts(null, arrived, rules, []);
    expect(a.alerts.map((x) => x.key)).toContain('arrival');
    expect(a.terminal).toBe(true);
  });

  it('never alerts from stale fallback data', async () => {
    const s = await demoStatus('12622', '23:00');
    const r = evaluateAlerts(null, { ...s, freshness: 'stale' }, rules, []);
    expect(r.alerts).toHaveLength(0);
    expect(r.terminal).toBe(false);
  });
});

describe('report builder', () => {
  it('escapes provider text, labels demo data and builds a CSV of selected fields', async () => {
    const s = await demoStatus('12082', '09:00');
    const evil: NormalizedTrainStatus = { ...s, trainName: '<script>alert(1)</script>', notice: null };
    const report = buildReport({ statuses: [evil], failures: [], fields: ['identity', 'delays'], appBaseUrl: 'http://app' });
    expect(report.html).not.toContain('<script>alert(1)</script>');
    expect(report.html).toContain('&lt;script&gt;');
    expect(report.html).toContain('DEMO DATA');
    expect(report.subject.startsWith('[DEMO]')).toBe(true);
    const [header] = report.csv.replace(/^﻿/, '').split('\r\n');
    expect(header).toBe('Train Number,Train Name,Journey Date,Status,Delay (min)');
  });

  it('neutralises spreadsheet formulas in CSV cells', async () => {
    const s = await demoStatus('12082', '09:00');
    const report = buildReport({ statuses: [{ ...s, trainName: '=HYPERLINK("http://evil")' }], failures: [], fields: ['identity'], appBaseUrl: 'http://app' });
    expect(report.csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;');
  });
});

describe('share-link redaction', () => {
  it('removes fields the sender did not select', async () => {
    const s = await demoStatus('12082', '09:00');
    const r = redactStatus(s, ['identity']);
    expect(r.delayMinutes).toBeNull();
    expect(r.position).toBeNull();
    expect(r.nextStation).toBeNull();
    expect(r.stops).toEqual([]);
    expect(r.provider).toEqual(s.provider);
    const withMap = redactStatus(s, ['identity', 'mapLink']);
    expect(withMap.stops.length).toBe(s.stops.length);
    expect(withMap.stops.every((st) => st.actualArrival === null && st.platform === null)).toBe(true);
  });
});

describe('upload parsing', () => {
  const today = todayInIst();

  it('parses CSV with alias headers, restores nothing for text and flags invalid rows', () => {
    const csv = `Train No,Date,Email\n12082,${today},ops@example.com\n123,,\n12627,,not-an-email\n`;
    const preview = buildUploadPreview('trains.csv', Buffer.from(csv), today);
    expect(preview.detectedColumns).toEqual({ trainNumber: 'Train No', journeyDate: 'Date', email: 'Email' });
    expect(preview.rows.map((r) => r.valid)).toEqual([true, false, false]);
    expect(preview.rows[1]?.errors[0]).toMatch(/5 digits/);
  });

  it('parses XLSX, including numeric train numbers that lost a leading zero and Excel date serials', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['trainNumber', 'journey_date'],
      [12082, today],
      [1045, ''],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Trains');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const preview = buildUploadPreview('trains.xlsx', buffer, today);
    expect(preview.fileType).toBe('xlsx');
    expect(preview.sheetName).toBe('Trains');
    expect(preview.rows[0]).toMatchObject({ trainNumber: '12082', valid: true });
    expect(preview.rows[1]).toMatchObject({ trainNumber: '01045', valid: true });
    expect(preview.rows[1]?.warnings[0]).toMatch(/Leading zero restored/);
  });

  it('rejects files whose content does not match the extension', () => {
    expect(() => detectFileType('x.xlsx', Buffer.from('train_number\n12082'))).toThrow(/not a valid Excel/);
    expect(() => detectFileType('x.exe', Buffer.from('MZ'))).toThrow(/\.csv, \.xlsx or \.xls/);
    expect(() => buildUploadPreview('x.csv', Buffer.from('foo,bar\n1,2\n'), today)).toThrow(/No train number column/);
  });
});

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
