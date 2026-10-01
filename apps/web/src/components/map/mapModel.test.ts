import { describe, expect, it } from 'vitest';
import { buildRouteGeometry, TRAIN_SHAPES } from '@railtrack/shared';
import { LIVE_PROVIDER, makeStatus, STOPS } from '@/test/fixtures';
import {
  fallbackTravelledKm,
  markerKind,
  missingCoordinatesNote,
  positionCaption,
  splitRouteAtKm,
  stationPoint,
} from './mapModel';
import { markerSvg, SHAPE_POINTS, trainMarkerHtml } from './markers';

const reported = {
  lat: 26.5,
  lng: 76.9,
  kind: 'reported' as const,
  basis: 'Reported by the provider at 08:10 IST.',
  segment: null,
  computedAt: '2026-10-01T03:00:00.000Z',
};

describe('positionCaption (map marker labels)', () => {
  it('labels estimated positions as "not GPS" and exposes the basis', () => {
    const caption = positionCaption(makeStatus());
    expect(caption.kind).toBe('estimated');
    expect(caption.label).toBe('Estimated position — not GPS');
    expect(caption.basis).toContain('Not a GPS position');
  });

  it('labels reported positions as "Reported position" (demo and real providers)', () => {
    expect(positionCaption(makeStatus({ position: reported })).label).toBe('Reported position (demo data)');
    expect(positionCaption(makeStatus({ position: reported, provider: LIVE_PROVIDER })).label).toBe('Reported position (RailRadar)');
  });

  it('never calls an estimate live or GPS-based', () => {
    for (const provider of [LIVE_PROVIDER, makeStatus().provider]) {
      const label = positionCaption(makeStatus({ provider })).label;
      expect(label).not.toMatch(/live|gps position/i);
      expect(label).toMatch(/not GPS/);
    }
  });

  it('says "Position unavailable" when there is no position', () => {
    const caption = positionCaption(makeStatus({ position: null }));
    expect(caption).toEqual({ kind: 'none', label: 'Position unavailable', basis: null });
    expect(markerKind(null)).toBe('none');
  });
});

describe('marker SVG', () => {
  it('draws reported markers solid and estimated markers dashed with "≈"', () => {
    const solid = markerSvg({ shape: 'circle', color: '#0072B2', kind: 'reported' });
    expect(solid).toContain('fill="#0072B2"');
    expect(solid).not.toContain('stroke-dasharray');
    expect(solid).not.toContain('≈');

    const dashed = markerSvg({ shape: 'square', color: '#D55E00', kind: 'estimated' });
    expect(dashed).toContain('stroke-dasharray');
    expect(dashed).toContain('stroke="#D55E00"');
    expect(dashed).toContain('≈');
    expect(dashed).toContain('data-kind="estimated"');
  });

  it('has a distinct shape for every palette slot', () => {
    const svgs = TRAIN_SHAPES.map((shape) => markerSvg({ shape, color: '#000', kind: 'reported' }));
    expect(new Set(svgs).size).toBe(TRAIN_SHAPES.length);
    expect(SHAPE_POINTS.circle).toBeNull();
  });

  it('labels the marker with the train number and escapes it', () => {
    const html = trainMarkerHtml({ shape: 'star', color: '#009E73', kind: 'estimated', trainNumber: '12<b>', focused: true });
    expect(html).toContain('rt-marker--estimated');
    expect(html).toContain('rt-marker--focused');
    expect(html).toContain('≈12&lt;b&gt;');
    expect(html).toContain('--rt-color:#009E73');
  });
});

describe('route geometry helpers', () => {
  it('skips stations without coordinates and reports them', () => {
    const geometry = buildRouteGeometry(STOPS);
    expect(geometry.points.map((p) => p.stationCode)).toEqual(['NDLS', 'MTJ', 'KOTA']);
    expect(geometry.missingCoordinates).toEqual(['XYZ']);
    expect(missingCoordinatesNote(geometry.missingCoordinates.length)).toBe('1 station not drawn — coordinates unavailable');
    expect(missingCoordinatesNote(3)).toBe('3 stations not drawn — coordinates unavailable');
    expect(missingCoordinatesNote(0)).toBeNull();
  });

  it('splits the polyline into travelled (solid) and remaining (dashed) parts', () => {
    const { points, totalKm } = buildRouteGeometry(STOPS);
    const mid = points[1]!.cumKm / 2;
    const split = splitRouteAtKm(points, mid);
    expect(split.travelled).toHaveLength(2);
    expect(split.remaining).toHaveLength(3);
    expect(split.travelled[1]).toEqual(split.remaining[0]);

    expect(splitRouteAtKm(points, 0)).toEqual({ travelled: [], remaining: points.map(({ lat, lng }) => ({ lat, lng })) });
    expect(splitRouteAtKm(points, totalKm + 10).remaining).toEqual([]);
    expect(splitRouteAtKm(points, null).travelled).toEqual([]);
  });

  it('falls back to the last reported station when there is no position', () => {
    const geometry = buildRouteGeometry(STOPS);
    expect(fallbackTravelledKm(makeStatus(), geometry)).toBe(geometry.points[1]!.cumKm);
    expect(fallbackTravelledKm(makeStatus({ state: 'arrived' }), geometry)).toBe(geometry.totalKm);
    expect(fallbackTravelledKm(makeStatus({ state: 'not_started', lastReportedStation: null }), geometry)).toBe(0);
  });

  it('works when every stop lacks coordinates', () => {
    const stops = STOPS.map((s) => ({ ...s, lat: null, lng: null }));
    const geometry = buildRouteGeometry(stops);
    expect(geometry.points).toHaveLength(0);
    expect(splitRouteAtKm(geometry.points, 10)).toEqual({ travelled: [], remaining: [] });
    expect(fallbackTravelledKm(makeStatus({ stops }), geometry)).toBeNull();
    expect(stationPoint(makeStatus({ stops }), { code: 'NDLS', name: 'New Delhi' })).toBeNull();
  });

  it('looks up station coordinates for context markers', () => {
    expect(stationPoint(makeStatus(), { code: 'KOTA', name: 'Kota Jn' })).toEqual({ lat: 25.1817, lng: 75.8467, code: 'KOTA', name: 'Kota Jn' });
    expect(stationPoint(makeStatus(), { code: 'XYZ', name: 'No Coords Halt' })).toBeNull();
  });
});
