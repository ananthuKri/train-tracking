import { describe, expect, it } from 'vitest';
import { REPORT_FIELD_IDS } from '@railtrack/shared';
import { parseRetryAfter } from '@/api/client';
import { exportSearchParams, parseFilterParams, writeFilterParams } from './filterParams';
import { parseTrainRefs, serializeTrainRefs, trainDetailPath } from './trainKey';
import { safeNextPath } from './utils';

describe('trainKey', () => {
  it('round-trips ?trains= lists and drops junk', () => {
    const refs = parseTrainRefs('12082:2026-10-01, 12627:2026-10-01,bad,1234:2026-10-01,12082:2026-10-01,12082:2026-13-40');
    expect(refs).toEqual([
      { trainNumber: '12082', journeyDate: '2026-10-01' },
      { trainNumber: '12627', journeyDate: '2026-10-01' },
    ]);
    expect(serializeTrainRefs(refs)).toBe('12082:2026-10-01,12627:2026-10-01');
    expect(trainDetailPath(refs[0]!)).toBe('/trains/12082?date=2026-10-01');
  });
});

describe('filterParams', () => {
  it('parses filters and sort from the URL, ignoring invalid params individually', () => {
    const { filters, sort } = parseFilterParams(
      new URLSearchParams('q=kota&statuses=running,bogus&minDelay=10&sort=largest_delay&providers=mock'),
    );
    expect(sort).toBe('largest_delay');
    expect(filters).toEqual({ q: 'kota', minDelay: 10, providers: ['mock'] });
  });

  it('defaults to latest_update and omits it when writing', () => {
    expect(parseFilterParams(new URLSearchParams()).sort).toBe('latest_update');
    expect(writeFilterParams({ statuses: ['running', 'departed'] }, 'latest_update').toString()).toBe('statuses=running%2Cdeparted');
    expect(writeFilterParams({}, 'train_number').toString()).toBe('sort=train_number');
  });

  it('builds the export query with trains, fields, sort and filters', () => {
    const params = exportSearchParams(
      [
        { trainNumber: '12082', journeyDate: '2026-10-01' },
        { trainNumber: '12627', journeyDate: '2026-10-01' },
      ],
      { statuses: ['running'], minDelay: 5 },
      'largest_delay',
    );
    expect(params.get('trains')).toBe('12082:2026-10-01,12627:2026-10-01');
    expect(params.get('fields')).toBe(REPORT_FIELD_IDS.join(','));
    expect(params.get('sort')).toBe('largest_delay');
    expect(params.get('statuses')).toBe('running');
    expect(params.get('minDelay')).toBe('5');
  });
});

describe('parseRetryAfter', () => {
  it('handles delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('42')).toBe(42);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('nonsense')).toBeNull();
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Oct 2026 00:00:30 GMT', now)).toBe(30);
  });
});

describe('safeNextPath', () => {
  it('only allows same-site relative paths', () => {
    expect(safeNextPath('/reports/new?trains=12082:2026-10-01')).toBe('/reports/new?trains=12082:2026-10-01');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
