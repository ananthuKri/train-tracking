import type { ReactNode } from 'react';
import { Flag, MapPin, Navigation, SignpostBig, TrainFront, Clock } from 'lucide-react';
import { relativeTime, type NormalizedTrainStatus, type StationRef } from '@railtrack/shared';
import { useNow } from '@/hooks/useNow';
import { ist } from '@/lib/time';
import { cn } from '@/lib/utils';
import { DelayChip } from './badges';

export const EVENT_LABELS: Record<'arrived' | 'departed' | 'passed', string> = {
  arrived: 'Arrived at',
  departed: 'Departed from',
  passed: 'Passed',
};

export function stationText(ref: StationRef | null | undefined): string {
  return ref ? `${ref.name} (${ref.code})` : '—';
}

function Fact({ icon: Icon, label, children, className }: { icon: typeof Flag; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border bg-card p-3', className)}>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </dt>
      <dd className="mt-1.5 space-y-0.5 text-sm">{children}</dd>
    </div>
  );
}

function TimeLine({ label, value, emphasis }: { label: string; value: string | null; emphasis?: boolean }) {
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-mono tabular-nums', emphasis && 'font-semibold')}>{value ? ist(value) : '—'}</span>
    </p>
  );
}

export function KeyFacts({ status, className }: { status: NormalizedTrainStatus; className?: string }) {
  const now = useNow();
  return (
    <dl data-testid="key-facts" className={cn('grid gap-3 sm:grid-cols-2', className)}>
      <Fact icon={TrainFront} label="Origin">
        <p className="font-medium">{stationText(status.source)}</p>
        <TimeLine label="Scheduled departure" value={status.scheduledDeparture} />
        <TimeLine label="Actual departure" value={status.actualDeparture} emphasis />
      </Fact>
      <Fact icon={Flag} label="Destination">
        <p className="font-medium">{stationText(status.destination)}</p>
        <TimeLine label="Scheduled arrival" value={status.scheduledArrival} />
        {status.actualArrival ? (
          <TimeLine label="Actual arrival" value={status.actualArrival} emphasis />
        ) : (
          <TimeLine label="Expected arrival" value={status.expectedArrival} emphasis />
        )}
      </Fact>
      <Fact icon={MapPin} label="Last reported">
        {status.lastReportedStation ? (
          <>
            <p className="font-medium">
              {status.lastReportedEvent ? `${EVENT_LABELS[status.lastReportedEvent]} ` : ''}
              {stationText(status.lastReportedStation)}
            </p>
            {status.lastReportedAt && (
              <p className="text-xs text-muted-foreground">
                <time dateTime={status.lastReportedAt} className="font-mono tabular-nums text-foreground">
                  {ist(status.lastReportedAt)}
                </time>{' '}
                ({relativeTime(status.lastReportedAt, now)})
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">No station report yet</p>
        )}
      </Fact>
      <Fact icon={Navigation} label="Next station">
        {status.nextStation ? (
          <>
            <p className="font-medium">{stationText(status.nextStation)}</p>
            <TimeLine label="Expected arrival" value={status.nextStationEta} emphasis />
          </>
        ) : (
          <p className="text-muted-foreground">{status.state === 'arrived' ? 'Journey complete' : '—'}</p>
        )}
      </Fact>
      <Fact icon={SignpostBig} label="Platform">
        <p className="font-mono text-base tabular-nums">{status.platform ?? '—'}</p>
        {!status.platform && <p className="text-xs text-muted-foreground">Not reported by the provider</p>}
      </Fact>
      <Fact icon={Clock} label="Running delay">
        <DelayChip minutes={status.delayMinutes} />
        {status.stateDetail && <p className="text-xs text-muted-foreground">{status.stateDetail}</p>}
      </Fact>
    </dl>
  );
}
