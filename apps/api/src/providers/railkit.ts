import {
  istWallClockToUtc,
  type NormalizedRoute,
  type NormalizedStop,
  type NormalizedTrainStatus,
  type ProviderInfo,
  type TrainException,
  type TrainState,
} from '@railtrack/shared';
import { ProviderError } from '../lib/errors.ts';
import type { JsonResponse } from '../lib/http.ts';
import { classifyHttpFailure, HttpProvider, stateFromText, stopStatusFromText } from './httpProvider.ts';
import { finalizeRoute, finalizeStatus, parseDelayMinutes, stationRef, titleCase, toNumberOrNull } from './normalize.ts';
import type { ProviderLimits } from './types.ts';

/**
 * RailKit (https://railkit.in/docs) — `x-api-key` header, base https://api.railkit.in.
 * Only the NTES-backed v1 endpoints are used. RailKit's v2 live endpoint is sourced from
 * Where Is My Train and is deliberately NOT used (see README › Compliance).
 * Live:  GET /api/v1/trains/{number}/live/{DD-MM-YYYY}
 * Route: GET /api/v1/trains/{number}/info
 * Errors: { success:false, error:"message" }. 429 means the monthly quota is exhausted — never retried.
 * Direct REST access requires RailKit's "Advance" plan.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

export const RAILKIT_INFO: ProviderInfo = {
  id: 'railkit',
  name: 'RailKit (NTES-backed)',
  isDemo: false,
  attribution: 'Live status via RailKit',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export class RailKitProvider extends HttpProvider {
  readonly id = 'railkit' as const;
  readonly info = RAILKIT_INFO;
  // Advance plan: 600 requests / 10 min but only ~10k / month — poll gently.
  readonly limits: ProviderLimits = {
    maxConcurrent: 2,
    minIntervalMs: 1_000,
    maxPerMinute: 30,
    liveCacheSeconds: 180,
    routeCacheSeconds: 86_400,
    minPollMinutes: 15,
  };
  readonly docsUrl = 'https://railkit.in/docs';
  protected readonly keyEnvVar = 'RAILKIT_API_KEY';

  private headers(): Record<string, string> {
    return { 'x-api-key': this.requireKey() };
  }

  private classify = (trainNumber: string) => (res: JsonResponse): Json => {
    const body = obj(res.body);
    if (res.ok && body.success !== false) return obj(body.data);
    const message = String(body.error ?? '').toLowerCase();
    if (res.status === 400 || res.status === 404) {
      if (message.includes('not run') || message.includes('date')) {
        throw new ProviderError(this.id, 'NOT_RUNNING_ON_DATE', `Train ${trainNumber} does not run on the selected journey date.`, { httpStatus: res.status });
      }
      throw new ProviderError(this.id, 'TRAIN_NOT_FOUND', `Train ${trainNumber} was not found by RailKit.`, { httpStatus: res.status });
    }
    // 429 = monthly usage exhausted; retrying only burns time.
    throw classifyHttpFailure(this.id, res, { notFoundMessage: `Train ${trainNumber} was not found by RailKit.`, retryOn429: false });
  };

  async getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus> {
    const [y, m, d] = journeyDate.split('-');
    const url = `${this.baseUrl}/api/v1/trains/${encodeURIComponent(trainNumber)}/live/${d}-${m}-${y}`;
    const data = await this.fetchJson(url, this.headers(), this.classify(trainNumber));
    const now = this.now();
    return finalizeStatus(this.id, normalizeRailKitLive(data, trainNumber, journeyDate, now), now);
  }

  async getTrainRoute(trainNumber: string): Promise<NormalizedRoute> {
    const url = `${this.baseUrl}/api/v1/trains/${encodeURIComponent(trainNumber)}/info`;
    const data = await this.fetchJson(url, this.headers(), this.classify(trainNumber));
    return finalizeRoute(this.id, normalizeRailKitRoute(data, trainNumber, this.now()));
  }

  protected async probe(): Promise<void> {
    await this.fetchJson(`${this.baseUrl}/api/v1/stations/NDLS`, this.headers(), this.classify('-----'));
  }
}

/**
 * Parse RailKit/NTES times such as "16:05 28-Aug" (actual) or "16:05 28-Aug*" (asterisk = expected).
 * "SRC"/"DSTN"/"--" → null. The year is inferred from the journey date (handles Dec → Jan).
 */
