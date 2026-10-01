import { formatIst } from './dates';
import type { NormalizedStop, NormalizedTrainStatus, TrainPosition } from './schemas';

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RoutePoint extends LatLng {
  stationCode: string;
  /** Index into the original stops array. */
  stopIndex: number;
  /** Cumulative straight-line distance along the drawn polyline. */
  cumKm: number;
}

export interface RouteGeometry {
  points: RoutePoint[];
  totalKm: number;
  /** Stops that could not be drawn because coordinates are unknown. */
  missingCoordinates: string[];
}

type GeoStop = Pick<NormalizedStop, 'stationCode' | 'lat' | 'lng' | 'status'>;

/** Polyline through every stop that has coordinates (skipped stops of a diversion are excluded). */
export function buildRouteGeometry(stops: readonly GeoStop[], options: { includeSkipped?: boolean } = {}): RouteGeometry {
  const points: RoutePoint[] = [];
  const missing: string[] = [];
  let cum = 0;
  stops.forEach((stop, stopIndex) => {
    if (!options.includeSkipped && (stop.status === 'skipped' || stop.status === 'cancelled')) return;
    if (stop.lat === null || stop.lng === null) {
      missing.push(stop.stationCode);
      return;
    }
    const prev = points[points.length - 1];
    if (prev) cum += haversineKm(prev, { lat: stop.lat, lng: stop.lng });
    points.push({ lat: stop.lat, lng: stop.lng, stationCode: stop.stationCode, stopIndex, cumKm: cum });
  });
  return { points, totalKm: cum, missingCoordinates: missing };
}

/** Point at a cumulative distance along the polyline (clamped to the ends). */
export function pointAtDistance(points: readonly RoutePoint[], km: number): LatLng | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  if (km <= 0 || points.length === 1) return { lat: first.lat, lng: first.lng };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (km <= b.cumKm) {
      const span = b.cumKm - a.cumKm;
      const t = span === 0 ? 0 : (km - a.cumKm) / span;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
  }
  const last = points[points.length - 1]!;
  return { lat: last.lat, lng: last.lng };
}

/** Project an arbitrary coordinate onto the polyline; returns cumulative km of the nearest point. */
export function projectOntoRoute(points: readonly RoutePoint[], target: LatLng): { km: number; offRouteKm: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { km: 0, offRouteKm: haversineKm(points[0]!, target) };
  let best = { km: 0, offRouteKm: Number.POSITIVE_INFINITY };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    // Equirectangular projection is accurate enough for the short spans between stations.
    const kx = Math.cos(toRad((a.lat + b.lat) / 2));
    const ax = a.lng * kx;
    const bx = b.lng * kx;
    const px = target.lng * kx;
    const dx = bx - ax;
    const dy = b.lat - a.lat;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (target.lat - a.lat) * dy) / len2));
    const proj = { lat: a.lat + dy * t, lng: a.lng + (b.lng - a.lng) * t };
    const off = haversineKm(proj, target);
    if (off < best.offRouteKm) best = { km: a.cumKm + (b.cumKm - a.cumKm) * t, offRouteKm: off };
  }
  return best;
}

/** Cumulative km on the polyline for a position (segment-based for estimates, projection for reported). */
export function positionToRouteKm(geometry: RouteGeometry, position: TrainPosition | null): number | null {
  if (!position) return null;
  if (position.segment) {
    const from = geometry.points.find((p) => p.stationCode === position.segment!.fromCode);
    const to = geometry.points.find((p) => p.stationCode === position.segment!.toCode && p.cumKm >= (from?.cumKm ?? 0));
    if (from && to) return from.cumKm + (to.cumKm - from.cumKm) * position.segment.fraction;
  }
  return projectOntoRoute(geometry.points, position)?.km ?? null;
}

type EstimatorInput = Pick<
  NormalizedTrainStatus,
  'state' | 'stops' | 'lastReportedStation' | 'lastReportedEvent' | 'lastReportedAt' | 'nextStation' | 'delayMinutes' | 'source' | 'destination'
>;

const MAX_ESTIMATED_FRACTION = 0.95;

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);
const plusDelay = (iso: string | null, delay: number | null) =>
  iso ? new Date(new Date(iso).getTime() + (delay ?? 0) * 60_000).toISOString() : null;

/**
 * Estimate where a train is when the provider only reports station events.
 * The result is always `kind: 'estimated'` and its `basis` explains the calculation.
 * Never treat the output as a GPS fix.
 */
