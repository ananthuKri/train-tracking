import { describe, expect, it } from 'vitest';
import {
  addDaysToDate,
  buildRouteGeometry,
  checkJourneyDate,
  deriveProgress,
  escapeCsvCell,
  estimatePosition,
  excelSerialToIsoDate,
  filterResults,
  filtersToSearchParams,
  formatDelay,
  formatIst,
  istWallClockToUtc,
  parseFlexibleDate,
  parseTrainNumbers,
  pointAtDistance,
  positionToRouteKm,
  projectOntoRoute,
  resolveReportFields,
  sortResults,
  toCsv,
  todayInIst,
  TrainFiltersQuerySchema,
  uniqueValidItems,
  uploadErrorRows,
  validateUploadRows,
  type NormalizedStop,
  type NormalizedTrainStatus,
  type TrackResult,
} from '../src/index';

describe('train numbers', () => {
  it('splits on commas/whitespace, validates and de-duplicates', () => {
    expect(parseTrainNumbers('12082, 12627 16348;12082\n01045')).toEqual({ valid: ['12082', '12627', '16348', '01045'], invalid: [], duplicates: ['12082'] });
    const r = parseTrainNumbers('1234, abcde, 123456');
    expect(r.valid).toEqual([]);
    expect(r.invalid.map((i) => i.reason)).toEqual([
      'Train numbers have 5 digits (add a leading 0 for special trains)',
      'Train numbers may only contain digits',
      'Train numbers have exactly 5 digits',
    ]);
  });
});

