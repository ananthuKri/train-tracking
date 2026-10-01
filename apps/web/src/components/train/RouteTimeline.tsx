import { useId, useMemo, useState, type ComponentType } from 'react';
import { Circle, CircleCheck, CircleSlash, CircleX, Shuffle, TrainFront } from 'lucide-react';
import { formatIst, type NormalizedStop, type StopStatus } from '@railtrack/shared';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { DelayChip } from './badges';

const STOP_STATUS_META: Record<
  StopStatus,
  { label: string; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; className: string; showLabel: boolean }
> = {
  departed: { label: 'Departed', icon: CircleCheck, className: 'text-primary', showLabel: false },
  arrived: { label: 'Arrived', icon: CircleCheck, className: 'text-primary', showLabel: false },
  current: { label: 'Current', icon: TrainFront, className: 'text-primary-foreground bg-primary rounded-full p-0.5', showLabel: true },
  upcoming: { label: 'Upcoming', icon: Circle, className: 'text-muted-foreground', showLabel: false },
  skipped: { label: 'Skipped', icon: CircleSlash, className: 'text-amber-700 dark:text-amber-300', showLabel: true },
  cancelled: { label: 'Cancelled', icon: CircleX, className: 'text-red-700 dark:text-red-300', showLabel: true },
  diverted: { label: 'Diverted', icon: Shuffle, className: 'text-amber-700 dark:text-amber-300', showLabel: true },
};

const PASSED: ReadonlySet<StopStatus> = new Set(['departed', 'arrived', 'current']);

function TimeCell({
  heading,
  scheduled,
  actual,
  expected,
  delay,
  emptyText,
}: {
  heading: string;
  scheduled: string | null;
  actual: string | null;
  expected: string | null;
  delay: number | null;
  emptyText: string;
}) {
  if (!scheduled && !actual && !expected) {
    return (
      <div className="text-xs text-muted-foreground">
        <span className="sm:hidden">{heading}: </span>
        {emptyText}
      </div>
    );
  }
  return (
    <div className="space-y-0.5 text-xs">
      <p className="flex items-baseline gap-1.5">
        <span className="text-muted-foreground sm:hidden">{heading}</span>
        <span className="text-muted-foreground">Sch</span>
        <span className="font-mono tabular-nums">{formatIst(scheduled, 'time')}</span>
      </p>
      {actual ? (
        <p className="flex items-baseline gap-1.5">
          <span className="font-medium text-foreground">Actual</span>
          <span className="font-mono font-semibold tabular-nums">{formatIst(actual, 'time')}</span>
        </p>
      ) : expected ? (
        <p className="flex items-baseline gap-1.5">
          <span className="italic text-muted-foreground">Expected</span>
          <span className="font-mono tabular-nums">{formatIst(expected, 'time')}</span>
        </p>
      ) : null}
      {delay !== null && delay !== 0 && <DelayChip minutes={delay} className="px-1.5 py-0 text-[11px]" />}
    </div>
  );
}