export function estimatePosition(status: EstimatorInput, now: Date = new Date()): TrainPosition | null {
  if (status.state === 'cancelled' || status.state === 'unavailable') return null;
  const geometry = buildRouteGeometry(status.stops);
  if (geometry.points.length === 0) return null;
  const computedAt = now.toISOString();
  const stops = status.stops;

  const atPoint = (point: RoutePoint, basis: string): TrainPosition => ({
    lat: point.lat,
    lng: point.lng,
    kind: 'estimated',
    basis,
    segment: null,
    computedAt,
  });

  const first = geometry.points[0]!;
  const last = geometry.points[geometry.points.length - 1]!;
  if (status.state === 'not_started' || status.state === 'rescheduled') {
    return atPoint(first, `Shown at origin ${status.source.name}: the train has not departed yet.`);
  }
  if (status.state === 'arrived') {
    return atPoint(last, `Shown at destination ${status.destination.name}: the train has arrived.`);
  }

  // Locate the last reported station on the drawable route.
  let lastIdx = -1;
  if (status.lastReportedStation) {
    for (let i = stops.length - 1; i >= 0; i--) {
      if (stops[i]!.stationCode === status.lastReportedStation.code) {
        lastIdx = i;
        break;
      }
    }
  }
  if (lastIdx < 0) {
    for (let i = stops.length - 1; i >= 0; i--) {
      const st = stops[i]!.status;
      if (st === 'departed' || st === 'current' || st === 'arrived') {
        lastIdx = i;
        break;
      }
    }
  }
  if (lastIdx < 0) return atPoint(first, `Shown at origin ${status.source.name}: no station report yet.`);

  // Nearest drawable point at or before the last reported station.
  const fromPoint = [...geometry.points].reverse().find((p) => p.stopIndex <= lastIdx) ?? first;
  const lastStop = stops[lastIdx]!;
  const departedLast = status.lastReportedEvent !== 'arrived' || lastStop.actualDeparture !== null;
  if (!departedLast) {
    const when = status.lastReportedAt ? ` at ${formatIst(status.lastReportedAt, 'time')} IST` : '';
    return atPoint(fromPoint, `Last reported arriving at ${lastStop.stationName}${when}; shown at the station (estimated, not GPS).`);
  }

  // Next drawable stop after the last reported one (prefer the provider's next station).
  let toPoint = geometry.points.find((p) => p.stopIndex > lastIdx && stops[p.stopIndex]!.stationCode === status.nextStation?.code);
  toPoint ??= geometry.points.find((p) => p.stopIndex > lastIdx && stops[p.stopIndex]!.isHalt);
  toPoint ??= geometry.points.find((p) => p.stopIndex > lastIdx);
  if (!toPoint) return atPoint(last, `Shown at ${stops[last.stopIndex]!.stationName}, the last mapped station.`);

  const nextStop = stops[toPoint.stopIndex]!;
  const departAt =
    ms(lastStop.actualDeparture) ??
    ms(status.lastReportedAt) ??
    ms(plusDelay(lastStop.scheduledDeparture ?? lastStop.scheduledArrival, status.delayMinutes));
  const arriveAt =
    ms(nextStop.expectedArrival) ?? ms(plusDelay(nextStop.scheduledArrival ?? nextStop.scheduledDeparture, status.delayMinutes));

  let fraction = 0;
  let basis: string;
  if (departAt !== null && arriveAt !== null && arriveAt > departAt) {
    fraction = Math.min(MAX_ESTIMATED_FRACTION, Math.max(0, (now.getTime() - departAt) / (arriveAt - departAt)));
    basis =
      `Estimated between ${lastStop.stationName} and ${nextStop.stationName} (${Math.round(fraction * 100)}% of the segment), ` +
      `from departure at ${formatIst(new Date(departAt), 'time')} IST and expected arrival ${formatIst(new Date(arriveAt), 'time')} IST. Not a GPS position.`;
  } else {
    basis = `Departed ${lastStop.stationName}; timings unavailable so the marker is held at that station (estimated, not GPS).`;
  }

  const km = fromPoint.cumKm + (toPoint.cumKm - fromPoint.cumKm) * fraction;
  const point = pointAtDistance(geometry.points, km)!;
  return {
    lat: point.lat,
    lng: point.lng,
    kind: 'estimated',
    basis,
    segment: { fromCode: fromPoint.stationCode, toCode: toPoint.stationCode, fraction },
    computedAt,
  };
}

/**
 * Distance travelled along the timetable distances (falls back to straight-line route distance).
 * Uses the position segment when available so progress moves smoothly between stations.
 */
export function deriveProgress(
  status: Pick<NormalizedTrainStatus, 'state' | 'stops' | 'position' | 'lastReportedStation'>,
): { travelledKm: number | null; remainingKm: number | null; totalKm: number | null; percent: number | null } {
  const stops = status.stops;
  const lastStop = stops[stops.length - 1];
  const total = lastStop?.distanceKm ?? null;
  if (total === null || total <= 0) return { travelledKm: null, remainingKm: null, totalKm: total, percent: null };

  let travelled: number | null = null;
  if (status.state === 'arrived') travelled = total;
  else if (status.state === 'not_started' || status.state === 'rescheduled') travelled = 0;
  else if (status.position?.segment) {
    const from = stops.find((s) => s.stationCode === status.position!.segment!.fromCode);
    const to = stops.find((s) => s.stationCode === status.position!.segment!.toCode);
    if (from?.distanceKm != null && to?.distanceKm != null) {
      travelled = from.distanceKm + (to.distanceKm - from.distanceKm) * status.position.segment.fraction;
    }
  }
  if (travelled === null && status.lastReportedStation) {
    const st = [...stops].reverse().find((s) => s.stationCode === status.lastReportedStation!.code);
    travelled = st?.distanceKm ?? null;
  }
  if (travelled === null) return { travelledKm: null, remainingKm: null, totalKm: total, percent: null };
  travelled = Math.max(0, Math.min(total, travelled));
  return {
    travelledKm: round1(travelled),
    remainingKm: round1(total - travelled),
    totalKm: total,
    percent: round1((travelled / total) * 100),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** OpenStreetMap link for a coordinate (used in emails). */
export function osmLink(lat: number, lng: number, zoom = 11): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=${zoom}/${lat.toFixed(5)}/${lng.toFixed(5)}`;
}
