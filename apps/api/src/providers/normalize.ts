import {
  deriveProgress,
  estimatePosition,
  NormalizedRouteSchema,
  NormalizedTrainStatusSchema,
  type NormalizedRoute,
  type NormalizedStop,
  type NormalizedTrainStatus,
  type StationRef,
} from '@railtrack/shared';
import { ProviderError } from '../lib/errors.ts';
import { lookupStation } from '../data/stations.ts';
import type { ProviderLimits, TrainDataProvider } from './types.ts';

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bJn\b/g, 'Jn')
    .trim();
}

export function stationRef(code: string, name?: string | null): StationRef {
  const upper = code.trim().toUpperCase();
  return { code: upper, name: name?.trim() ? name.trim() : (lookupStation(upper)?.name ?? upper) };
}

/** Fill missing station coordinates from the local table (never overrides provider values). */
export function withStationCoordinates<T extends { stationCode: string; lat: number | null; lng: number | null }>(stop: T): T {
  if (stop.lat !== null && stop.lng !== null) return stop;
  const known = lookupStation(stop.stationCode);
  return known ? { ...stop, lat: known.lat, lng: known.lng } : stop;
}

function neighbours(stops: readonly NormalizedStop[], lastCode: string | null) {
  if (!lastCode) return { previous: null, next: null };
  let idx = -1;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i]!.stationCode === lastCode) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return { previous: null, next: null };
  const usable = (s: NormalizedStop) => s.isHalt && s.status !== 'skipped' && s.status !== 'cancelled';
  const prev = stops.slice(0, idx).reverse().find(usable) ?? null;
  const next = stops.slice(idx + 1).find(usable) ?? null;
  return {
    previous: prev ? { code: prev.stationCode, name: prev.stationName } : null,
    next: next ? { code: next.stationCode, name: next.stationName, eta: next.expectedArrival ?? next.actualArrival } : null,
  };
}

/**
 * Complete a provider's status with derived fields (coordinates, neighbours, estimated position,
 * progress) and validate it against the shared schema. A provider-reported position is kept as-is.
 */
export function finalizeStatus(provider: string, status: NormalizedTrainStatus, now: Date = new Date()): NormalizedTrainStatus {
  const stops = status.stops.map(withStationCoordinates);
  const draft: NormalizedTrainStatus = { ...status, stops };

  if (draft.lastReportedStation && (!draft.previousStation || !draft.nextStation)) {
    const n = neighbours(stops, draft.lastReportedStation.code);
    draft.previousStation ??= n.previous;
    if (!draft.nextStation && n.next && draft.state !== 'arrived') {
      draft.nextStation = { code: n.next.code, name: n.next.name };
      draft.nextStationEta ??= n.next.eta ?? null;
    }
  }

  // Adapters may supply a reported coordinate or their own provider-based estimate; otherwise estimate here.
  if (!draft.position) draft.position = estimatePosition(draft, now);

  if (draft.distanceTravelledKm === null || draft.progressPercent === null) {
    const p = deriveProgress(draft);
    draft.distanceTravelledKm ??= p.travelledKm;
    draft.distanceRemainingKm ??= p.remainingKm;
    draft.totalDistanceKm ??= p.totalKm;
    draft.progressPercent ??= p.percent;
  }
  draft.totalDistanceKm ??= stops[stops.length - 1]?.distanceKm ?? null;

  const parsed = NormalizedTrainStatusSchema.safeParse(draft);
  if (!parsed.success) {
    throw new ProviderError(provider, 'PROVIDER_UNAVAILABLE', 'The data provider returned data in an unexpected format', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function finalizeRoute(provider: string, route: NormalizedRoute): NormalizedRoute {
  const parsed = NormalizedRouteSchema.safeParse({ ...route, stops: route.stops.map(withStationCoordinates) });
  if (!parsed.success) {
    throw new ProviderError(provider, 'PROVIDER_UNAVAILABLE', 'The data provider returned route data in an unexpected format', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** Parse "14 M", "1h 5m", "On Time", "+12", 12 → minutes. */
export function parseDelayMinutes(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text || text === '-' || text === '--') return null;
  if (text.includes('on time') || text === 'right time' || text === 'rt') return 0;
  const hours = /(\d+)\s*h/.exec(text);
  const mins = /(\d+)\s*m/.exec(text);
  if (hours || mins) return Number(hours?.[1] ?? 0) * 60 + Number(mins?.[1] ?? 0);
  const plain = /^[+-]?\d+$/.exec(text);
  return plain ? Number(text) : null;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function healthLimits(limits: ProviderLimits) {
  return {
    maxConcurrent: limits.maxConcurrent,
    minIntervalMs: limits.minIntervalMs,
    liveCacheSeconds: limits.liveCacheSeconds,
    routeCacheSeconds: limits.routeCacheSeconds,
    minPollMinutes: limits.minPollMinutes,
  };
}

export function notConfiguredError(provider: TrainDataProvider, envVar: string): ProviderError {
  return new ProviderError(provider.id, 'PROVIDER_NOT_CONFIGURED', `${provider.info.name} is not configured (set ${envVar}). Live data temporarily unavailable.`);
}
