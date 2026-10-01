import {
  formatDuration,
  formatIst,
  istWallClockToUtc,
  type NormalizedRoute,
  type NormalizedStop,
  type NormalizedTrainStatus,
  type ProviderHealth,
  type ProviderInfo,
  type StopStatus,
  type TrainException,
  type TrainPosition,
  type TrainState,
} from '@railtrack/shared';
import {
  buildMockTimetable,
  findMockTrain,
  hashString,
  MOCK_RATE_LIMITED_TRAIN,
  MOCK_TRAINS,
  MOCK_UNAVAILABLE_TRAIN,
  seededRandom,
  type MockStopTimetable,
  type MockTrainDefinition,
} from '../data/mockTrains.ts';
import { ProviderError } from '../lib/errors.ts';
import { finalizeRoute, finalizeStatus, healthLimits } from './normalize.ts';
import type { ProviderLimits, TrainDataProvider } from './types.ts';

const MINUTE = 60_000;

interface SimulatedEvent {
  stopIndex: number;
  kind: 'arrived' | 'departed' | 'passed';
  at: number;
}

/**
 * Deterministic demo simulator. Every response is flagged `isDemo: true` and the UI labels it
 * DEMO DATA. Journeys progress in real time, so monitoring alerts can be exercised end-to-end.
 */
export class MockProvider implements TrainDataProvider {
  readonly id = 'mock' as const;
  readonly info: ProviderInfo = {
    id: 'mock',
    name: 'Demo simulator',
    isDemo: true,
    attribution: 'Simulated demo data — not real Indian Railways information',
  };
  readonly limits: ProviderLimits = {
    maxConcurrent: 8,
    minIntervalMs: 0,
    liveCacheSeconds: 30,
    routeCacheSeconds: 3600,
    minPollMinutes: 10,
  };
  readonly docsUrl = null;

  constructor(
    private readonly options: { failureRate?: number; now?: () => Date; random?: () => number } = {},
  ) {}

  isConfigured(): boolean {
    return true;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private lookup(trainNumber: string): MockTrainDefinition {
    if (trainNumber === MOCK_RATE_LIMITED_TRAIN) {
      throw new ProviderError('mock', 'RATE_LIMITED', 'Demo: simulated provider rate limit reached', { httpStatus: 429, retryAfterSeconds: 60 });
    }
    if (trainNumber === MOCK_UNAVAILABLE_TRAIN) {
      throw new ProviderError('mock', 'PROVIDER_UNAVAILABLE', 'Demo: simulated provider outage', { httpStatus: 503 });
    }
    const rate = this.options.failureRate ?? 0;
    if (rate > 0 && (this.options.random ?? Math.random)() < rate) {
      throw new ProviderError('mock', 'PROVIDER_UNAVAILABLE', 'Demo: simulated intermittent provider failure', { httpStatus: 503 });
    }
    const def = findMockTrain(trainNumber);
    if (!def) {
      throw new ProviderError(
        'mock',
        'TRAIN_NOT_FOUND',
        `Train ${trainNumber} is not in the demo dataset. Demo trains: ${MOCK_TRAINS.map((t) => t.number).join(', ')}.`,
        { httpStatus: 404 },
      );
    }
    return def;
  }

  async getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus> {
    const def = this.lookup(trainNumber);
    const now = this.now();
    return finalizeStatus('mock', simulate(def, journeyDate, now, this.info), now);
  }

  async getTrainRoute(trainNumber: string): Promise<NormalizedRoute> {
    const def = this.lookup(trainNumber);
    const timetable = buildMockTimetable(def);
    const [depH, depM] = def.departure.split(':').map(Number) as [number, number];
    const startMinutes = depH * 60 + depM;
    const clock = (offset: number | null) => {
      if (offset === null) return null;
      const total = startMinutes + offset;
      return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    };
    const dayOf = (offset: number | null) => (offset === null ? null : Math.floor((startMinutes + offset) / 1440) + 1);
    const first = timetable[0]!;
    const last = timetable[timetable.length - 1]!;
    return finalizeRoute('mock', {
      trainNumber: def.number,
      trainName: def.name,
      source: { code: first.code, name: first.name },
      destination: { code: last.code, name: last.name },
      stops: timetable.map((s, i) => ({
        sequence: i + 1,
        stationCode: s.code,
        stationName: s.name,
        lat: s.lat,
        lng: s.lng,
        distanceKm: s.distanceKm,
        day: dayOf(s.arrivalOffset ?? s.departureOffset),
        scheduledArrival: clock(s.arrivalOffset),
        scheduledDeparture: clock(s.departureOffset),
        haltMinutes: s.haltMinutes,
        isHalt: s.isHalt,
        platform: s.platform,
      })),
      runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      totalDistanceKm: last.distanceKm,
      provider: this.info,
      fetchedAt: this.now().toISOString(),
    });
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      provider: 'mock',
      name: this.info.name,
      active: false,
      configured: true,
      isDemo: true,
      status: 'up',
      latencyMs: 0,
      checkedAt: this.now().toISOString(),
      message: 'Demo simulator — all data is simulated and labelled DEMO DATA.',
      docsUrl: null,
      limits: healthLimits(this.limits),
    };
  }
}

