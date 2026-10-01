import type { NormalizedStop, NormalizedTrainStatus, ProviderInfo, TrackResult, UploadPreviewRow } from '@railtrack/shared';

export const DEMO_PROVIDER: ProviderInfo = { id: 'mock', name: 'Demo simulator', isDemo: true, attribution: null };
export const LIVE_PROVIDER: ProviderInfo = { id: 'railradar', name: 'RailRadar', isDemo: false, attribution: 'Data © RailRadar' };

export function makeStop(overrides: Partial<NormalizedStop> & Pick<NormalizedStop, 'sequence' | 'stationCode'>): NormalizedStop {
  return {
    stationName: overrides.stationCode,
    lat: null,
    lng: null,
    distanceKm: null,
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
    ...overrides,
  };
}

export const STOPS: NormalizedStop[] = [
  makeStop({ sequence: 1, stationCode: 'NDLS', stationName: 'New Delhi', lat: 28.6431, lng: 77.2197, distanceKm: 0, status: 'departed', scheduledDeparture: '2026-10-01T00:50:00.000Z', actualDeparture: '2026-10-01T00:55:00.000Z' }),
  makeStop({ sequence: 2, stationCode: 'MTJ', stationName: 'Mathura Jn', lat: 27.4807, lng: 77.6737, distanceKm: 141, status: 'departed' }),
  makeStop({ sequence: 3, stationCode: 'XYZ', stationName: 'No Coords Halt', lat: null, lng: null, distanceKm: 200, status: 'upcoming', isHalt: false }),
  makeStop({ sequence: 4, stationCode: 'KOTA', stationName: 'Kota Jn', lat: 25.1817, lng: 75.8467, distanceKm: 465, status: 'upcoming' }),
];

export function makeStatus(overrides: Partial<NormalizedTrainStatus> = {}): NormalizedTrainStatus {
  return {
    trainNumber: '12082',
    trainName: 'Test Shatabdi',
    journeyDate: '2026-10-01',
    source: { code: 'NDLS', name: 'New Delhi' },
    destination: { code: 'KOTA', name: 'Kota Jn' },
    scheduledDeparture: '2026-10-01T00:50:00.000Z',
    scheduledArrival: '2026-10-01T05:30:00.000Z',
    actualDeparture: '2026-10-01T00:55:00.000Z',
    actualArrival: null,
    expectedArrival: '2026-10-01T05:45:00.000Z',
    state: 'departed',
    stateDetail: null,
    lastReportedStation: { code: 'MTJ', name: 'Mathura Jn' },
    lastReportedEvent: 'departed',
    lastReportedAt: '2026-10-01T02:40:00.000Z',
    previousStation: { code: 'MTJ', name: 'Mathura Jn' },
    nextStation: { code: 'KOTA', name: 'Kota Jn' },
    nextStationEta: '2026-10-01T05:45:00.000Z',
    delayMinutes: 15,
    platform: '3',
    distanceTravelledKm: 141,
    distanceRemainingKm: 324,
    totalDistanceKm: 465,
    progressPercent: 30.3,
    position: {
      lat: 26.5,
      lng: 76.9,
      kind: 'estimated',
      basis: 'Estimated between Mathura Jn and Kota Jn (40% of the segment). Not a GPS position.',
      segment: { fromCode: 'MTJ', toCode: 'KOTA', fraction: 0.4 },
      computedAt: '2026-10-01T03:00:00.000Z',
    },
    stops: STOPS,
    exceptions: [],
    provider: DEMO_PROVIDER,
    providerUpdatedAt: '2026-10-01T02:58:00.000Z',
    fetchedAt: '2026-10-01T03:00:00.000Z',
    freshness: 'live',
    notice: null,
    ...overrides,
  };
}

export function makeResult(overrides: Partial<TrackResult> = {}): TrackResult {
  const status = overrides.status === undefined ? makeStatus() : overrides.status;
  return {
    trainNumber: status?.trainNumber ?? '12082',
    journeyDate: status?.journeyDate ?? '2026-10-01',
    ok: !!status,
    status,
    error: null,
    ...overrides,
  };
}

export function makeRow(overrides: Partial<UploadPreviewRow> & Pick<UploadPreviewRow, 'rowNumber'>): UploadPreviewRow {
  return {
    rawTrainNumber: '12082',
    trainNumber: '12082',
    rawJourneyDate: '2026-10-01',
    journeyDate: '2026-10-01',
    rawEmail: '',
    email: null,
    valid: true,
    errors: [],
    warnings: [],
    ...overrides,
  };
}
