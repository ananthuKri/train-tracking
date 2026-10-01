import {
  addDaysToDate,
  istWallClockToUtc,
  type NormalizedRoute,
  type NormalizedStop,
  type NormalizedTrainStatus,
  type ProviderInfo,
  type TrainState,
} from '@railtrack/shared';
import { ProviderError } from '../lib/errors.ts';
import type { JsonResponse } from '../lib/http.ts';
import { classifyHttpFailure, HttpProvider } from './httpProvider.ts';
import { finalizeRoute, finalizeStatus, parseDelayMinutes, stationRef, titleCase, toNumberOrNull } from './normalize.ts';
import type { ProviderLimits } from './types.ts';

/**
 * IndianRailAPI (https://indianrailapi.com/api-collection) — the API key is part of the URL path,
 * so URLs from this adapter must never be logged. The docs only show plain HTTP; we default to HTTPS
 * (override with INDIAN_RAIL_API_BASE_URL). "Do not hit more than one request from same IP within each second."
 * Live:  GET /livetrainstatus/apikey/{key}/trainnumber/{n}/date/{yyyymmdd}/
 * Route: GET /TrainSchedule/apikey/{key}/TrainNumber/{n}/
 * Responses carry their own "ResponseCode" (string) even on HTTP 200.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

export const INDIAN_RAIL_API_INFO: ProviderInfo = {
  id: 'indianrailapi',
  name: 'IndianRailAPI',
  isDemo: false,
  attribution: 'Live status via IndianRailAPI',
};

export class IndianRailApiProvider extends HttpProvider {
  readonly id = 'indianrailapi' as const;
  readonly info = INDIAN_RAIL_API_INFO;
  readonly limits: ProviderLimits = {
    maxConcurrent: 1,
    minIntervalMs: 1_100,
    maxPerMinute: 50,
    liveCacheSeconds: 180,
    routeCacheSeconds: 86_400,
    minPollMinutes: 15,
  };
  readonly docsUrl = 'https://indianrailapi.com/api-collection';
  protected readonly keyEnvVar = 'INDIAN_RAIL_API_KEY';

  private classify = (trainNumber: string) => (res: JsonResponse): Json => {
    if (!res.ok) throw classifyHttpFailure(this.id, res, { notFoundMessage: `Train ${trainNumber} was not found by IndianRailAPI.` });
    const body = obj(res.body);
    const code = String(body.ResponseCode ?? '');
    if (code === '200') return body;
    if (code === '204' || code === '404') {
      throw new ProviderError(this.id, 'TRAIN_NOT_FOUND', `Train ${trainNumber} was not found by IndianRailAPI.`, { httpStatus: res.status });
    }
    if (code === '401' || code === '403' || /key|auth|account/i.test(String(body.Message ?? ''))) {
      throw new ProviderError(this.id, 'PROVIDER_AUTH_FAILED', 'IndianRailAPI rejected our API key or account. Live data temporarily unavailable.', { httpStatus: res.status });
    }
    if (code === '429') throw new ProviderError(this.id, 'RATE_LIMITED', 'IndianRailAPI rate limit reached. Please try again later.', { retryAfterSeconds: 60 });
    throw new ProviderError(this.id, 'PROVIDER_UNAVAILABLE', 'IndianRailAPI could not answer this request.', { httpStatus: res.status });
  };

  private keyPath(): string {
    return `apikey/${encodeURIComponent(this.requireKey())}`;
  }

  async getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus> {
    const url = `${this.baseUrl}/livetrainstatus/${this.keyPath()}/trainnumber/${encodeURIComponent(trainNumber)}/date/${journeyDate.replace(/-/g, '')}/`;
    const body = await this.fetchJson(url, {}, this.classify(trainNumber));
    const now = this.now();
    return finalizeStatus(this.id, normalizeIndianRailLive(body, trainNumber, journeyDate, now), now);
  }

  async getTrainRoute(trainNumber: string): Promise<NormalizedRoute> {
    const url = `${this.baseUrl}/TrainSchedule/${this.keyPath()}/TrainNumber/${encodeURIComponent(trainNumber)}/`;
    const body = await this.fetchJson(url, {}, this.classify(trainNumber));
    return finalizeRoute(this.id, normalizeIndianRailRoute(body, trainNumber, this.now()));
  }

  protected async probe(): Promise<void> {
    await this.fetchJson(`${this.baseUrl}/StationCodeToName/${this.keyPath()}/StationCode/NDLS/`, {}, this.classify('-----'));
  }
}

/** "04:27PM" → "16:27"; "Source"/"Destination"/"-" → null. */
export function parse12h(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(text);
  if (!m) return /^\d{2}:\d{2}(:\d{2})?$/.test(text) ? text.slice(0, 5) : null;
  let h = Number(m[1]) % 12;
  if (m[3]!.toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * IndianRailAPI's "Day" field is often 0 for every stop, so the day is inferred by detecting when
 * wall-clock times wrap past midnight along the route.
 */
function toInstants(times: (string | null)[], journeyDate: string): (string | null)[] {
  let dayOffset = 0;
  let prev = -1;
  return times.map((t) => {
    if (!t) return null;
    const minutes = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    if (prev >= 0 && minutes < prev - 60) dayOffset++;
    prev = minutes;
    return istWallClockToUtc(addDaysToDate(journeyDate, dayOffset), t).toISOString();
  });
}

export function normalizeIndianRailLive(body: Json, trainNumber: string, journeyDate: string, now: Date): NormalizedTrainStatus {
  const route = arr(body.TrainRoute).map(obj);
  const current = obj(body.CurrentStation);
  const currentCode = str(current.StationCode)?.toUpperCase() ?? null;
  const currentIdx = currentCode ? route.findIndex((r) => String(r.StationCode ?? '').toUpperCase() === currentCode) : -1;

  // Interleave arrival/departure so midnight wrap detection sees chronological order.
  const flat: (string | null)[] = [];
  route.forEach((r) => {
    flat.push(parse12h(r.ScheduleArrival), parse12h(r.ScheduleDeparture), parse12h(r.ActualArrival), parse12h(r.ActualDeparture));
  });
  const schedInstants = toInstants(flat.filter((_, i) => i % 4 < 2), journeyDate);
  const actualInstants = toInstants(flat.filter((_, i) => i % 4 >= 2), journeyDate);

  const stops: NormalizedStop[] = route.map((r, i) => {
    const code = String(r.StationCode ?? '').toUpperCase();
    const passed = currentIdx >= 0 && i < currentIdx;
    const isCurrent = i === currentIdx;
    const departedFlag = String(r.IsDeparted ?? '').toLowerCase();
    const departed = passed || (isCurrent && (departedFlag === 'true' || departedFlag === 'yes'));
    const actArr = actualInstants[i * 2] ?? null;
    const actDep = actualInstants[i * 2 + 1] ?? null;
    const reached = passed || isCurrent;
    return {
      sequence: (toNumberOrNull(r.SerialNo) ?? i) + 1,
      stationCode: code,
      stationName: titleCase(str(r.StationName) ?? stationRef(code).name),
      lat: null,
      lng: null,
      distanceKm: toNumberOrNull(r.Distance),
      day: null,
      platform: null,
      isHalt: true,
      scheduledArrival: schedInstants[i * 2] ?? null,
      scheduledDeparture: schedInstants[i * 2 + 1] ?? null,
      actualArrival: reached ? actArr : null,
      actualDeparture: departed ? actDep : null,
      expectedArrival: reached ? null : actArr,
      expectedDeparture: departed ? null : actDep,
      arrivalDelayMinutes: parseDelayMinutes(r.DelayInArrival),
      departureDelayMinutes: parseDelayMinutes(r.DelayInDeparture),
      status: departed ? 'departed' : isCurrent ? 'current' : 'upcoming',
    };
  });

  const first = stops[0];
  const last = stops[stops.length - 1];
  const currentStop = currentIdx >= 0 ? stops[currentIdx] : undefined;
  const atDestination = currentIdx === stops.length - 1 && currentIdx > 0;
  let state: TrainState;
  if (!currentStop) state = 'not_started';
  else if (atDestination) state = 'arrived';
  else if (currentStop.status === 'departed') state = 'departed';
  else state = currentIdx === 0 && !currentStop.actualDeparture ? 'not_started' : 'running';
  if (atDestination && last) last.status = 'arrived';
  const event = !currentStop || state === 'not_started' ? null : currentStop.status === 'departed' ? 'departed' : 'arrived';

  return {
    trainNumber: str(body.TrainNumber) ?? trainNumber,
    // The live endpoint does not include a name; the tracking service fills it from the cached route.
    trainName: `Train ${trainNumber}`,
    journeyDate,
    source: first ? { code: first.stationCode, name: first.stationName } : stationRef('?'),
    destination: last ? { code: last.stationCode, name: last.stationName } : stationRef('?'),
    scheduledDeparture: first?.scheduledDeparture ?? null,
    scheduledArrival: last?.scheduledArrival ?? null,
    actualDeparture: first?.actualDeparture ?? null,
    actualArrival: state === 'arrived' ? (last?.actualArrival ?? null) : null,
    expectedArrival: state === 'arrived' ? null : (last?.expectedArrival ?? null),
    state,
    stateDetail: str(body.CurrentPosition),
    lastReportedStation: currentStop && state !== 'not_started' ? { code: currentStop.stationCode, name: currentStop.stationName } : null,
    lastReportedEvent: event,
    lastReportedAt: currentStop ? (event === 'departed' ? currentStop.actualDeparture : currentStop.actualArrival) : null,
    previousStation: null,
    nextStation: null,
    nextStationEta: null,
    delayMinutes: currentStop ? (event === 'departed' ? currentStop.departureDelayMinutes : currentStop.arrivalDelayMinutes) : null,
    platform: null,
    distanceTravelledKm: null,
    distanceRemainingKm: null,
    totalDistanceKm: last?.distanceKm ?? null,
    progressPercent: null,
    position: null,
    stops,
    exceptions: [],
    provider: INDIAN_RAIL_API_INFO,
    providerUpdatedAt: null,
    fetchedAt: now.toISOString(),
    freshness: 'live',
    notice: null,
  };
}

export function normalizeIndianRailRoute(body: Json, trainNumber: string, now: Date): NormalizedRoute {
  const route = arr(body.Route).map(obj);
  const stops = route.map((r, i) => {
    const code = String(r.StationCode ?? '').toUpperCase();
    const arrival = parse12h(r.ArrivalTime);
    const departure = parse12h(r.DepartureTime);
    return {
      sequence: (toNumberOrNull(r.SerialNo) ?? i + 1),
      stationCode: code,
      stationName: titleCase(str(r.StationName) ?? stationRef(code).name),
      lat: null,
      lng: null,
      distanceKm: toNumberOrNull(r.Distance),
      day: null,
      scheduledArrival: i === 0 ? null : arrival,
      scheduledDeparture: i === route.length - 1 ? null : departure,
      haltMinutes: null,
      isHalt: true,
      platform: null,
    };
  });
  return {
    trainNumber,
    trainName: `Train ${trainNumber}`,
    source: stationRef(stops[0]?.stationCode ?? '?', stops[0]?.stationName),
    destination: stationRef(stops[stops.length - 1]?.stationCode ?? '?', stops[stops.length - 1]?.stationName),
    stops,
    runningDays: null,
    totalDistanceKm: stops[stops.length - 1]?.distanceKm ?? null,
    provider: INDIAN_RAIL_API_INFO,
    fetchedAt: now.toISOString(),
  };
}
