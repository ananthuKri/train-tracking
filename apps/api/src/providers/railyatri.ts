import {
  diffDays,
  istWallClockToUtc,
  todayInIst,
  WEEKDAYS,
  type NormalizedRoute,
  type NormalizedStop,
  type NormalizedTrainStatus,
  type ProviderHealth,
  type ProviderInfo,
  type StopStatus,
  type TrainException,
  type TrainState,
} from '@railtrack/shared';
import { ProviderError } from '../lib/errors.ts';
import type { FetchLike } from '../lib/http.ts';
import { finalizeRoute, finalizeStatus, healthLimits, titleCase } from './normalize.ts';
import { RobotsPolicy } from './robots.ts';
import { fetchPublicPage, ScraperNotApplicableError } from './scrapeUtil.ts';
import type { ProviderLimits, TrainDataProvider } from './types.ts';

/**
 * Web-scraping provider for the public RailYatri live-status page
 * (https://www.railyatri.in/live-train-status/{train}?start_day={daysAgo}).
 *
 * The page is server-rendered and embeds its data as JSON in <script id="__NEXT_DATA__">, which is
 * parsed instead of the visual HTML. Ground rules: robots.txt is checked first, requests identify
 * themselves with an honest User-Agent, are rate limited, and any CAPTCHA/bot challenge or block is
 * treated as a failure (never bypassed) so the API fallback is used.
 *
 * RailYatri labels this data as crowd-sourced; check the site's terms of use before relying on it.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const code = (v: unknown) => (str(v) ?? '').toUpperCase();
/** RailYatri marks non-stopping stations with "~". */
const cleanName = (v: unknown, fallback: string) =>
  titleCase((str(v) ?? fallback).replace(/~/g, '').replace(/[.\s]+$/, '').trim());

export const RAILYATRI_INFO: ProviderInfo = {
  id: 'railyatri',
  name: 'RailYatri (web)',
  isDemo: false,
  attribution: 'Collected from the public RailYatri live-status page; RailYatri describes this data as crowd-sourced.',
};

/** Furthest back RailYatri pages go (start_day). */
const MAX_START_DAY = 4;

export { ScraperNotApplicableError };

