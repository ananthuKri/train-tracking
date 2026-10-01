import type { NormalizedTrainStatus, ProviderId, TrainState } from './schemas';

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export const STATE_META: Record<TrainState, { label: string; description: string; tone: Tone }> = {
  not_started: { label: 'Not started', description: 'Has not departed from its origin yet.', tone: 'neutral' },
  departed: { label: 'Departed', description: 'In transit — last reported event was a departure.', tone: 'info' },
  running: { label: 'Running', description: 'In transit — last reported at or passing an intermediate station.', tone: 'info' },
  arrived: { label: 'Arrived', description: 'Reached its destination.', tone: 'success' },
  cancelled: { label: 'Cancelled', description: 'Cancelled for this journey date.', tone: 'danger' },
  diverted: { label: 'Diverted', description: 'Running on a diverted route.', tone: 'warning' },
  rescheduled: { label: 'Rescheduled', description: 'Departure rescheduled; not departed yet.', tone: 'warning' },
  unavailable: { label: 'Unavailable', description: 'Live data is not available right now.', tone: 'neutral' },
};

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  railradar: 'RailRadar',
  railkit: 'RailKit',
  indianrailapi: 'IndianRailAPI',
  mock: 'Demo simulator',
};

export function formatDelay(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes === 0) return 'On time';
  if (minutes < 0) return `${Math.abs(minutes)} min early`;
  if (minutes < 60) return `${minutes} min late`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${m ? `${m} min ` : ''}late`;
}

export function delayTone(minutes: number | null | undefined): Tone {
  if (minutes === null || minutes === undefined) return 'neutral';
  if (minutes <= 5) return 'success';
  if (minutes <= 30) return 'warning';
  return 'danger';
}

/** Colour-blind-safe series colours (Okabe–Ito / Dark2 derived), all ≥3:1 against white map tiles. */
export const TRAIN_COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#A6761D', '#6A3D9A', '#E7298A', '#333333'] as const;
/** Marker shapes paired with colours so trains are distinguishable without colour. */
export const TRAIN_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross'] as const;
export type TrainShape = (typeof TRAIN_SHAPES)[number];

export function trainStyle(index: number): { color: string; shape: TrainShape } {
  const i = ((index % TRAIN_COLORS.length) + TRAIN_COLORS.length) % TRAIN_COLORS.length;
  return { color: TRAIN_COLORS[i]!, shape: TRAIN_SHAPES[i]! };
}

export function positionLabel(status: Pick<NormalizedTrainStatus, 'position' | 'provider'>): string {
  if (!status.position) return 'Position unavailable';
  if (status.position.kind === 'reported') {
    return status.provider.isDemo ? 'Reported position (demo data)' : `Reported by ${status.provider.name}`;
  }
  return 'Estimated position — not GPS';
}

export function freshnessLabel(status: Pick<NormalizedTrainStatus, 'freshness' | 'provider'>): string {
  if (status.provider.isDemo) return 'DEMO DATA';
  switch (status.freshness) {
    case 'live':
      return 'Live';
    case 'cached':
      return 'Recently fetched';
    default:
      return 'Last verified (live data unavailable)';
  }
}