export function RouteTimeline({
  stops,
  compact,
  defaultShowPassThrough = false,
  className,
}: {
  stops: readonly NormalizedStop[];
  compact?: boolean;
  defaultShowPassThrough?: boolean;
  className?: string;
}) {
  const switchId = useId();
  const [showPassThrough, setShowPassThrough] = useState(defaultShowPassThrough);
  const passThroughCount = useMemo(() => stops.filter((s) => !s.isHalt).length, [stops]);
  const visible = useMemo(() => (showPassThrough ? stops : stops.filter((s) => s.isHalt || s.status === 'current')), [stops, showPassThrough]);
  const lastIndex = stops.length - 1;

  if (stops.length === 0) {
    return <p className="text-sm text-muted-foreground">Station-by-station route is not available for this train.</p>;
  }

  return (
    <div data-testid="route-timeline" className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          All times in IST · “Actual” = reported, “Expected” = provider estimate
        </p>
        {passThroughCount > 0 && (
          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              checked={showPassThrough}
              onCheckedChange={setShowPassThrough}
              data-testid="toggle-pass-through"
            />
            <Label htmlFor={switchId} className="text-xs font-normal">
              Show pass-through stations ({passThroughCount})
            </Label>
          </div>
        )}
      </div>

      <div
        aria-hidden
        className={cn(
          'hidden grid-cols-[2rem_minmax(0,1fr)_8.5rem_8.5rem_6.5rem] gap-3 border-b pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground',
          !compact && 'sm:grid',
        )}
      >
        <span />
        <span>Station</span>
        <span>Arrival (IST)</span>
        <span>Departure (IST)</span>
        <span className="text-right">Platform · km</span>
      </div>

      <ol aria-label="Route timeline" className="relative">
        {visible.map((stop) => {
          const meta = STOP_STATUS_META[stop.status];
          const Icon = meta.icon;
          const index = stops.indexOf(stop);
          const passed = PASSED.has(stop.status);
          const isOrigin = index === 0;
          const isDestination = index === lastIndex;
          return (
            <li
              key={`${stop.sequence}-${stop.stationCode}`}
              data-testid="timeline-stop"
              data-status={stop.status}
              data-halt={stop.isHalt}
              aria-current={stop.status === 'current' ? 'step' : undefined}
              className={cn(
                'relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 py-2.5',
                !compact && 'sm:grid-cols-[2rem_minmax(0,1fr)_8.5rem_8.5rem_6.5rem] sm:items-start',
                stop.status === 'current' && 'rounded-md bg-accent/60',
                !stop.isHalt && 'py-1.5 opacity-80',
              )}
            >
              {/* connector line */}
              <span
                aria-hidden
                className={cn(
                  'absolute left-4 top-0 h-full w-0.5 -translate-x-1/2',
                  passed ? 'bg-primary/70' : 'bg-border',
                  index === 0 && 'top-1/2 h-1/2',
                  index === lastIndex && 'h-1/2',
                )}
              />
              <span className="relative z-10 flex justify-center pt-0.5">
                <span className="rounded-full bg-background">
                  <Icon aria-hidden className={cn(stop.isHalt ? 'size-5' : 'size-3.5', meta.className)} />
                </span>
              </span>
              <div className="min-w-0">
                <p className={cn('truncate', stop.isHalt ? 'text-sm font-medium' : 'text-xs')}>
                  {stop.stationName}{' '}
                  <span className="font-mono text-xs font-normal text-muted-foreground">{stop.stationCode}</span>
                </p>
                <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                  <span className={cn(!meta.showLabel && 'sr-only')}>
                    <span className={cn(meta.showLabel && 'font-semibold text-foreground')}>{meta.label}</span>
                  </span>
                  {isOrigin && <span>Origin</span>}
                  {isDestination && <span>Destination</span>}
                  {!stop.isHalt && <span>Pass-through (no halt)</span>}
                  {stop.day !== null && <span>Day {stop.day}</span>}
                  <span className={cn(!compact && 'sm:hidden')}>
                    {stop.platform ? `PF ${stop.platform}` : ''}
                    {stop.platform && stop.distanceKm !== null ? ' · ' : ''}
                    {stop.distanceKm !== null ? `${Math.round(stop.distanceKm)} km` : ''}
                  </span>
                </p>
              </div>
              <div className={cn('col-start-2 grid grid-cols-2 gap-3', !compact && 'sm:contents')}>
                <TimeCell
                  heading="Arr"
                  scheduled={stop.scheduledArrival}
                  actual={stop.actualArrival}
                  expected={stop.expectedArrival}
                  delay={stop.arrivalDelayMinutes}
                  emptyText={isOrigin ? 'Starts' : '—'}
                />
                <TimeCell
                  heading="Dep"
                  scheduled={stop.scheduledDeparture}
                  actual={stop.actualDeparture}
                  expected={stop.expectedDeparture}
                  delay={stop.departureDelayMinutes}
                  emptyText={isDestination ? 'Ends' : '—'}
                />
              </div>
              <div className={cn('hidden text-right text-xs text-muted-foreground', !compact && 'sm:block')}>
                <p className="font-mono tabular-nums text-foreground">{stop.platform ? `PF ${stop.platform}` : '—'}</p>
                <p className="font-mono tabular-nums">{stop.distanceKm !== null ? `${Math.round(stop.distanceKm)} km` : '—'}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
