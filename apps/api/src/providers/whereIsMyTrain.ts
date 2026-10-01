import {
  addDaysToDate,
  istWallClockToUtc,
  todayInIst,
  type NormalizedRoute,
  type NormalizedStop,
  type NormalizedTrainStatus,
  type ProviderHealth,
  type ProviderInfo,
} from '@railtrack/shared';
import { ProviderError } from '../lib/errors.ts';
import type { FetchLike } from '../lib/http.ts';
import { finalizeRoute, finalizeStatus, healthLimits, parseDelayMinutes } from './normalize.ts';
import { RobotsPolicy } from './robots.ts';
import { fetchPublicPage, ScraperNotApplicableError } from './scrapeUtil.ts';
import type { ProviderLimits, TrainDataProvider } from './types.ts';

/**
 * Web-scraping provider for the public live-status page of whereismytrain.org.in
 * (https://whereismytrain.org.in/?trainNo={train}) — an independent site, not the Google "Where is my
 * Train" app. The status is server-rendered HTML (one card per halt); the site's only JSON call is a
 * name-search autocomplete, so the page itself is parsed.
 *
 * The page shows only the train's most recent journey and its times carry no dates, so this source
 * answers only while the train is en route (train marker present, recently updated) — then the journey
 * date can be worked out reliably. Otherwise the next source answers.
 */

export const WHEREISMYTRAIN_INFO: ProviderInfo = {
  id: 'whereismytrain',
  name: 'WhereIsMyTrain.org.in (web)',
  isDemo: false,
  attribution: 'Collected from the public whereismytrain.org.in page (independent site, not affiliated with IRCTC or Indian Railways).',
};

/** Reject pages whose "Last Updated" time is older than this. */
const MAX_UPDATE_AGE_MINUTES = 6 * 60;
/** Furthest back a running journey can have started. */
const MAX_JOURNEY_AGE_DAYS = 4;

export interface WimtCard {
  name: string;
  code: string;
  state: 'passed' | 'partial' | 'upcoming';
  platform: string | null;
  delayText: string | null;
  /** Bold time = actual (passed) or expected (upcoming); small time = scheduled, shown only when different. */
  arrival: { main: string | null; scheduled: string | null };
  departure: { main: string | null; scheduled: string | null };
  hasTrainMarker: boolean;
}

export interface WimtPage {
  trainNumber: string | null;
  trainName: string | null;
  summary: string | null;
  lastUpdated: string | null;
  delayText: string | null;
  cards: WimtCard[];
}

const text = (s: string | undefined) => (s ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');

export function parseWimtPage(html: string): WimtPage {
  const flat = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/\s+/g, ' ');
  const title = /<title>([^<]*)<\/title>/i.exec(flat)?.[1] ?? '';
  const titleMatch = /Status of (.+?) \((\d{5})\)/.exec(title);
  const summaryStart = flat.indexOf('<!-- Current Location Summary -->');
  const timelineStart = flat.indexOf('<!-- Stoppages timeline -->');
  const summaryHtml = summaryStart >= 0 ? flat.slice(summaryStart, timelineStart > summaryStart ? timelineStart : summaryStart + 2000) : '';

  const cards = flat
    .split('<!-- Station Card -->')
    .slice(1)
    .map((chunk): WimtCard | null => {
      const heading = /<h3[^>]*>\s*([^<]*?)\s*\(([A-Z0-9]+)\)\s*<\/h3>/.exec(chunk);
      if (!heading) return null;
      const cls = /shadow-sm ([^"]*)"/.exec(chunk)?.[1] ?? '';
      const block = (label: string, end: string) => {
        const start = chunk.indexOf(`${label}</div>`);
        if (start < 0) return { main: null, scheduled: null };
        const stop = chunk.indexOf(end, start);
        const part = chunk.slice(start, stop > start ? stop : undefined);
        return {
          main: /font-semibold text-gray-700">\s*([^<]*?)\s*</.exec(part)?.[1] || null,
          scheduled: /text-xs text-gray-400">\s*([^<]*?)\s*</.exec(part)?.[1] || null,
        };
      };
      return {
        name: heading[1]!.trim(),
        code: heading[2]!,
        state: /green/.test(cls) ? 'passed' : /blue/.test(cls) ? 'partial' : 'upcoming',
        platform: /PF\s*([^<]*?)\s*<\/span>/.exec(chunk)?.[1]?.trim() || null,
        delayText: /rounded text-xs font-semibold [^"]*">\s*([^<]*?)\s*<\/span>/.exec(chunk)?.[1]?.trim() || null,
        arrival: block('ARRIVAL', '<!-- Departure -->'),
        departure: block('DEPARTURE', '<!-- Train Icon Overlay -->'),
        hasTrainMarker: chunk.includes('id="train-icon"'),
      };
    })
    .filter((c): c is WimtCard => c !== null);

  return {
    trainNumber: titleMatch?.[2] ?? null,
    trainName: titleMatch && !/^Train \d{5}$/.test(titleMatch[1]!) ? titleMatch[1]! : null,
    summary: text(/<p class="font-semibold[^"]*">([\s\S]*?)<\/p>/.exec(summaryHtml)?.[1]) || null,
    lastUpdated: /Last Updated:\s*([0-9:]+\s*[AP]M)/i.exec(summaryHtml)?.[1] ?? null,
    delayText: text(/<span class="px-2 py-1 text-xs font-bold[^"]*">([\s\S]*?)<\/span>/.exec(summaryHtml)?.[1]) || null,
    cards,
  };
}

/** "07:20 PM" / "05:57:11 PM" → minutes after midnight. */
export function clockMinutes(value: string | null): number | null {
  const m = value ? /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)$/i.exec(value.trim()) : null;
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3]!.toUpperCase() === 'PM') h += 12;
  return h * 60 + Number(m[2]);
}

