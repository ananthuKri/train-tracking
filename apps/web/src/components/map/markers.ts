import { trainStyle, type TrainShape } from '@railtrack/shared';

/**
 * Inline-SVG train markers (used with L.divIcon — Leaflet's default PNG icons are never used).
 * Every train gets a colour AND a shape so markers stay distinguishable without colour vision.
 */

export const MARKER_VIEWBOX = 30;
const C = MARKER_VIEWBOX / 2;

function regularPolygon(sides: number, radius: number, rotationDeg = -90, cy = C): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
    pts.push(`${round(C + radius * Math.cos(a))},${round(cy + radius * Math.sin(a))}`);
  }
  return pts.join(' ');
}

function starPolygon(points: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((-90 + (180 / points) * i) * Math.PI) / 180;
    pts.push(`${round(C + r * Math.cos(a))},${round(C + r * Math.sin(a))}`);
  }
  return pts.join(' ');
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Polygon points for each shape in a 30×30 box (null = circle). */
export const SHAPE_POINTS: Record<TrainShape, string | null> = {
  circle: null,
  square: '5,5 25,5 25,25 5,25',
  triangle: regularPolygon(3, 13, -90, 17),
  diamond: regularPolygon(4, 12.5, -90),
  pentagon: regularPolygon(5, 12, -90),
  hexagon: regularPolygon(6, 12, 0),
  star: starPolygon(5, 13.5, 6),
  cross: '11,3 19,3 19,11 27,11 27,19 19,19 19,27 11,27 11,19 3,19 3,11 11,11',
};

/** SVG element markup for a shape with the given attributes string. */
export function shapeElement(shape: TrainShape, attrs: string): string {
  const points = SHAPE_POINTS[shape];
  return points === null ? `<circle cx="${C}" cy="${C}" r="10.5" ${attrs}/>` : `<polygon points="${points}" ${attrs}/>`;
}

export type MarkerKind = 'reported' | 'estimated';

export interface MarkerVisual {
  shape: TrainShape;
  color: string;
  kind: MarkerKind;
}

/** Solid fill for reported positions; white fill + dashed outline + "≈" for estimated ones. */
export function markerSvg({ shape, color, kind }: MarkerVisual): string {
  const body =
    kind === 'reported'
      ? shapeElement(shape, `fill="${color}" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"`)
      : shapeElement(
          shape,
          `fill="#ffffff" fill-opacity="0.95" stroke="${color}" stroke-width="2.6" stroke-dasharray="3.2 2.4" stroke-linejoin="round"`,
        ) +
        `<text x="${C}" y="${C + 4.6}" text-anchor="middle" font-size="13.5" font-weight="700" font-family="system-ui, sans-serif" fill="${color}">≈</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARKER_VIEWBOX} ${MARKER_VIEWBOX}" aria-hidden="true" focusable="false" data-kind="${kind}">${body}</svg>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Full divIcon HTML: shape + train-number label. */
export function trainMarkerHtml(
  visual: MarkerVisual & { trainNumber: string; focused?: boolean; dimmed?: boolean },
): string {
  const classes = ['rt-marker', `rt-marker--${visual.kind}`];
  if (visual.focused) classes.push('rt-marker--focused');
  if (visual.dimmed) classes.push('rt-marker--dim');
  return `<div class="${classes.join(' ')}" style="--rt-color:${visual.color}">${markerSvg(visual)}<span class="rt-marker-label">${
    visual.kind === 'estimated' ? '≈' : ''
  }${escapeHtml(visual.trainNumber)}</span></div>`;
}

export function stationPillHtml(code: string, variant: 'origin' | 'dest'): string {
  return `<span class="rt-station-pill${variant === 'dest' ? ' rt-station-pill--dest' : ''}">${escapeHtml(code)}</span>`;
}

export function styleForIndex(index: number): { color: string; shape: TrainShape } {
  return trainStyle(index);
}