describe('IST dates', () => {
  it('converts between UTC instants and IST wall-clock', () => {
    expect(todayInIst(new Date('2026-09-30T18:29:00Z'))).toBe('2026-09-30');
    expect(todayInIst(new Date('2026-09-30T18:30:00Z'))).toBe('2026-10-01');
    expect(istWallClockToUtc('2026-10-01', '05:30').toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(istWallClockToUtc('2026-10-01', '01:00', 2).toISOString()).toBe('2026-10-01T19:30:00.000Z');
    expect(formatIst('2026-10-01T00:00:00Z', 'time')).toBe('05:30');
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('limits journey dates to a provider-supported window', () => {
    const now = new Date('2026-10-01T06:00:00Z');
    expect(checkJourneyDate('2026-10-01', now).ok).toBe(true);
    expect(checkJourneyDate('2026-09-20', now).ok).toBe(false);
    expect(checkJourneyDate('2026-10-09', now).ok).toBe(false);
    expect(checkJourneyDate('2026-02-30', now).ok).toBe(false);
  });

  it('parses spreadsheet dates (day-first) and Excel serials', () => {
    expect(parseFlexibleDate('01-10-2026')).toBe('2026-10-01');
    expect(parseFlexibleDate('1/10/2026')).toBe('2026-10-01');
    expect(parseFlexibleDate('2026/10/01')).toBe('2026-10-01');
    expect(parseFlexibleDate(46296)).toBe(excelSerialToIsoDate(46296));
    expect(excelSerialToIsoDate(45658)).toBe('2025-01-01');
    expect(parseFlexibleDate('31-02-2026')).toBeNull();
    expect(parseFlexibleDate('tomorrow')).toBeNull();
  });
});

describe('CSV', () => {
  it('quotes and neutralises formula injection', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('@cmd')).toBe("'@cmd");
    expect(escapeCsvCell(-5)).toBe('-5');
    expect(toCsv(['a', 'b'], [[1, null]])).toBe('a,b\r\n1,\r\n');
  });

  it('resolves report fields to canonical order', () => {
    expect(resolveReportFields(['delays', 'identity', 'delays'])).toEqual(['identity', 'delays']);
    expect(resolveReportFields(undefined)).toHaveLength(12);
  });
});

const stop = (code: string, lat: number, lng: number, km: number, extra: Partial<NormalizedStop> = {}): NormalizedStop => ({
  sequence: 1,
  stationCode: code,
  stationName: `${code} station`,
  lat,
  lng,
  distanceKm: km,
  day: 1,
  platform: null,
  isHalt: true,
  scheduledArrival: null,
  scheduledDeparture: null,
  actualArrival: null,
  actualDeparture: null,
  expectedArrival: null,
  expectedDeparture: null,
  arrivalDelayMinutes: null,
  departureDelayMinutes: null,
  status: 'upcoming',
  ...extra,
});

function status(overrides: Partial<NormalizedTrainStatus> = {}): NormalizedTrainStatus {
  return {
    trainNumber: '12082',
    trainName: 'Test Express',
    journeyDate: '2026-10-01',
    source: { code: 'AAA', name: 'Alpha' },
    destination: { code: 'CCC', name: 'Charlie' },
    scheduledDeparture: null,
    scheduledArrival: null,
    actualDeparture: null,
    actualArrival: null,
    expectedArrival: null,
    state: 'departed',
    stateDetail: null,
    lastReportedStation: { code: 'AAA', name: 'Alpha' },
    lastReportedEvent: 'departed',
    lastReportedAt: '2026-10-01T04:00:00.000Z',
    previousStation: null,
    nextStation: { code: 'BBB', name: 'Bravo' },
    nextStationEta: '2026-10-01T05:00:00.000Z',
    delayMinutes: 10,
    platform: null,
    distanceTravelledKm: null,
    distanceRemainingKm: null,
    totalDistanceKm: 200,
    progressPercent: null,
    position: null,
    stops: [
      stop('AAA', 10, 76, 0, { status: 'departed', actualDeparture: '2026-10-01T04:00:00.000Z' }),
      stop('BBB', 11, 76, 100, { expectedArrival: '2026-10-01T05:00:00.000Z' }),
      stop('CCC', 12, 76, 200),
    ],
    exceptions: [],
    provider: { id: 'mock', name: 'Demo simulator', isDemo: true, attribution: null },
    providerUpdatedAt: '2026-10-01T04:30:00.000Z',
    fetchedAt: '2026-10-01T04:31:00.000Z',
    freshness: 'live',
    notice: null,
    ...overrides,
  };
}

describe('position estimation', () => {
  it('interpolates between the last and next station by time and says it is not GPS', () => {
    const pos = estimatePosition(status(), new Date('2026-10-01T04:30:00.000Z'))!;
    expect(pos.kind).toBe('estimated');
    expect(pos.basis).toMatch(/Not a GPS position/);
    expect(pos.segment).toEqual({ fromCode: 'AAA', toCode: 'BBB', fraction: 0.5 });
    expect(pos.lat).toBeCloseTo(10.5, 5);
  });

  it('never claims arrival at the next station from an estimate', () => {
    const pos = estimatePosition(status(), new Date('2026-10-01T09:00:00.000Z'))!;
    expect(pos.segment?.fraction).toBe(0.95);
  });

  it('places not-started trains at the origin, arrived at the destination, cancelled nowhere', () => {
    expect(estimatePosition(status({ state: 'not_started' }))).toMatchObject({ lat: 10, lng: 76 });
    expect(estimatePosition(status({ state: 'arrived' }))).toMatchObject({ lat: 12, lng: 76 });
    expect(estimatePosition(status({ state: 'cancelled' }))).toBeNull();
  });

  it('keeps a train that has only arrived at its last station at that station', () => {
    const s = status({ lastReportedStation: { code: 'BBB', name: 'Bravo' }, lastReportedEvent: 'arrived', nextStation: { code: 'CCC', name: 'Charlie' } });
    expect(estimatePosition(s)).toMatchObject({ lat: 11, lng: 76, segment: null });
  });

  it('derives progress from the segment fraction and timetable distances', () => {
    const s = status();
    s.position = estimatePosition(s, new Date('2026-10-01T04:30:00.000Z'));
    expect(deriveProgress(s)).toEqual({ travelledKm: 50, remainingKm: 150, totalKm: 200, percent: 25 });
  });

  it('handles stations without coordinates and projects reported points onto the route', () => {
    const stops = [stop('AAA', 10, 76, 0), stop('XXX', null as unknown as number, null as unknown as number, 50), stop('BBB', 11, 76, 100)];
    const geometry = buildRouteGeometry(stops);
    expect(geometry.missingCoordinates).toEqual(['XXX']);
    expect(geometry.points).toHaveLength(2);
    const mid = pointAtDistance(geometry.points, geometry.totalKm / 2)!;
    expect(mid.lat).toBeCloseTo(10.5, 5);
    const projected = projectOntoRoute(geometry.points, { lat: 10.25, lng: 76.01 })!;
    expect(projected.km / geometry.totalKm).toBeCloseTo(0.25, 1);
    expect(positionToRouteKm(geometry, { lat: 10.5, lng: 76, kind: 'reported', basis: '', segment: null, computedAt: '' })).toBeCloseTo(geometry.totalKm / 2, 0);
  });
});

describe('filters and sorting', () => {
  const r = (n: string, o: Partial<NormalizedTrainStatus> | null, error?: TrackResult['error']): TrackResult => ({
    trainNumber: n,
    journeyDate: '2026-10-01',
    ok: o !== null,
    status: o === null ? null : status({ trainNumber: n, ...o }),
    error: error ?? null,
  });
  const now = new Date('2026-10-01T05:00:00.000Z');
  const results = [
    r('12082', { delayMinutes: 5, distanceRemainingKm: 50, providerUpdatedAt: '2026-10-01T04:50:00.000Z' }),
    r('12627', { delayMinutes: 90, distanceRemainingKm: 10, state: 'running', providerUpdatedAt: '2026-10-01T03:00:00.000Z' }),
    r('12859', { state: 'cancelled', delayMinutes: null, distanceRemainingKm: null, exceptions: [] }),
    r('22691', { state: 'departed', exceptions: [{ type: 'reschedule', message: 'r', stationCodes: [], rescheduledByMinutes: 60 }], delayMinutes: 60, distanceRemainingKm: 150 }),
    r('11111', null, { code: 'TRAIN_NOT_FOUND', message: 'x', retryAfterSeconds: null }),
  ];

  it('filters by status (including exception-derived states), delay, station and freshness', () => {
    expect(filterResults(results, { statuses: ['cancelled'] }).map((x) => x.trainNumber)).toEqual(['12859']);
    expect(filterResults(results, { statuses: ['rescheduled'] }).map((x) => x.trainNumber)).toEqual(['22691']);
    expect(filterResults(results, { statuses: ['unavailable'] }).map((x) => x.trainNumber)).toEqual(['11111']);
    expect(filterResults(results, { minDelay: 30, maxDelay: 80 }).map((x) => x.trainNumber)).toEqual(['22691']);
    expect(filterResults(results, { station: 'bbb' })).toHaveLength(4);
    expect(filterResults(results, { updatedWithinMinutes: 30 }, now).map((x) => x.trainNumber)).toContain('12082');
    expect(filterResults(results, { updatedWithinMinutes: 30 }, now).map((x) => x.trainNumber)).not.toContain('12627');
    expect(filterResults(results, { q: '126' }).map((x) => x.trainNumber)).toEqual(['12627']);
  });

  it('sorts by delay, nearest destination and train number', () => {
    expect(sortResults(results, 'largest_delay').map((x) => x.trainNumber)).toEqual(['12627', '22691', '12082', '11111', '12859']);
    expect(sortResults(results, 'nearest_destination').map((x) => x.trainNumber).slice(0, 3)).toEqual(['12627', '12082', '22691']);
    expect(sortResults(results, 'train_number').map((x) => x.trainNumber)).toEqual(['11111', '12082', '12627', '12859', '22691']);
  });

  it('round-trips filters through query strings', () => {
    const params = filtersToSearchParams({ statuses: ['running', 'diverted'], minDelay: 10, station: 'NDLS' }, 'largest_delay');
    expect(params.toString()).toBe('statuses=running%2Cdiverted&minDelay=10&station=NDLS&sort=largest_delay');
    expect(TrainFiltersQuerySchema.parse(Object.fromEntries(params))).toEqual({ statuses: ['running', 'diverted'], minDelay: 10, station: 'NDLS', sort: 'largest_delay' });
  });
});

describe('upload validation', () => {
  it('detects aliased columns, validates rows and builds the error CSV', () => {
    const today = '2026-10-01';
    const v = validateUploadRows(
      [
        { trainNo: '12082', journey_date: '', email: 'a@example.com' },
        { trainNo: '12x82', journey_date: '', email: '' },
        { trainNo: '12082', journey_date: '01-10-2026', email: '' },
        { trainNo: '', journey_date: '', email: '' },
      ],
      { defaultJourneyDate: today, now: new Date('2026-10-01T06:00:00Z') },
    );
    expect(v.detectedColumns).toEqual({ trainNumber: 'trainNo', journeyDate: 'journey_date', email: 'email' });
    expect(v.summary).toEqual({ total: 3, valid: 2, invalid: 1, duplicates: 1, truncated: false });
    expect(uniqueValidItems(v.rows)).toEqual([{ trainNumber: '12082', journeyDate: today }]);
    expect(uploadErrorRows(v.rows).rows).toEqual([['3', '12x82', '', '', 'Train numbers may only contain digits']]);
  });

  it('formats delays for people', () => {
    expect(formatDelay(0)).toBe('On time');
    expect(formatDelay(-3)).toBe('3 min early');
    expect(formatDelay(75)).toBe('1 h 15 min late');
    expect(formatDelay(null)).toBe('—');
  });
});
