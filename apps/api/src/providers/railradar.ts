import {
  istWallClockToUtc,
  type NormalizedRoute,
  type NormalizedStop,
  type NormalizedTrainStatus,
  type ProviderInfo,
  type StopStatus,
  type TrainException,
  type TrainPosition,
  type TrainState,
} from '@railtrack/shared';
import { ProviderError } from '../lib/errors.ts';
import type { JsonResponse } from '../lib/http.ts';
import { classifyHttpFailure, HttpProvider, stateFromText, stopStatusFromText } from './httpProvider.ts';
import { finalizeRoute, finalizeStatus, isoOrNull, stationRef, toNumberOrNull } from './normalize.ts';
import type { ProviderLimits } from './types.ts';

/**
 * RailRadar (https://railradar.in/docs) — `Authorization: Bearer <key>`, base https://api.railradar.in/v1.
 * Live:  GET /trains/{number}/live?date=YYYY-MM-DD&includeCoordinates=true
 * Route: GET /trains/{number}?haltsOnly=false
 * Errors: { success:false, error:{ code, message } } with 400/401/404/429/503.
 * Paid plans include a commercial licence; the free Sandbox plan is non-commercial (10 req/min).
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

export const RAILRADAR_INFO: ProviderInfo = {
  id: 'railradar',
  name: 'RailRadar',
  isDemo: false,
  attribution: 'Live status via RailRadar',
};

export class RailRadarProvider extends HttpProvider {
  readonly id = 'railradar' as const;
  readonly info = RAILRADAR_INFO;
  // Conservative defaults that fit the smallest paid plan's burst limit (30/min).
  readonly limits: ProviderLimits = {
    maxConcurrent: 2,
    minIntervalMs: 1_000,
    maxPerMinute: 25,
    liveCacheSeconds: 120,
    routeCacheSeconds: 86_400,
    minPollMinutes: 10,
  };
  readonly docsUrl = 'https://railradar.in/docs';
  protected readonly keyEnvVar = 'RAILRADAR_API_KEY';

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.requireKey()}` };
  }

  private classify = (trainNumber: string) => (res: JsonResponse): Json => {
    const body = obj(res.body);
    if (res.ok && body.success !== false) return obj(body.data);
    const error = obj(body.error);
    const code = String(error.code ?? '').toUpperCase();
    const message = String(error.message ?? '').toLowerCase();
    if ((res.status === 400 || res.status === 404) && (code === 'NOT_FOUND' || res.status === 404)) {
      if (message.includes('journey date') || message.includes('not running') || message.includes('does not run')) {
        return fail(new ProviderError(this.id, 'NOT_RUNNING_ON_DATE', `Train ${trainNumber} does not run on the selected journey date.`, { httpStatus: res.status }));
      }
      return fail(new ProviderError(this.id, 'TRAIN_NOT_FOUND', `Train ${trainNumber} was not found by RailRadar.`, { httpStatus: res.status }));
    }
    return fail(classifyHttpFailure(this.id, res, { notFoundMessage: `Train ${trainNumber} was not found by RailRadar.` }));
  };

  async getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus> {
    const url = `${this.baseUrl}/trains/${encodeURIComponent(trainNumber)}/live?date=${journeyDate}&includeCoordinates=true`;
    const data = await this.fetchJson(url, this.headers(), this.classify(trainNumber));
    const now = this.now();
    return finalizeStatus(this.id, normalizeRailRadarLive(data, trainNumber, journeyDate, now), now);
  }

  async getTrainRoute(trainNumber: string): Promise<NormalizedRoute> {
    const url = `${this.baseUrl}/trains/${encodeURIComponent(trainNumber)}?haltsOnly=false`;
    const data = await this.fetchJson(url, this.headers(), this.classify(trainNumber));
    return finalizeRoute(this.id, normalizeRailRadarRoute(data, trainNumber, this.now()));
  }

  protected async probe(): Promise<void> {
    await this.fetchJson(`${this.baseUrl}/trains/12951?haltsOnly=true`, this.headers(), this.classify('12951'));
  }
}

function fail(err: ProviderError): never {
  throw err;
}

function mapStopStatus(value: unknown, isDiverted: boolean): StopStatus {
  const t = String(value ?? '').toLowerCase();
  if (t === 'skipped') return 'skipped';
  if (isDiverted && t !== 'departed' && t !== 'arrived') return 'diverted';
  return stopStatusFromText(t);
}

function dayFromIso(iso: string | null, journeyDate: string): number | null {
  if (!iso) return null;
  const start = istWallClockToUtc(journeyDate, '00:00').getTime();
  return Math.floor((new Date(iso).getTime() - start) / 86_400_000) + 1;
}

export function normalizeRailRadarLive(data: Json, trainNumber: string, journeyDate: string, now: Date): NormalizedTrainStatus {
  const train = obj(data.train);
  const current = obj(data.currentLocation);
  const route = arr(data.route).map(obj);

  const stops: NormalizedStop[] = route.map((r, i) => {
    const status = mapStopStatus(r.status, r.isDiverted === true);
    const reached = status === 'departed' || status === 'arrived' || status === 'current';
    const arrival = isoOrNull(r.actualArrival);
    const departure = isoOrNull(r.actualDeparture);
    const scheduledArrival = isoOrNull(r.scheduledArrival);
    const scheduledDeparture = isoOrNull(r.scheduledDeparture);
    return {
      sequence: toNumberOrNull(r.sequence) ?? i + 1,
      stationCode: String(r.stationCode ?? '').toUpperCase(),
      stationName: str(r.stationName) ?? stationRef(String(r.stationCode ?? '')).name,
      lat: toNumberOrNull(r.lat),
      lng: toNumberOrNull(r.lng),
      distanceKm: toNumberOrNull(r.distance),
      day: dayFromIso(scheduledArrival ?? scheduledDeparture, journeyDate),
      platform: str(r.platform),
      isHalt: r.isHalt !== false,
      scheduledArrival,
      scheduledDeparture,
      // RailRadar fills actual* as events happen; for stations not reached yet treat values as expected.
      actualArrival: reached ? arrival : null,
      actualDeparture: status === 'departed' ? departure : null,
      expectedArrival: reached ? null : arrival,
      expectedDeparture: status === 'departed' ? null : departure,
      arrivalDelayMinutes: toNumberOrNull(r.delayArrival),
      departureDelayMinutes: toNumberOrNull(r.delayDeparture),
      status,
    };
  });

  const exceptions = arr(data.exceptions).map(obj).flatMap(mapException);
  const diverted = current.isDiverted === true || exceptions.some((e) => e.type === 'diversion');

  const source = obj(train.source);
  const destination = obj(train.destination);
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];

  const currentCode = str(current.stationCode)?.toUpperCase() ?? null;
  const currentStop = currentCode ? [...stops].reverse().find((s) => s.stationCode === currentCode) : undefined;
  const currentEventText = String(current.status ?? '').toLowerCase();
  const lastReportedEvent = !currentCode
    ? null
    : currentEventText.includes('depart')
      ? 'departed'
      : currentEventText.includes('pass') || currentEventText.includes('cross')
        ? 'passed'
        : 'arrived';

  let state: TrainState = stateFromText(data.status) ?? (currentCode ? 'running' : 'not_started');
  if (state === 'running' && lastReportedEvent === 'departed') state = 'departed';
  if (diverted && state !== 'arrived' && state !== 'cancelled' && state !== 'not_started') state = 'diverted';
  if (exceptions.some((e) => e.type === 'cancellation')) state = 'cancelled';
  if (exceptions.some((e) => e.type === 'reschedule') && (state === 'not_started')) state = 'rescheduled';

  const nextHalt = obj(data.nextHalt);
  const prevHalt = obj(data.previousHalt);
  let nextCode = str(nextHalt.stationCode)?.toUpperCase() ?? null;
  if (nextCode && nextCode === currentCode && currentStop) {
    nextCode = stops.find((s) => s.sequence > currentStop.sequence && s.isHalt)?.stationCode ?? null;
  }
  const nextStop = nextCode ? stops.find((s) => s.stationCode === nextCode && (!currentStop || s.sequence > currentStop.sequence)) : undefined;

  return {
    trainNumber: str(data.trainNumber) ?? str(train.number) ?? trainNumber,
    trainName: str(data.trainName) ?? str(train.name) ?? `Train ${trainNumber}`,
    journeyDate,
    source: stationRef(str(source.code) ?? firstStop?.stationCode ?? '?', str(source.name) ?? firstStop?.stationName),
    destination: stationRef(str(destination.code) ?? lastStop?.stationCode ?? '?', str(destination.name) ?? lastStop?.stationName),
    scheduledDeparture: firstStop?.scheduledDeparture ?? null,
    scheduledArrival: lastStop?.scheduledArrival ?? null,
    actualDeparture: firstStop?.actualDeparture ?? null,
    actualArrival: state === 'arrived' ? (lastStop?.actualArrival ?? null) : null,
    expectedArrival: state === 'arrived' ? null : (lastStop?.expectedArrival ?? null),
    state,
    stateDetail: str(data.statusText) ?? str(data.status),
    lastReportedStation: currentStop ? { code: currentStop.stationCode, name: currentStop.stationName } : currentCode ? stationRef(currentCode) : null,
    lastReportedEvent,
    lastReportedAt: currentStop ? (lastReportedEvent === 'departed' ? currentStop.actualDeparture : currentStop.actualArrival) : null,
    previousStation: str(prevHalt.stationCode) ? stationRef(String(prevHalt.stationCode), str(prevHalt.stationName)) : null,
    nextStation: nextStop ? { code: nextStop.stationCode, name: nextStop.stationName } : null,
    nextStationEta: nextStop?.expectedArrival ?? null,
    delayMinutes: toNumberOrNull(data.delayMinutes),
    platform: (lastReportedEvent === 'arrived' ? currentStop?.platform : nextStop?.platform) ?? null,
    distanceTravelledKm: null,
    distanceRemainingKm: null,
    totalDistanceKm: toNumberOrNull(train.distance) ?? lastStop?.distanceKm ?? null,
    progressPercent: null,
    position: railRadarPosition(current, currentStop, nextStop, now),
    stops,
    exceptions,
    provider: RAILRADAR_INFO,
    providerUpdatedAt: isoOrNull(data.lastUpdatedAt),
    fetchedAt: now.toISOString(),
    freshness: 'live',
    notice: null,
  };
}

/**
 * Use a coordinate only if RailRadar supplies one. If it supplies segment progress instead, place the
 * marker along the segment but label it as an estimate derived from the provider's progress figure.
 */