export function parseRailKitTime(value: unknown, journeyDate: string): { iso: string; expected: boolean } | null {
  const text = str(value);
  if (!text) return null;
  const m = /^(\d{1,2}):(\d{2})\s+(\d{1,2})-([A-Za-z]{3})(\*?)$/.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[4]!.toLowerCase());
  if (month < 0) return null;
  const [jy, jm] = journeyDate.split('-').map(Number) as [number, number];
  let year = jy;
  if (month + 1 < jm - 6) year += 1;
  if (month + 1 > jm + 6) year -= 1;
  const date = `${year}-${String(month + 1).padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  return { iso: istWallClockToUtc(date, `${m[1]!.padStart(2, '0')}:${m[2]}`).toISOString(), expected: m[5] === '*' };
}

export function normalizeRailKitLive(data: Json, trainNumber: string, journeyDate: string, now: Date): NormalizedTrainStatus {
  const timeline = arr(data.timeline).map(obj);
  const currentCode = str(data.currentStationCode)?.toUpperCase() ?? null;

  const stops: NormalizedStop[] = timeline.map((t, i) => {
    const arrival = obj(t.arrival);
    const departure = obj(t.departure);
    const schArr = parseRailKitTime(arrival.scheduled, journeyDate);
    const schDep = parseRailKitTime(departure.scheduled, journeyDate);
    const actArr = parseRailKitTime(arrival.actual, journeyDate);
    const actDep = parseRailKitTime(departure.actual, journeyDate);
    const code = String(t.stationCode ?? '').toUpperCase();
    let status = stopStatusFromText(t.status);
    if (code === currentCode && status === 'upcoming') status = 'current';
    return {
      sequence: i + 1,
      stationCode: code,
      stationName: titleCase(str(t.stationName) ?? stationRef(code).name),
      lat: null,
      lng: null,
      distanceKm: toNumberOrNull(t.distanceKm),
      day: schArr || schDep ? Math.floor((new Date((schArr ?? schDep)!.iso).getTime() - istWallClockToUtc(journeyDate, '00:00').getTime()) / 86_400_000) + 1 : null,
      platform: str(t.platform),
      isHalt: String(t.type ?? 'stoppage').toLowerCase() === 'stoppage',
      scheduledArrival: schArr?.iso ?? null,
      scheduledDeparture: schDep?.iso ?? null,
      actualArrival: actArr && !actArr.expected ? actArr.iso : null,
      actualDeparture: actDep && !actDep.expected ? actDep.iso : null,
      expectedArrival: actArr?.expected ? actArr.iso : null,
      expectedDeparture: actDep?.expected ? actDep.iso : null,
      arrivalDelayMinutes: parseDelayMinutes(arrival.delay),
      departureDelayMinutes: parseDelayMinutes(departure.delay),
      status,
    };
  });

  const currentStop = currentCode ? [...stops].reverse().find((s) => s.stationCode === currentCode) : undefined;
  const note = str(data.statusNote) ?? '';
  const event: 'arrived' | 'departed' | null = !currentStop
    ? null
    : currentStop.actualDeparture
      ? 'departed'
      : currentStop.actualArrival || currentStop.sequence === 1
        ? 'arrived'
        : null;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const reachedDestination = !!last?.actualArrival;
  const started = !!first?.actualDeparture;

  let state: TrainState = stateFromText(note) ?? (reachedDestination ? 'arrived' : started ? 'running' : 'not_started');
  if (state === 'not_started' && started) state = 'running';
  if (state === 'running' && event === 'departed') state = 'departed';
  if (reachedDestination && state !== 'cancelled') state = 'arrived';

  const exceptions: TrainException[] = [];
  if (state === 'cancelled') exceptions.push({ type: 'cancellation', message: note || 'Cancelled', stationCodes: [], rescheduledByMinutes: null });
  if (state === 'diverted') exceptions.push({ type: 'diversion', message: note || 'Diverted', stationCodes: [], rescheduledByMinutes: null });
  if (state === 'rescheduled') exceptions.push({ type: 'reschedule', message: note || 'Rescheduled', stationCodes: [], rescheduledByMinutes: null });
  const skipped = stops.filter((s) => s.status === 'skipped').map((s) => s.stationCode);
  if (skipped.length) exceptions.push({ type: 'skipped_stop', message: `Stops not served: ${skipped.join(', ')}`, stationCodes: skipped, rescheduledByMinutes: null });

  const delayStop = currentStop ?? first;
  const delay = event === 'departed' ? delayStop?.departureDelayMinutes : delayStop?.arrivalDelayMinutes;
  const lastUpdate = str(data.lastUpdate);

  return {
    trainNumber: str(data.trainNo) ?? trainNumber,
    trainName: titleCase(str(data.trainName) ?? `Train ${trainNumber}`),
    journeyDate,
    source: first ? { code: first.stationCode, name: first.stationName } : stationRef('?'),
    destination: last ? { code: last.stationCode, name: last.stationName } : stationRef('?'),
    scheduledDeparture: first?.scheduledDeparture ?? null,
    scheduledArrival: last?.scheduledArrival ?? null,
    actualDeparture: first?.actualDeparture ?? null,
    actualArrival: last?.actualArrival ?? null,
    expectedArrival: last?.actualArrival ? null : (last?.expectedArrival ?? null),
    state,
    stateDetail: note || null,
    lastReportedStation: currentStop ? { code: currentStop.stationCode, name: currentStop.stationName } : null,
    lastReportedEvent: event,
    lastReportedAt: currentStop ? (event === 'departed' ? currentStop.actualDeparture : currentStop.actualArrival) : null,
    previousStation: null,
    nextStation: null,
    nextStationEta: null,
    delayMinutes: delay ?? null,
    platform: currentStop?.platform ?? null,
    distanceTravelledKm: null,
    distanceRemainingKm: null,
    totalDistanceKm: last?.distanceKm ?? null,
    progressPercent: null,
    position: null,
    stops,
    exceptions,
    provider: RAILKIT_INFO,
    providerUpdatedAt: lastUpdate ? parseLooseDate(lastUpdate) : null,
    fetchedAt: now.toISOString(),
    freshness: 'live',
    notice: null,
  };
}

function parseLooseDate(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeRailKitRoute(data: Json, trainNumber: string, now: Date): NormalizedRoute {
  const info = obj(data.trainInfo);
  const route = arr(data.route).map(obj);
  const clock = (v: unknown) => {
    const t = str(v);
    return t && /^\d{2}:\d{2}$/.test(t) ? t : null;
  };
  const stops = route.map((r, i) => {
    const coords = obj(r.coordinates);
    const code = String(r.stnCode ?? '').toUpperCase();
    const halt = toNumberOrNull(r.haltMinutes);
    return {
      sequence: i + 1,
      stationCode: code,
      stationName: titleCase(str(r.stnName) ?? stationRef(code).name),
      lat: toNumberOrNull(coords.latitude ?? coords.lat),
      lng: toNumberOrNull(coords.longitude ?? coords.lon ?? coords.lng),
      distanceKm: toNumberOrNull(r.distance),
      day: toNumberOrNull(r.day),
      scheduledArrival: clock(r.arrival),
      scheduledDeparture: clock(r.departure),
      haltMinutes: halt === null ? null : Math.round(halt),
      isHalt: i === 0 || i === route.length - 1 || (halt ?? 1) > 0,
      platform: str(r.platform),
    };
  });
  const days = String(info.running_days ?? '');
  const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
  return {
    trainNumber: str(info.train_no) ?? trainNumber,
    trainName: titleCase(str(info.train_name) ?? `Train ${trainNumber}`),
    source: stationRef(str(info.from_stn_code) ?? stops[0]?.stationCode ?? '?', str(info.from_stn_name)),
    destination: stationRef(str(info.to_stn_code) ?? stops[stops.length - 1]?.stationCode ?? '?', str(info.to_stn_name)),
    stops,
    // RailKit encodes running days as "1111111"; we assume Monday-first order (unverified for all trains).
    runningDays: /^[01]{7}$/.test(days) ? WEEK.filter((_, i) => days[i] === '1') : null,
    totalDistanceKm: stops[stops.length - 1]?.distanceKm ?? null,
    provider: RAILKIT_INFO,
    fetchedAt: now.toISOString(),
  };
}