function simulate(def: MockTrainDefinition, journeyDate: string, now: Date, info: ProviderInfo): NormalizedTrainStatus {
  const timetable = buildMockTimetable(def);
  const base = istWallClockToUtc(journeyDate, def.departure).getTime();
  const rng = seededRandom(hashString(`${def.number}|${journeyDate}`));
  const reschedule = def.scenario === 'rescheduled' ? (def.rescheduleMinutes ?? 0) : 0;
  const skipped = new Set(def.divertedSkips ?? []);

  // Deterministic delay profile for the whole journey.
  const delays: number[] = [];
  timetable.forEach((_, i) => {
    if (i === 0) delays.push(Math.floor(rng() * (def.delay.origin + 1)));
    else delays.push(Math.min(360, Math.max(0, delays[i - 1]! + Math.round((rng() - 0.35) * def.delay.drift))));
  });

  const at = (offset: number | null, delay: number) => (offset === null ? null : base + (offset + delay + reschedule) * MINUTE);
  const sched = (offset: number | null) => (offset === null ? null : base + offset * MINUTE);
  const timeline = timetable.map((s, i) => {
    const arr = at(s.arrivalOffset, delays[i]!);
    // A late train usually still departs after its halt; never before its scheduled departure plus delay.
    const dep = at(s.departureOffset, delays[i]!);
    return { s, arr, dep, schedArr: sched(s.arrivalOffset), schedDep: sched(s.departureOffset) };
  });

  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const nowMs = now.getTime();
  const exceptions: TrainException[] = [];
  if (reschedule) {
    exceptions.push({
      type: 'reschedule',
      message: `Rescheduled by ${formatDuration(reschedule)} — new departure ${formatIst(new Date(base + reschedule * MINUTE), 'time')} IST (demo scenario)`,
      stationCodes: [timetable[0]!.code],
      rescheduledByMinutes: reschedule,
    });
  }
  if (skipped.size) {
    exceptions.push({
      type: 'diversion',
      message: `${def.diversionNote ?? 'Diverted'} (demo scenario)`,
      stationCodes: [...skipped],
      rescheduledByMinutes: null,
    });
    exceptions.push({
      type: 'skipped_stop',
      message: `Stops not served due to diversion: ${[...skipped].join(', ')}`,
      stationCodes: [...skipped],
      rescheduledByMinutes: null,
    });
  }

  const first = timeline[0]!;
  const last = timeline[timeline.length - 1]!;
  const common = {
    trainNumber: def.number,
    trainName: def.name,
    journeyDate,
    source: { code: first.s.code, name: first.s.name },
    destination: { code: last.s.code, name: last.s.name },
    scheduledDeparture: iso(first.schedDep),
    scheduledArrival: iso(last.schedArr),
    provider: info,
    fetchedAt: now.toISOString(),
    // The simulated source "publishes" every two minutes.
    providerUpdatedAt: new Date(Math.floor(nowMs / (2 * MINUTE)) * 2 * MINUTE).toISOString(),
    freshness: 'live' as const,
    notice: null,
    distanceTravelledKm: null,
    distanceRemainingKm: null,
    totalDistanceKm: last.s.distanceKm,
    progressPercent: null,
    previousStation: null,
  };

  const stopBase = (t: (typeof timeline)[number], i: number): Omit<NormalizedStop, 'status' | 'actualArrival' | 'actualDeparture' | 'expectedArrival' | 'expectedDeparture' | 'arrivalDelayMinutes' | 'departureDelayMinutes'> => ({
    sequence: i + 1,
    stationCode: t.s.code,
    stationName: t.s.name,
    lat: t.s.lat,
    lng: t.s.lng,
    distanceKm: t.s.distanceKm,
    day: dayNumber(base, t.schedArr ?? t.schedDep),
    platform: t.s.platform,
    isHalt: t.s.isHalt,
    scheduledArrival: iso(t.schedArr),
    scheduledDeparture: iso(t.schedDep),
  });

  if (def.scenario === 'cancelled') {
    exceptions.push({
      type: 'cancellation',
      message: `Fully cancelled for this journey date (demo scenario)`,
      stationCodes: [],
      rescheduledByMinutes: null,
    });
    return {
      ...common,
      actualDeparture: null,
      actualArrival: null,
      expectedArrival: null,
      state: 'cancelled',
      stateDetail: 'Cancelled',
      lastReportedStation: null,
      lastReportedEvent: null,
      lastReportedAt: null,
      nextStation: null,
      nextStationEta: null,
      delayMinutes: null,
      platform: null,
      position: null,
      stops: timeline.map((t, i) => ({
        ...stopBase(t, i),
        actualArrival: null,
        actualDeparture: null,
        expectedArrival: null,
        expectedDeparture: null,
        arrivalDelayMinutes: null,
        departureDelayMinutes: null,
        status: 'cancelled' as StopStatus,
      })),
      exceptions,
    };
  }

  // Ordered station events; skipped stations produce none.
  const events: SimulatedEvent[] = [];
  timeline.forEach((t, i) => {
    if (skipped.has(t.s.code)) return;
    if (!t.s.isHalt && i > 0 && i < timeline.length - 1) {
      events.push({ stopIndex: i, kind: 'passed', at: t.arr! });
      return;
    }
    if (t.arr !== null) events.push({ stopIndex: i, kind: 'arrived', at: t.arr });
    if (t.dep !== null) events.push({ stopIndex: i, kind: 'departed', at: t.dep });
  });
  const happened = events.filter((e) => e.at <= nowMs);
  const lastEvent = happened[happened.length - 1] ?? null;
  const lastIdx = lastEvent?.stopIndex ?? -1;
  const arrivedAtDestination = lastEvent?.kind === 'arrived' && lastIdx === timeline.length - 1;

  let state: TrainState;
  if (!lastEvent) state = reschedule ? 'rescheduled' : 'not_started';
  else if (arrivedAtDestination) state = 'arrived';
  else if (skipped.size) state = 'diverted';
  else state = lastEvent.kind === 'departed' ? 'departed' : 'running';

  const doneAt = (stopIndex: number, kind: 'arrived' | 'departed' | 'passed') =>
    happened.some((e) => e.stopIndex === stopIndex && (e.kind === kind || e.kind === 'passed'));

  const stops: NormalizedStop[] = timeline.map((t, i) => {
    const isSkipped = skipped.has(t.s.code);
    const arrived = !isSkipped && doneAt(i, 'arrived');
    const departed = !isSkipped && doneAt(i, 'departed');
    let status: StopStatus;
    if (isSkipped) status = 'skipped';
    else if (i === timeline.length - 1 && arrived) status = 'arrived';
    else if (departed || (i === 0 && lastIdx > 0)) status = 'departed';
    else if (arrived) status = 'current';
    else status = 'upcoming';
    const delay = delays[i]! + reschedule;
    return {
      ...stopBase(t, i),
      actualArrival: arrived ? iso(t.arr) : null,
      actualDeparture: departed ? iso(t.dep ?? t.arr) : null,
      expectedArrival: !isSkipped && !arrived ? iso(t.arr) : null,
      expectedDeparture: !isSkipped && !departed ? iso(t.dep) : null,
      arrivalDelayMinutes: isSkipped || t.arr === null ? null : delay,
      departureDelayMinutes: isSkipped || t.dep === null ? null : delay,
      status,
    };
  });

  const nextIdx = state === 'arrived' ? -1 : stops.findIndex((s, i) => i > lastIdx && s.isHalt && s.status === 'upcoming');
  const next = nextIdx >= 0 ? stops[nextIdx]! : null;
  const lastStop = lastIdx >= 0 ? stops[lastIdx]! : null;
  const delayNow = lastIdx >= 0 ? delays[lastIdx]! + reschedule : delays[0]! + reschedule;
  const kindLabel = { arrived: 'Arrived at', departed: 'Departed from', passed: 'Passed' } as const;

  let position: TrainPosition | null = null;
  if (def.scenario === 'reported_position' && lastEvent && state !== 'arrived') {
    position = reportedPosition(timetable, timeline, lastEvent, next ? nextIdx : -1, nowMs, now);
  }

  const platformStop = state === 'arrived' ? lastStop : lastEvent?.kind === 'arrived' ? lastStop : (next ?? stops[0]!);
  return {
    ...common,
    actualDeparture: lastIdx >= 0 ? iso(timeline[0]!.dep) : null,
    actualArrival: arrivedAtDestination ? iso(last.arr) : null,
    expectedArrival: arrivedAtDestination ? null : iso(last.arr),
    state,
    stateDetail: lastEvent
      ? `${kindLabel[lastEvent.kind]} ${lastStop!.stationName} (${lastStop!.stationCode}) at ${formatIst(new Date(lastEvent.at), 'time')} IST`
      : `Yet to start from ${first.s.name} (${first.s.code})`,
    lastReportedStation: lastStop ? { code: lastStop.stationCode, name: lastStop.stationName } : null,
    lastReportedEvent: lastEvent?.kind ?? null,
    lastReportedAt: lastEvent ? new Date(lastEvent.at).toISOString() : null,
    nextStation: lastIdx < 0 ? { code: first.s.code, name: first.s.name } : next ? { code: next.stationCode, name: next.stationName } : null,
    nextStationEta: lastIdx < 0 ? iso(first.dep) : (next?.expectedArrival ?? null),
    delayMinutes: delayNow,
    platform: platformStop?.platform ?? null,
    position,
    stops,
    exceptions,
  };
}