function railRadarPosition(current: Json, currentStop: NormalizedStop | undefined, nextStop: NormalizedStop | undefined, now: Date): TrainPosition | null {
  const lat = toNumberOrNull(current.lat ?? current.latitude);
  const lng = toNumberOrNull(current.lng ?? current.lon ?? current.longitude);
  if (lat !== null && lng !== null) {
    return { lat, lng, kind: 'reported', basis: 'Coordinate reported by RailRadar.', segment: null, computedAt: now.toISOString() };
  }
  const progress = toNumberOrNull(current.segmentProgress);
  if (progress === null || !currentStop || !nextStop || currentStop.lat === null || currentStop.lng === null || nextStop.lat === null || nextStop.lng === null) {
    return null;
  }
  const fraction = Math.min(1, Math.max(0, progress));
  return {
    lat: currentStop.lat + (nextStop.lat - currentStop.lat) * fraction,
    lng: currentStop.lng + (nextStop.lng - currentStop.lng) * fraction,
    kind: 'estimated',
    basis: `Placed ${Math.round(fraction * 100)}% of the way from ${currentStop.stationName} to ${nextStop.stationName} using RailRadar's reported segment progress. Not a GPS position.`,
    segment: { fromCode: currentStop.stationCode, toCode: nextStop.stationCode, fraction },
    computedAt: now.toISOString(),
  };
}