/** Wimt "07:20 PM"-style delay text ("36min Late", "2hr 7min Late", "On Time") → minutes. */
export function parseWimtDelay(value: string | null): number | null {
  if (!value) return null;
  const t = value.toLowerCase();
  if (t.includes('on time') || t.includes('right time')) return 0;
  const h = /(\d+)\s*h/.exec(t);
  const m = /(\d+)\s*m/.exec(t);
  if (!h && !m) return parseDelayMinutes(value);
  const minutes = Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0);
  return t.includes('early') ? -minutes : minutes;
}

/**
 * Give every time a day offset by walking the sequence and detecting midnight roll-overs. Small
 * backwards steps (stale or scheduled values shown in place of actual ones) are tolerated.
 */
function withDayOffsets(times: (number | null)[]): (number | null)[] {
  let day = 0;
  let previous: number | null = null;
  return times.map((t) => {
    if (t === null) return null;
    if (previous !== null && t < previous - 180) day++;
    previous = t;
    return day * 1440 + t;
  });
}

export interface WimtOptions {
  baseUrl?: string;
  userAgent: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export class WhereIsMyTrainScraperProvider implements TrainDataProvider {
  readonly id = 'whereismytrain' as const;
  readonly info = WHEREISMYTRAIN_INFO;
  readonly limits: ProviderLimits = {
    maxConcurrent: 1,
    minIntervalMs: 3_000,
    maxPerMinute: 15,
    liveCacheSeconds: 60,
    routeCacheSeconds: 86_400,
    minPollMinutes: 10,
  };
  readonly docsUrl = 'https://whereismytrain.org.in/';
  private readonly baseUrl: string;
  private readonly robots: RobotsPolicy;

  constructor(private readonly options: WimtOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://whereismytrain.org.in').replace(/\/+$/, '');
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

  async fetchPage(trainNumber: string): Promise<WimtPage> {
    const html = await fetchPublicPage({
      provider: this.id,
      siteName: 'WhereIsMyTrain.org.in',
      origin: this.baseUrl,
      path: `/?trainNo=${encodeURIComponent(trainNumber)}`,
      robots: this.robots,
      userAgent: this.options.userAgent,
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
    });
    const page = parseWimtPage(html);
    if (page.cards.length < 2) {
      throw new ProviderError(this.id, 'TRAIN_NOT_FOUND', `WhereIsMyTrain.org.in has no live data for train ${trainNumber} right now.`);
    }
    return page;
  }

  async getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus> {
    const now = this.now();
    const page = await this.fetchPage(trainNumber);
    return finalizeStatus(this.id, normalizeWimtLive(page, trainNumber, journeyDate, now), now);
  }

  async getTrainRoute(trainNumber: string): Promise<NormalizedRoute> {
    const page = await this.fetchPage(trainNumber);
    return finalizeRoute(this.id, normalizeWimtRoute(page, trainNumber, this.now()));
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = performance.now();
    const allowed = await this.robots.isAllowed('/?trainNo=12951');
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
        ? 'Web scraping of public live-status pages; answers for trains currently en route.'
        : 'robots.txt currently disallows live-status pages (or is unreachable).',
      docsUrl: this.docsUrl,
      limits: healthLimits(this.limits),
    };
  }
}

export function normalizeWimtLive(page: WimtPage, trainNumber: string, journeyDate: string, now: Date): NormalizedTrainStatus {
  const provider = WHEREISMYTRAIN_INFO.id;
  const cards = page.cards;
  const lastIdx = cards.length - 1;
  const markerIdx = cards.findIndex((c) => c.hasTrainMarker);
  if (markerIdx < 0 || markerIdx >= lastIdx) {
    // Not started or already finished: the page gives no way to tell which day's journey it shows.
    throw new ScraperNotApplicableError(provider, 'WhereIsMyTrain.org.in only shows a dated position while the train is en route.');
  }

  // Updates older than a few hours mean the page is showing an old journey.
  const updatedMin = clockMinutes(page.lastUpdated);
  let updatedAt: Date | null = null;
  if (updatedMin !== null) {
    updatedAt = istWallClockToUtc(todayInIst(now), `${String(Math.floor(updatedMin / 60)).padStart(2, '0')}:${String(updatedMin % 60).padStart(2, '0')}`);
    if (updatedAt.getTime() > now.getTime() + 5 * 60_000) updatedAt = new Date(updatedAt.getTime() - 86_400_000);
    if (now.getTime() - updatedAt.getTime() > MAX_UPDATE_AGE_MINUTES * 60_000) {
      throw new ScraperNotApplicableError(provider, 'WhereIsMyTrain.org.in data for this train is out of date.');
    }
  }

  // Origin has no arrival and destination no departure.
  const actualSeq = withDayOffsets(
    cards.flatMap((c, i) => [i === 0 ? null : clockMinutes(c.arrival.main), i === lastIdx ? null : clockMinutes(c.departure.main)]),
  );
  const scheduledSeq = withDayOffsets(
    cards.flatMap((c, i) => [
      i === 0 ? null : clockMinutes(c.arrival.scheduled ?? c.arrival.main),
      i === lastIdx ? null : clockMinutes(c.departure.scheduled ?? c.departure.main),
    ]),
  );
  const marker = cards[markerIdx]!;
  const markerTime = actualSeq[markerIdx * 2 + 1] ?? actualSeq[markerIdx * 2];
  if (markerTime === null || markerTime === undefined) {
    throw new ProviderError(provider, 'PROVIDER_UNAVAILABLE', 'WhereIsMyTrain.org.in page has no time for the current position.');
  }

  // The journey started on the latest date for which the last reported event is not in the future.
  let startDate: string | null = null;
  for (let k = 0; k <= MAX_JOURNEY_AGE_DAYS; k++) {
    const candidate = addDaysToDate(todayInIst(now), -k);
    if (istWallClockToUtc(candidate, '00:00').getTime() + markerTime * 60_000 <= now.getTime() + 15 * 60_000) {
      startDate = candidate;
      break;
    }
  }
  if (!startDate) throw new ScraperNotApplicableError(provider, 'Could not work out the journey date from WhereIsMyTrain.org.in.');
  if (startDate !== journeyDate) {
    throw new ScraperNotApplicableError(provider, `WhereIsMyTrain.org.in shows the journey of ${startDate}, not ${journeyDate}.`);
  }

  const iso = (minutes: number | null | undefined) =>
    minutes === null || minutes === undefined ? null : new Date(istWallClockToUtc(startDate!, '00:00').getTime() + minutes * 60_000).toISOString();
  const diff = (a: number | null | undefined, b: number | null | undefined) =>
    a === null || a === undefined || b === null || b === undefined ? null : a - b;

  const stops: NormalizedStop[] = cards.map((c, i) => {
    const passed = i <= markerIdx;
    const actArr = actualSeq[i * 2];
    const actDep = actualSeq[i * 2 + 1];
    const schArr = scheduledSeq[i * 2];
    const schDep = scheduledSeq[i * 2 + 1];
    // "Partial" cards show the scheduled departure in place of an actual one; don't present it as actual.
    const depKnown = passed && c.state !== 'partial';
    return {
      sequence: i + 1,
      stationCode: c.code,
      stationName: c.name,
      lat: null,
      lng: null,
      distanceKm: null,
      day: schArr ?? schDep ? Math.floor((schArr ?? schDep)! / 1440) + 1 : null,
      platform: c.platform,
      isHalt: true,
      scheduledArrival: iso(schArr),
      scheduledDeparture: iso(schDep),
      actualArrival: passed ? iso(actArr) : null,
      actualDeparture: depKnown ? iso(actDep) : null,
      expectedArrival: passed ? null : iso(actArr),
      expectedDeparture: passed ? null : iso(actDep),
      arrivalDelayMinutes: diff(actArr, schArr) ?? parseWimtDelay(c.delayText),
      departureDelayMinutes: depKnown || !passed ? diff(actDep, schDep) : null,
      status: passed ? 'departed' : 'upcoming',
    };
  });

  const next = cards[markerIdx + 1]!;
  const nextStop = stops[markerIdx + 1]!;
  const markerStop = stops[markerIdx]!;
  const departed = markerStop.actualDeparture !== null;
  const lastReportedAt = departed ? markerStop.actualDeparture : markerStop.actualArrival;
  const summary = page.summary && !/being updated/i.test(page.summary) ? page.summary : null;

  return {
    trainNumber: page.trainNumber ?? trainNumber,
    trainName: page.trainName ?? `Train ${trainNumber}`,
    journeyDate,
    source: { code: cards[0]!.code, name: cards[0]!.name },
    destination: { code: cards[lastIdx]!.code, name: cards[lastIdx]!.name },
    scheduledDeparture: stops[0]!.scheduledDeparture,
    scheduledArrival: stops[lastIdx]!.scheduledArrival,
    actualDeparture: stops[0]!.actualDeparture,
    actualArrival: null,
    expectedArrival: stops[lastIdx]!.expectedArrival,
    state: departed ? 'departed' : 'running',
    stateDetail: summary ?? `${departed ? 'Departed' : 'Arrived at'} ${marker.name} (${marker.code})`,
    lastReportedStation: { code: marker.code, name: marker.name },
    lastReportedEvent: departed ? 'departed' : 'arrived',
    lastReportedAt,
    previousStation: null,
    nextStation: { code: next.code, name: next.name },
    nextStationEta: nextStop.expectedArrival,
    delayMinutes: parseWimtDelay(page.delayText) ?? markerStop.departureDelayMinutes ?? markerStop.arrivalDelayMinutes,
    platform: next.platform,
    distanceTravelledKm: null,
    distanceRemainingKm: null,
    totalDistanceKm: null,
    progressPercent: null,
    position: null,
    stops,
    exceptions: [],
    provider: WHEREISMYTRAIN_INFO,
    providerUpdatedAt: updatedAt?.toISOString() ?? null,
    fetchedAt: now.toISOString(),
    freshness: 'live',
    notice: null,
  };
}

export function normalizeWimtRoute(page: WimtPage, trainNumber: string, now: Date): NormalizedRoute {
  const cards = page.cards;
  const lastIdx = cards.length - 1;
  const clock = (value: string | null) => {
    const m = clockMinutes(value);
    return m === null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const scheduledSeq = withDayOffsets(
    cards.flatMap((c, i) => [
      i === 0 ? null : clockMinutes(c.arrival.scheduled ?? c.arrival.main),
      i === lastIdx ? null : clockMinutes(c.departure.scheduled ?? c.departure.main),
    ]),
  );
  const stops = cards.map((c, i) => {
    const arr = i === 0 ? null : clock(c.arrival.scheduled ?? c.arrival.main);
    const dep = i === lastIdx ? null : clock(c.departure.scheduled ?? c.departure.main);
    const first = scheduledSeq[i * 2] ?? scheduledSeq[i * 2 + 1];
    const halt = arr && dep ? ((clockMinutes(dep)! - clockMinutes(arr)! + 1440) % 1440) : null;
    return {
      sequence: i + 1,
      stationCode: c.code,
      stationName: c.name,
      lat: null,
      lng: null,
      distanceKm: null,
      day: first === null || first === undefined ? null : Math.floor(first / 1440) + 1,
      scheduledArrival: arr,
      scheduledDeparture: dep,
      haltMinutes: halt,
      isHalt: true,
      platform: c.platform,
    };
  });
  return {
    trainNumber: page.trainNumber ?? trainNumber,
    trainName: page.trainName ?? `Train ${trainNumber}`,
    source: { code: cards[0]!.code, name: cards[0]!.name },
    destination: { code: cards[lastIdx]!.code, name: cards[lastIdx]!.name },
    stops,
    runningDays: null,
    totalDistanceKm: null,
    provider: WHEREISMYTRAIN_INFO,
    fetchedAt: now.toISOString(),
  };
}
