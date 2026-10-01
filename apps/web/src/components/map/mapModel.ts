import {
  buildRouteGeometry,
  positionLabel,
  type LatLng,
  type NormalizedTrainStatus,
  type RouteGeometry,
  type RoutePoint,
  type TrainPosition,
} from '@railtrack/shared';
import type { MarkerKind } from './markers';

/** Pure helpers behind the Leaflet map (kept free of Leaflet so they can be unit-tested). */

export type PositionKind = MarkerKind | 'none';

export function markerKind(position: TrainPosition | null | undefined): PositionKind {
  if (!position) return 'none';
  return position.kind === 'reported' ? 'reported' : 'estimated';
}

export interface PositionCaption {
  kind: PositionKind;
  /** Short label shown next to the marker / in the legend. Never claims GPS for estimates. */
  label: string;
  /** Plain-language explanation of where the coordinate came from (null when no position). */
  basis: string | null;
}

export function positionCaption(
  status: Pick<NormalizedTrainStatus, 'position' | 'provider'>,
  position: TrainPosition | null = status.position,
): PositionCaption {
  const kind = markerKind(position);
  if (kind === 'none' || !position) return { kind: 'none', label: 'Position unavailable', basis: null };
  const label = positionLabel({ position, provider: status.provider });
  if (kind === 'estimated') return { kind, label, basis: position.basis };
  // "Reported position (demo data)" / "Reported position (RailRadar)" — always starts with "Reported position".
  return {
    kind,
    label: label.startsWith('Reported position') ? label : `Reported position (${status.provider.name})`,
    basis: position.basis,
  };
}

/** Split a route polyline at `km` into the travelled (solid) and remaining (dashed) parts. */
export function splitRouteAtKm(points: readonly RoutePoint[], km: number | null): { travelled: LatLng[]; remaining: LatLng[] } {
  const all = points.map((p) => ({ lat: p.lat, lng: p.lng }));
  if (points.length < 2 || km === null) return { travelled: [], remaining: all };
  const total = points[points.length - 1]!.cumKm;
  if (km <= 0) return { travelled: [], remaining: all };
  if (km >= total) return { travelled: all, remaining: [] };
  const travelled: LatLng[] = [];
  const remaining: LatLng[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.cumKm <= km) {
      travelled.push({ lat: p.lat, lng: p.lng });
      continue;
    }
    const prev = points[i - 1]!;
    const span = p.cumKm - prev.cumKm;
    const t = span === 0 ? 0 : (km - prev.cumKm) / span;
    const cut = { lat: prev.lat + (p.lat - prev.lat) * t, lng: prev.lng + (p.lng - prev.lng) * t };
    travelled.push(cut);
    remaining.push(cut, ...points.slice(i).map((q) => ({ lat: q.lat, lng: q.lng })));
    break;
  }
  return { travelled, remaining };
}

/** Route km to use for the travelled/remaining split when there is no position fix. */
export function fallbackTravelledKm(
  status: Pick<NormalizedTrainStatus, 'state' | 'lastReportedStation'>,
  geometry: RouteGeometry,
): number | null {
  if (geometry.points.length === 0) return null;
  if (status.state === 'arrived') return geometry.totalKm;
  if (status.state === 'not_started' || status.state === 'rescheduled' || status.state === 'cancelled') return 0;
  if (status.lastReportedStation) {
    const hit = [...geometry.points].reverse().find((p) => p.stationCode === status.lastReportedStation!.code);
    if (hit) return hit.cumKm;
  }
  return null;
}

export function missingCoordinatesNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'station' : 'stations'} not drawn — coordinates unavailable`;
}

export interface StationPoint extends LatLng {
  code: string;
  name: string;
}

/** Coordinates for a station code on the train's stop list (null if unknown). */
export function stationPoint(
  status: Pick<NormalizedTrainStatus, 'stops'>,
  ref: { code: string; name: string } | null,
): StationPoint | null {
  if (!ref) return null;
  const stop = status.stops.find((s) => s.stationCode === ref.code && s.lat !== null && s.lng !== null);
  if (!stop || stop.lat === null || stop.lng === null) return null;
  return { lat: stop.lat, lng: stop.lng, code: ref.code, name: ref.name };
}

/** Every coordinate worth fitting the viewport to for a train (route + position). */
export function boundsPoints(status: NormalizedTrainStatus): LatLng[] {
  const pts: LatLng[] = buildRouteGeometry(status.stops).points.map((p) => ({ lat: p.lat, lng: p.lng }));
  if (status.position) pts.push({ lat: status.position.lat, lng: status.position.lng });
  return pts;
}

export const INDIA_CENTER: LatLng = { lat: 22.6, lng: 79.0 };