function mapException(e: Json): TrainException[] {
  const type = String(e.type ?? '').toUpperCase();
  const message = str(e.message) ?? type.replace(/_/g, ' ').toLowerCase();
  if (type.includes('DIVERT')) {
    const diverted = obj(e.diverted);
    const skipped = arr(diverted.skippedStations)
      .map((s) => str(obj(s).stationCode) ?? str(s))
      .filter((s): s is string => !!s);
    const out: TrainException[] = [{ type: 'diversion', message, stationCodes: skipped, rescheduledByMinutes: null }];
    if (skipped.length) {
      out.push({ type: 'skipped_stop', message: `Stops not served due to diversion: ${skipped.join(', ')}`, stationCodes: skipped, rescheduledByMinutes: null });
    }
    return out;
  }
  if (type.includes('PARTIAL') || e.partiallyCancelled) return [{ type: 'partial_cancellation', message, stationCodes: [], rescheduledByMinutes: null }];
  if (type.includes('CANCEL')) return [{ type: 'cancellation', message, stationCodes: [], rescheduledByMinutes: null }];
  if (type.includes('RESCHED') || e.rescheduled) {
    const r = obj(e.rescheduled);
    const minutes = toNumberOrNull(r.byMinutes ?? r.minutes ?? r.delayMinutes);
    return [{ type: 'reschedule', message, stationCodes: [], rescheduledByMinutes: minutes === null ? null : Math.round(minutes) }];
  }
  if (type.includes('SHORT_TERMIN')) return [{ type: 'short_termination', message, stationCodes: [], rescheduledByMinutes: null }];
  if (type.includes('SHORT_ORIGIN')) return [{ type: 'short_origination', message, stationCodes: [], rescheduledByMinutes: null }];
  return [{ type: 'other', message, stationCodes: [], rescheduledByMinutes: null }];
}

