import type { ComponentType } from 'react';
import {
  Ban,
  CalendarClock,
  CircleCheck,
  CircleDot,
  Clock,
  CloudOff,
  MoveRight,
  Shuffle,
  TrainFront,
  TriangleAlert,
} from 'lucide-react';
import { STATE_META, delayTone, formatDelay, type TrackResult, type TrainState } from '@railtrack/shared';
import { cn } from '@/lib/utils';
import { TONE_BADGE } from '@/lib/tone';
import { SHAPE_POINTS } from '@/components/map/markers';
import type { TrainShape } from '@railtrack/shared';
import { errorMeta } from './errorMeta';

const BADGE_BASE =
  'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium [&>svg]:size-3.5 [&>svg]:shrink-0';

export const STATE_ICONS: Record<TrainState, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  not_started: Clock,
  departed: MoveRight,
  running: TrainFront,
  arrived: CircleCheck,
  cancelled: Ban,
  diverted: Shuffle,
  rescheduled: CalendarClock,
  unavailable: CloudOff,
};

/** "DEMO DATA" — high-contrast and always textual. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="demo-badge"
      title="Simulated trains — not live railway data"
      className={cn(
        'inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded border border-amber-600 bg-amber-300 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-950',
        className,
      )}
    >
      Demo data
    </span>
  );
}

export function StatusBadge({ state, className }: { state: TrainState; className?: string }) {
  const meta = STATE_META[state];
  const Icon = STATE_ICONS[state];
  return (
    <span
      data-testid="status-badge"
      data-state={state}
      title={meta.description}
      className={cn(BADGE_BASE, TONE_BADGE[meta.tone], className)}
    >
      <Icon aria-hidden />
      {meta.label}
    </span>
  );
}

/** Status for any result — falls back to the error's short label when there is no usable status. */
export function ResultStatusBadge({ result, className }: { result: TrackResult; className?: string }) {
  if (result.status) return <StatusBadge state={result.status.state} className={className} />;
  const meta = errorMeta(result.error?.code ?? null);
  return (
    <span
      data-testid="status-badge"
      data-state="error"
      title={meta.title}
      className={cn(BADGE_BASE, TONE_BADGE[meta.tone], className)}
    >
      <TriangleAlert aria-hidden />
      {meta.short}
    </span>
  );
}

export function DelayChip({ minutes, className }: { minutes: number | null | undefined; className?: string }) {
  const tone = delayTone(minutes);
  const text = formatDelay(minutes);
  return (
    <span
      data-testid="delay"
      className={cn(BADGE_BASE, 'font-mono tabular-nums', TONE_BADGE[tone], className)}
      title={minutes === null || minutes === undefined ? 'Delay unknown' : undefined}
    >
      {text === '—' ? (
        <>
          <span aria-hidden>—</span>
          <span className="sr-only">Delay unknown</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}

/** Small colour + shape swatch identifying a train on the map. */
export function TrainGlyph({
  shape,
  color,
  className,
  dashed = false,
  fill = '#ffffff',
}: {
  shape: TrainShape;
  color: string;
  className?: string;
  dashed?: boolean;
  /** Fill for the dashed (estimated) variant. */
  fill?: string;
}) {
  const points = SHAPE_POINTS[shape];
  const common = dashed
    ? { fill, stroke: color, strokeWidth: 2.6, strokeDasharray: '3.2 2.4' }
    : { fill: color, stroke: color === 'currentColor' ? 'none' : '#ffffff', strokeWidth: 2 };
  return (
    <svg viewBox="0 0 30 30" aria-hidden focusable="false" className={cn('size-4 shrink-0', className)}>
      {points === null ? <circle cx="15" cy="15" r="10.5" {...common} /> : <polygon points={points} {...common} />}
    </svg>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return <CircleDot aria-hidden className={cn('size-3.5', className)} />;
}