/** Simulates a provider that supplies coordinates: exact interpolation by time between stations. */
function reportedPosition(
  timetable: MockStopTimetable[],
  timeline: { arr: number | null; dep: number | null }[],
  lastEvent: SimulatedEvent,
  nextIdx: number,
  nowMs: number,
  now: Date,
): TrainPosition {
  const from = timetable[lastEvent.stopIndex]!;
  const basis = 'Coordinate supplied by the data provider (DEMO simulator — not a real GPS feed).';
  if (lastEvent.kind === 'arrived' || nextIdx < 0) {
    return { lat: from.lat, lng: from.lng, kind: 'reported', basis, segment: null, computedAt: now.toISOString() };
  }
  const to = timetable[nextIdx]!;
  const depart = timeline[lastEvent.stopIndex]!.dep ?? lastEvent.at;
  const arrive = timeline[nextIdx]!.arr ?? depart;
  const fraction = arrive > depart ? Math.min(1, Math.max(0, (nowMs - depart) / (arrive - depart))) : 0;
  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lng: from.lng + (to.lng - from.lng) * fraction,
    kind: 'reported',
    basis,
    segment: { fromCode: from.code, toCode: to.code, fraction },
    computedAt: now.toISOString(),
  };
}

function dayNumber(base: number, ms: number | null): number | null {
  if (ms === null) return null;
  const baseIstDay = Math.floor((base + 330 * MINUTE) / 86_400_000);
  const day = Math.floor((ms + 330 * MINUTE) / 86_400_000);
  return day - baseIstDay + 1;
}
