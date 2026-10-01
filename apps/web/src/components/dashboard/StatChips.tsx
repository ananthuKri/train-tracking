import { useMemo } from 'react';
import { CircleOff, Clock3, Layers, Shuffle, TrainFront } from 'lucide-react';
import { resultStates, type TrackResult, type TrainFilters } from '@railtrack/shared';
import { cn } from '@/lib/utils';

export interface DashboardStats {
  total: number;
  enRoute: number;
  delayed: number;
  exceptions: number;
  unavailable: number;
}

export function computeStats(results: readonly TrackResult[]): DashboardStats {
  const stats: DashboardStats = { total: results.length, enRoute: 0, delayed: 0, exceptions: 0, unavailable: 0 };
  for (const r of results) {
    const states = resultStates(r);
    if (states.has('departed') || states.has('running')) stats.enRoute++;
    if ((r.status?.delayMinutes ?? 0) > 30) stats.delayed++;
    if (states.has('cancelled') || states.has('diverted')) stats.exceptions++;
    if (!r.ok || states.has('unavailable')) stats.unavailable++;
  }
  return stats;
}

type ChipId = 'total' | 'enRoute' | 'delayed' | 'exceptions' | 'unavailable';

const CHIPS: { id: ChipId; label: string; icon: typeof Layers; filters: TrainFilters; tone: string }[] = [
  { id: 'total', label: 'Total', icon: Layers, filters: {}, tone: '' },
  { id: 'enRoute', label: 'En route', icon: TrainFront, filters: { statuses: ['departed', 'running'] }, tone: 'text-sky-700 dark:text-sky-300' },
  { id: 'delayed', label: 'Delayed > 30 min', icon: Clock3, filters: { minDelay: 31 }, tone: 'text-red-700 dark:text-red-300' },
  {
    id: 'exceptions',
    label: 'Cancelled / diverted',
    icon: Shuffle,
    filters: { statuses: ['cancelled', 'diverted'] },
    tone: 'text-amber-700 dark:text-amber-300',
  },
  { id: 'unavailable', label: 'Unavailable', icon: CircleOff, filters: { statuses: ['unavailable'] }, tone: 'text-slate-600 dark:text-slate-300' },
];

const sameFilters = (a: TrainFilters, b: TrainFilters) => {
  const norm = (f: TrainFilters) => JSON.stringify({ statuses: f.statuses ?? [], minDelay: f.minDelay, maxDelay: f.maxDelay });
  const others = (f: TrainFilters) => !!(f.station || f.source || f.destination || f.updatedWithinMinutes || f.providers?.length);
  return norm(a) === norm(b) && !others(a);
};

/** Summary counts over all tracked trains; each chip applies the matching quick filter. */
export function StatChips({
  results,
  filters,
  onApply,
}: {
  results: readonly TrackResult[];
  filters: TrainFilters;
  onApply: (filters: TrainFilters) => void;
}) {
  const stats = useMemo(() => computeStats(results), [results]);
  return (
    <ul aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {CHIPS.map((chip) => {
        const Icon = chip.icon;
        const active = sameFilters(filters, chip.filters);
        return (
          <li key={chip.id}>
            <button
              type="button"
              data-testid={`stat-${chip.id}`}
              aria-pressed={active}
              onClick={() => onApply(active && chip.id !== 'total' ? {} : chip.filters)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-left shadow-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                active && 'border-primary bg-accent',
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-xs font-medium leading-tight text-muted-foreground">
                <Icon aria-hidden className={cn('size-4 shrink-0', chip.tone)} />
                <span>{chip.label}</span>
              </span>
              <span className="font-mono text-xl font-semibold tabular-nums">{stats[chip.id]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