export function normalizeRailRadarRoute(data: Json, trainNumber: string, now: Date): NormalizedRoute {
  const train = obj(data.train);
  const route = arr(data.route).map(obj);
  const stops = route.map((r, i) => {
    const station = obj(r.station);
    const code = String(station.code ?? r.stationCode ?? '').toUpperCase();
    const arrival = str(r.arrival);
    const departure = str(r.departure);
    const arrivalDay = toNumberOrNull(r.arrivalDay);
    const departureDay = toNumberOrNull(r.departureDay);
    return {
      sequence: toNumberOrNull(r.sequence) ?? i + 1,
      stationCode: code,
      stationName: str(station.name) ?? str(r.stationName) ?? stationRef(code).name,
      lat: toNumberOrNull(r.lat ?? station.lat),
      lng: toNumberOrNull(r.lng ?? station.lng),
      distanceKm: toNumberOrNull(r.distance),
      day: arrivalDay ?? departureDay,
      scheduledArrival: arrival && /^\d{2}:\d{2}$/.test(arrival) ? arrival : null,
      scheduledDeparture: departure && /^\d{2}:\d{2}$/.test(departure) ? departure : null,
      haltMinutes: haltBetween(arrival, departure),
      isHalt: r.isHalt !== false,
      platform: str(r.platform),
    };
  });
  const source = obj(train.source);
  const destination = obj(train.destination);
  const days = arr(train.runDays).map((d) => String(d).slice(0, 3).toUpperCase());
  const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
  return {
    trainNumber: str(train.number) ?? trainNumber,
    trainName: str(train.name) ?? `Train ${trainNumber}`,
    source: stationRef(str(source.code) ?? stops[0]?.stationCode ?? '?', str(source.name)),
    destination: stationRef(str(destination.code) ?? stops[stops.length - 1]?.stationCode ?? '?', str(destination.name)),
    stops,
    runningDays: days.length ? WEEK.filter((d) => days.includes(d)) : null,
    totalDistanceKm: toNumberOrNull(train.distance) ?? stops[stops.length - 1]?.distanceKm ?? null,
    provider: RAILRADAR_INFO,
    fetchedAt: now.toISOString(),
  };
}

function haltBetween(arrival: string | null, departure: string | null): number | null {
  if (!arrival || !departure || !/^\d{2}:\d{2}$/.test(arrival) || !/^\d{2}:\d{2}$/.test(departure)) return null;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (toMin(departure) - toMin(arrival) + 1440) % 1440;
}