export interface RailYatriOptions {
  baseUrl?: string;
  userAgent: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export class RailYatriScraperProvider implements TrainDataProvider {
  readonly id = 'railyatri' as const;
  readonly info = RAILYATRI_INFO;
  // Gentle on someone else's website: one request at a time, at least 2 s apart.
  readonly limits: ProviderLimits = {
    maxConcurrent: 1,
    minIntervalMs: 2_000,
    maxPerMinute: 20,
    liveCacheSeconds: 60,
    routeCacheSeconds: 86_400,
    minPollMinutes: 10,
  };
  readonly docsUrl = 'https://www.railyatri.in/live-train-status';
  private readonly baseUrl: string;
  private readonly robots: RobotsPolicy;

  constructor(private readonly options: RailYatriOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://www.railyatri.in').replace(/\/+$/, '');
    this.robots = new RobotsPolicy({
      origin: this.baseUrl,
      userAgent: options.userAgent,
      userAgentToken: 'railtracklive',
      providerId: this.id,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }

  isConfigured(): boolean {
    return true;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** Fetch a live-status page and return its embedded `pageProps`. */
  async fetchPage(trainNumber: string, startDay: number): Promise<Json> {
    const html = await fetchPublicPage({
      provider: this.id,
      siteName: 'RailYatri',
      origin: this.baseUrl,
      path: `/live-train-status/${encodeURIComponent(trainNumber)}${startDay > 0 ? `?start_day=${startDay}` : ''}`,
      robots: this.robots,
      userAgent: this.options.userAgent,
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
    });
    return extractPageProps(html);
  }

  async getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus> {
    const now = this.now();
    const startDay = diffDays(journeyDate, todayInIst(now));
    if (startDay < 0 || startDay > MAX_START_DAY) {
      throw new ScraperNotApplicableError(this.id, `RailYatri pages cover today and the previous ${MAX_START_DAY} days only.`);
    }
    const props = await this.fetchPage(trainNumber, startDay);
    const lts = obj(props.ltsData);
    if (lts.success !== true) throw pageError(this.id, trainNumber, lts);
    const pageDate = str(lts.train_start_date);
    if (pageDate && pageDate !== journeyDate) {
      throw new ScraperNotApplicableError(this.id, `RailYatri returned the journey of ${pageDate}, not ${journeyDate}.`);
    }
    return finalizeStatus(this.id, normalizeRailYatriLive(props, trainNumber, journeyDate, now), now);
  }

  async getTrainRoute(trainNumber: string): Promise<NormalizedRoute> {
    const props = await this.fetchPage(trainNumber, 0);
    if (!arr(obj(arr(props.timeTableData)[0]).route).length) throw pageError(this.id, trainNumber, obj(props.ltsData));
    return finalizeRoute(this.id, normalizeRailYatriRoute(props, trainNumber, this.now()));
  }

  /** Cheap check: robots.txt reachable and still allowing live-status pages (no train page is fetched). */
  async healthCheck(): Promise<ProviderHealth> {
    const started = performance.now();
    const allowed = await this.robots.isAllowed('/live-train-status/12951');
    return {
      provider: this.id,
      name: this.info.name,
      active: false,
      configured: true,
      isDemo: false,
      status: allowed ? 'up' : 'down',
      latencyMs: Math.round(performance.now() - started),
      checkedAt: this.now().toISOString(),
      message: allowed
        ? 'Web scraping of public live-status pages (primary source). Falls back to the API when scraping fails.'
        : 'robots.txt currently disallows live-status pages (or is unreachable); requests use the API.',
      docsUrl: this.docsUrl,
      limits: healthLimits(this.limits),
    };
  }
}

export function extractPageProps(html: string): Json {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new ProviderError('railyatri', 'PROVIDER_UNAVAILABLE', 'RailYatri page layout changed (embedded data not found).');
  try {
    return obj(obj(obj(JSON.parse(match[1]!)).props).pageProps);
  } catch (err) {
    throw new ProviderError('railyatri', 'PROVIDER_UNAVAILABLE', 'RailYatri page data could not be read.', { cause: err });
  }
}

function pageError(provider: string, trainNumber: string, lts: Json): ProviderError {
  const message = `${str(lts.message) ?? ''} ${str(lts.new_message) ?? ''}`.toLowerCase();
  if (/not run|does not run|no run/.test(message)) {
    return new ProviderError(provider, 'NOT_RUNNING_ON_DATE', `Train ${trainNumber} does not run on the selected journey date.`);
  }
  if (/expired|not found|invalid|no train/.test(message) || !str(lts.train_number)) {
    return new ProviderError(provider, 'TRAIN_NOT_FOUND', `RailYatri has no live data for train ${trainNumber} right now.`);
  }
  return new ProviderError(provider, 'PROVIDER_UNAVAILABLE', 'RailYatri did not return live status for this train.');
}

function minutesToIso(journeyDate: string, minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  return new Date(istWallClockToUtc(journeyDate, '00:00').getTime() + minutes * 60_000).toISOString();
}

/** "17:23" with a 0-based day offset ("a_day") → ISO. */
function clockToIso(journeyDate: string, hhmm: unknown, aDay: unknown): string | null {
  const t = str(hhmm);
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  return istWallClockToUtc(journeyDate, t.padStart(5, '0'), (num(aDay) ?? 0) + 1).toISOString();
}

function minutesToClock(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  const m = minutes % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function normalizeRailYatriLive(props: Json, trainNumber: string, journeyDate: string, now: Date): NormalizedTrainStatus {
  const lts = obj(props.ltsData);
  const route = arr(obj(arr(props.timeTableData)[0]).route)
    .map(obj)
    .filter((r) => code(r.station_code));
  const previous = arr(lts.previous_stations).map(obj).filter((s) => code(s.station_code));
  const upcoming = arr(lts.upcoming_stations).map(obj).filter((s) => code(s.station_code));
  const prevBy = new Map(previous.map((s) => [code(s.station_code), s]));
  const upBy = new Map(upcoming.map((s) => [code(s.station_code), s]));
  const lastIdx = route.length - 1;

  const messages = `${str(lts.title) ?? ''} ${str(lts.new_message) ?? ''}`.toLowerCase();
  const currentCode = code(lts.current_station_code);
  const atDestination = lts.at_dstn === true;
  const notStarted = !atDestination && !currentCode;

  // Where the train is on the full route (search after the last passed stoppage to handle loops).
  const lastPrevCode = code(previous.at(-1)?.station_code);
  const lastPrevIdx = lastPrevCode ? route.findIndex((r) => code(r.station_code) === lastPrevCode) : -1;
  let currentIdx = atDestination ? lastIdx : currentCode ? route.findIndex((r, i) => i >= Math.max(0, lastPrevIdx) && code(r.station_code) === currentCode) : -1;
  if (currentIdx < 0 && currentCode) currentIdx = route.findIndex((r) => code(r.station_code) === currentCode);
  // Reports can come from points that are not timetable stations (e.g. signal cabins such as "ERSD").
  // Place them after the last station before that distance, and before the next stop still to come.
  const offRoute = !atDestination && !!currentCode && currentIdx < 0;
  if (offRoute) {
    const travelled = num(lts.distance_from_source);
    const nextCode = code(upcoming[0]?.station_code);
    const nextIdx = nextCode ? route.findIndex((r, i) => i > Math.max(0, lastPrevIdx) && code(r.station_code) === nextCode) : -1;
    if (travelled !== null) {
      route.forEach((r, i) => {
        if ((num(r.distance_from_source) ?? Infinity) < travelled) currentIdx = i;
      });
    }
    if (nextIdx > 0 && (currentIdx < 0 || currentIdx >= nextIdx)) currentIdx = nextIdx - 1;
    if (currentIdx < 0) currentIdx = Math.max(0, lastPrevIdx);
  }

  const locationMessage = (str(obj(arr(lts.current_location_info).map(obj).find((x) => x.type === 1)).message) ?? '').replace(/~/g, '');
  let event: 'arrived' | 'departed' | 'passed' | null = null;
  if (atDestination) event = 'arrived';
  else if (currentCode) {
    if (/^crossed/i.test(locationMessage)) event = 'passed';
    else if (/^(departed|left)/i.test(locationMessage)) event = 'departed';
    else if (/^(arrived|reached|at\s)/i.test(locationMessage) || (num(lts.halt) ?? 0) > 0) event = 'arrived';
    else event = route[currentIdx]?.stop === true ? 'departed' : 'passed';
  }
  const lastReportedAt = event ? clockToIso(journeyDate, event === 'arrived' ? lts.eta : (lts.etd ?? lts.eta), lts.a_day) : null;

  const stops: NormalizedStop[] = route.map((r, i) => {
    const c = code(r.station_code);
    const prev = prevBy.get(c);
    const next = upBy.get(c);
    const passed = !notStarted && (atDestination ? i < lastIdx : i < currentIdx || (i === currentIdx && event !== 'arrived'));
    const here = !notStarted && i === currentIdx && event === 'arrived';
    let status: StopStatus = passed ? 'departed' : here ? 'current' : 'upcoming';
    if (atDestination && i === lastIdx) status = 'arrived';
    const live = prev ?? next;
    const platform = num(r.platform_number) || num(live?.platform_number);
    const lat = num(r.lat);
    const lng = num(r.lng);
    return {
      sequence: i + 1,
      stationCode: c,
      stationName: cleanName(r.station_name, c),
      lat: lat ? lat : null,
      lng: lng ? lng : null,
      distanceKm: num(r.distance_from_source),
      day: num(r.day),
      platform: platform ? String(platform) : null,
      isHalt: r.stop === true,
      scheduledArrival: i === 0 ? null : minutesToIso(journeyDate, num(r.sta_min)),
      scheduledDeparture: i === lastIdx ? null : minutesToIso(journeyDate, num(r.std_min)),
      actualArrival: passed || here || status === 'arrived' ? (prev ? clockToIso(journeyDate, prev.eta, prev.a_day) : i === currentIdx ? lastReportedAt : null) : null,
      actualDeparture: passed && prev && i < lastIdx ? clockToIso(journeyDate, prev.etd, prev.a_day) : null,
      expectedArrival: !passed && !here && status !== 'arrived' && next ? clockToIso(journeyDate, next.eta, next.a_day) : null,
      expectedDeparture: !passed && next && i < lastIdx ? clockToIso(journeyDate, next.etd, next.a_day) : null,
      arrivalDelayMinutes: num(live?.arrival_delay),
      departureDelayMinutes: num(next?.departure_delay),
      status,
    };
  });

  // Exceptions from the page's alert and diverted-station list.
  const alert = (str(lts.new_alert_msg) ?? str(lts.alert_msg) ?? '').trim();
  const divertedCodes = arr(lts.diverted_stations)
    .map((x) => code(typeof x === 'string' ? x : obj(x).station_code))
    .filter(Boolean);
  const exceptions: TrainException[] = [];
  if (divertedCodes.length || /divert/i.test(alert)) {
    exceptions.push({ type: 'diversion', message: alert || `Diverted between ${divertedCodes.join(' and ')}`, stationCodes: divertedCodes, rescheduledByMinutes: null });
  }
  if (/cancel/i.test(alert)) {
    exceptions.push({ type: /partial|short/i.test(alert) ? 'partial_cancellation' : 'cancellation', message: alert, stationCodes: [], rescheduledByMinutes: null });
  }
  if (/resched/i.test(alert)) exceptions.push({ type: 'reschedule', message: alert, stationCodes: [], rescheduledByMinutes: null });
  if (alert && !exceptions.length) exceptions.push({ type: 'other', message: alert, stationCodes: [], rescheduledByMinutes: null });

  let state: TrainState;
  if (/cancel/.test(messages) && !currentCode) state = 'cancelled';
  else if (notStarted) state = exceptions.some((e) => e.type === 'reschedule') ? 'rescheduled' : 'not_started';
  else if (atDestination) state = 'arrived';
  else if (divertedCodes.length) state = 'diverted';
  else state = event === 'departed' ? 'departed' : 'running';

  const first = stops[0];
  const last = stops[lastIdx];
  const nextStation = notStarted
    ? first
      ? { code: first.stationCode, name: first.stationName }
      : null
    : !atDestination && upcoming[0]
      ? { code: code(upcoming[0].station_code), name: cleanName(upcoming[0].station_name, code(upcoming[0].station_code)) }
      : null;
  const departureTime = str(lts.std);
  const updateTime = str(lts.update_time);
  const currentStop = currentIdx >= 0 ? stops[currentIdx] : undefined;

  return {
    trainNumber: str(lts.train_number) ?? trainNumber,
    trainName: str(lts.train_name) ?? `Train ${trainNumber}`,
    journeyDate,
    source: { code: code(lts.source) || (first?.stationCode ?? '?'), name: cleanName(lts.source_stn_name, first?.stationName ?? '?') },
    destination: { code: code(lts.destination) || (last?.stationCode ?? '?'), name: cleanName(lts.dest_stn_name, last?.stationName ?? '?') },
    scheduledDeparture: first?.scheduledDeparture ?? null,
    scheduledArrival: last?.scheduledArrival ?? null,
    actualDeparture: first?.actualDeparture ?? null,
    actualArrival: atDestination ? (last?.actualArrival ?? lastReportedAt) : null,
    expectedArrival: atDestination ? null : (last?.expectedArrival ?? null),
    state,
    stateDetail: locationMessage || str(lts.new_message) || str(lts.title),
    // Off-route reporting points (signal cabins) are shown as reported; the route position comes from distance.
    lastReportedStation: notStarted
      ? null
      : offRoute
        ? { code: currentCode, name: cleanName(lts.current_station_name, currentCode) }
        : currentStop
          ? { code: currentStop.stationCode, name: currentStop.stationName }
          : null,
    lastReportedEvent: notStarted ? null : event,
    lastReportedAt: notStarted ? null : lastReportedAt,
    previousStation: null,
    nextStation,
    nextStationEta: notStarted
      ? departureTime && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(departureTime)
        ? istWallClockToUtc(departureTime.slice(0, 10), departureTime.slice(11)).toISOString()
        : (first?.scheduledDeparture ?? null)
      : upcoming[0] && !atDestination
        ? clockToIso(journeyDate, upcoming[0].eta, upcoming[0].a_day)
        : null,
    delayMinutes: notStarted ? null : num(lts.delay),
    platform: notStarted ? (num(lts.platform_number) ? String(lts.platform_number) : null) : num(upcoming[0]?.platform_number) ? String(upcoming[0]!.platform_number) : null,
    distanceTravelledKm: null,
    distanceRemainingKm: null,
    totalDistanceKm: num(lts.total_distance) ?? last?.distanceKm ?? null,
    progressPercent: null,
    // RailYatri reports gps_unable for most trains; the position is estimated from station timings.
    position: null,
    stops,
    exceptions,
    provider: RAILYATRI_INFO,
    providerUpdatedAt: updateTime ? parseUpdateTime(updateTime) : null,
    fetchedAt: now.toISOString(),
    freshness: 'live',
    notice: null,
  };
}

/** "2026-10-01 17:31:00 +0530" → ISO. */
function parseUpdateTime(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))? ([+-]\d{2})(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3] ?? '00'}${m[4]}:${m[5]}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeRailYatriRoute(props: Json, trainNumber: string, now: Date): NormalizedRoute {
  const lts = obj(props.ltsData);
  const tt = obj(arr(props.timeTableData)[0]);
  const route = arr(tt.route)
    .map(obj)
    .filter((r) => code(r.station_code));
  const lastIdx = route.length - 1;
  const stops = route.map((r, i) => {
    const c = code(r.station_code);
    const lat = num(r.lat);
    const lng = num(r.lng);
    const platform = num(r.platform_number);
    return {
      sequence: i + 1,
      stationCode: c,
      stationName: cleanName(r.station_name, c),
      lat: lat ? lat : null,
      lng: lng ? lng : null,
      distanceKm: num(r.distance_from_source),
      day: num(r.day),
      scheduledArrival: i === 0 ? null : minutesToClock(num(r.sta_min)),
      scheduledDeparture: i === lastIdx ? null : minutesToClock(num(r.std_min)),
      haltMinutes: num(r.halt),
      isHalt: r.stop === true,
      platform: platform ? String(platform) : null,
    };
  });
  const runDays = (str(lts.run_days) ?? str(tt.run_days) ?? '').toUpperCase();
  const first = stops[0];
  const last = stops[lastIdx];
  return {
    trainNumber: str(tt.train_number) ?? trainNumber,
    trainName: str(tt.train_name) ?? str(lts.train_name) ?? `Train ${trainNumber}`,
    source: { code: first?.stationCode ?? '?', name: first?.stationName ?? '?' },
    destination: { code: last?.stationCode ?? '?', name: last?.stationName ?? '?' },
    stops,
    runningDays: runDays ? WEEKDAYS.filter((d) => runDays.includes(d)) : null,
    totalDistanceKm: last?.distanceKm ?? null,
    provider: RAILYATRI_INFO,
    fetchedAt: now.toISOString(),
  };
}
