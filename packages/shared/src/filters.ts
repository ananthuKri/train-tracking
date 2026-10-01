import { z } from 'zod';
import { PROVIDER_IDS, TRAIN_STATES, type ProviderId, type TrackResult, type TrainState } from './schemas';

export const SORT_KEYS = ['latest_update', 'largest_delay', 'nearest_destination', 'train_number'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  latest_update: 'Latest update',
  largest_delay: 'Largest delay',
  nearest_destination: 'Nearest to destination',
  train_number: 'Train number',
};

export interface TrainFilters {
  /** Free text: train number, train name, or any station code/name on the route. */
  q?: string;
  statuses?: TrainState[];
  minDelay?: number;
  maxDelay?: number;
  /** Station on the route (code or part of the name). */
  station?: string;
  source?: string;
  destination?: string;
  /** Only trains updated within the last N minutes. */
  updatedWithinMinutes?: number;
  providers?: ProviderId[];
}

const csvList = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

const optionalInt = z.coerce.number().int().optional();

/** Parses filters from URL query strings (comma-separated lists). */
export const TrainFiltersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  statuses: csvList(TRAIN_STATES),
  minDelay: optionalInt,
  maxDelay: optionalInt,
  station: z.string().trim().max(100).optional(),
  source: z.string().trim().max(100).optional(),
  destination: z.string().trim().max(100).optional(),
  updatedWithinMinutes: z.coerce.number().int().positive().optional(),
  providers: csvList(PROVIDER_IDS),
  sort: z.enum(SORT_KEYS).optional(),
});

export function filtersToSearchParams(filters: TrainFilters, sort?: SortKey): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else params.set(key, String(value));
  }
  if (sort) params.set('sort', sort);
  return params;
}

export function hasActiveFilters(filters: TrainFilters): boolean {
  return Object.values(filters).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== ''));
}

/** States a result counts as for filtering — includes exception-derived states (e.g. a running diverted train). */
export function resultStates(result: TrackResult): Set<TrainState> {
  const status = result.status;
  if (!status) return new Set(['unavailable']);
  const states = new Set<TrainState>([status.state]);
  for (const e of status.exceptions) {
    if (e.type === 'diversion') states.add('diverted');
    if (e.type === 'cancellation') states.add('cancelled');
    if (e.type === 'reschedule') states.add('rescheduled');
  }
  if (status.freshness === 'stale') states.add('unavailable');
  return states;
}

const norm = (v: string) => v.trim().toLowerCase();
const stationMatches = (ref: { code: string; name: string } | null | undefined, needle: string) =>
  !!ref && (norm(ref.code) === needle || norm(ref.name).includes(needle));

export function lastUpdateTime(result: TrackResult): number | null {
  const s = result.status;
  if (!s) return null;
  return new Date(s.providerUpdatedAt ?? s.fetchedAt).getTime();
}

export function matchesFilters(result: TrackResult, filters: TrainFilters, now: Date = new Date()): boolean {
  const s = result.status;

  if (filters.statuses?.length) {
    const states = resultStates(result);
    if (!filters.statuses.some((st) => states.has(st))) return false;
  }
  if (filters.providers?.length && (!s || !filters.providers.includes(s.provider.id))) return false;

  if (filters.minDelay !== undefined || filters.maxDelay !== undefined) {
    const d = s?.delayMinutes;
    if (d === null || d === undefined) return false;
    if (filters.minDelay !== undefined && d < filters.minDelay) return false;
    if (filters.maxDelay !== undefined && d > filters.maxDelay) return false;
  }

  if (filters.source) {
    const needle = norm(filters.source);
    if (!stationMatches(s?.source, needle)) return false;
  }
  if (filters.destination) {
    const needle = norm(filters.destination);
    if (!stationMatches(s?.destination, needle)) return false;
  }
  if (filters.station) {
    const needle = norm(filters.station);
    if (!s || !s.stops.some((st) => stationMatches({ code: st.stationCode, name: st.stationName }, needle))) return false;
  }
  if (filters.updatedWithinMinutes !== undefined) {
    const t = lastUpdateTime(result);
    if (t === null || now.getTime() - t > filters.updatedWithinMinutes * 60_000) return false;
  }
  if (filters.q) {
    const needle = norm(filters.q);
    const hit =
      result.trainNumber.startsWith(needle) ||
      (!!s &&
        (norm(s.trainName).includes(needle) ||
          s.stops.some((st) => stationMatches({ code: st.stationCode, name: st.stationName }, needle))));
    if (!hit) return false;
  }
  return true;
}

export function filterResults<T extends TrackResult>(results: readonly T[], filters: TrainFilters, now: Date = new Date()): T[] {
  return results.filter((r) => matchesFilters(r, filters, now));
}

/** Group for "nearest destination": en-route first, then not started, then finished/unknown. */
function journeyGroup(r: TrackResult): number {
  const st = r.status?.state;
  if (st === 'departed' || st === 'running' || st === 'diverted') return 0;
  if (st === 'not_started' || st === 'rescheduled') return 1;
  return 2;
}

const nullsLast = (a: number | null | undefined, b: number | null | undefined, dir: 1 | -1) => {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return (a - b) * dir;
};

export function sortResults<T extends TrackResult>(results: readonly T[], sort: SortKey = 'latest_update'): T[] {
  const byNumber = (a: T, b: T) => a.trainNumber.localeCompare(b.trainNumber) || a.journeyDate.localeCompare(b.journeyDate);
  const list = [...results];
  switch (sort) {
    case 'largest_delay':
      return list.sort((a, b) => nullsLast(a.status?.delayMinutes, b.status?.delayMinutes, -1) || byNumber(a, b));
    case 'nearest_destination':
      return list.sort(
        (a, b) =>
          journeyGroup(a) - journeyGroup(b) ||
          nullsLast(a.status?.distanceRemainingKm, b.status?.distanceRemainingKm, 1) ||
          byNumber(a, b),
      );
    case 'train_number':
      return list.sort(byNumber);
    default:
      return list.sort((a, b) => nullsLast(lastUpdateTime(a), lastUpdateTime(b), -1) || byNumber(a, b));
  }
}
