import { useId } from 'react';
import { motion } from 'framer-motion';
import { deriveProgress, type NormalizedTrainStatus } from '@railtrack/shared';
import { cn } from '@/lib/utils';

type ProgressInput = Pick<
  NormalizedTrainStatus,
  'state' | 'stops' | 'position' | 'lastReportedStation' | 'distanceTravelledKm' | 'distanceRemainingKm' | 'totalDistanceKm' | 'progressPercent'
>;

export function progressFor(status: ProgressInput) {
  if (status.progressPercent !== null || status.distanceTravelledKm !== null) {
    const total = status.totalDistanceKm;
    const travelled = status.distanceTravelledKm;
    const percent =
      status.progressPercent ?? (travelled !== null && total ? Math.round((travelled / total) * 1000) / 10 : null);
    return {
      travelledKm: travelled,
      remainingKm: status.distanceRemainingKm ?? (travelled !== null && total !== null ? total - travelled : null),
      totalKm: total,
      percent,
    };
  }
  return deriveProgress(status);
}

const km = (v: number | null) => (v === null ? '—' : `${Math.round(v).toLocaleString('en-IN')} km`);

export function JourneyProgress({ status, className, compact }: { status: ProgressInput; className?: string; compact?: boolean }) {
  const labelId = useId();
  const p = progressFor(status);
  const percent = p.percent === null ? null : Math.max(0, Math.min(100, p.percent));
  return (
    <div data-testid="journey-progress" className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span id={labelId}>Journey progress</span>
        <span className="font-mono tabular-nums text-foreground">{percent === null ? 'Unknown' : `${Math.round(percent)}%`}</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.round(percent)}
        aria-valuetext={
          percent === null ? 'Progress unknown' : `${Math.round(percent)}% — ${km(p.travelledKm)} travelled, ${km(p.remainingKm)} remaining`
        }
        className={cn('relative overflow-hidden rounded-full bg-muted', compact ? 'h-1.5' : 'h-2.5')}
      >
        {percent !== null && (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        )}
      </div>
      {!compact && (
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Travelled</dt>
            <dd className="font-mono tabular-nums">{km(p.travelledKm)}</dd>
          </div>
          <div className="text-center">
            <dt className="text-muted-foreground">Remaining</dt>
            <dd className="font-mono tabular-nums">{km(p.remainingKm)}</dd>
          </div>
          <div className="text-right">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-mono tabular-nums">{km(p.totalKm)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
