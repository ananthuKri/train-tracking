import { useId } from 'react';
import { X } from 'lucide-react';
import {
  PROVIDER_NAMES,
  STATE_META,
  TRAIN_STATES,
  type ProviderId,
  type TrainFilters,
  type TrainState,
} from '@railtrack/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { STATE_ICONS } from '@/components/train/badges';
import { TONE_BADGE } from '@/lib/tone';
import { cn } from '@/lib/utils';

const UPDATED_WITHIN = [
  { value: '', label: 'Any time' },
  { value: '15', label: 'Last 15 min' },
  { value: '30', label: 'Last 30 min' },
  { value: '60', label: 'Last hour' },
  { value: '180', label: 'Last 3 hours' },
  { value: '720', label: 'Last 12 hours' },
];

const toInt = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};

export function FilterPanel({
  id,
  filters,
  onChange,
  providers,
}: {
  id: string;
  filters: TrainFilters;
  onChange: (patch: Partial<TrainFilters>) => void;
  providers: ProviderId[];
}) {
  const uid = useId();
  const statuses = filters.statuses ?? [];
  const toggleStatus = (state: TrainState) =>
    onChange({ statuses: statuses.includes(state) ? statuses.filter((s) => s !== state) : [...statuses, state] });
  const selectedProviders = filters.providers ?? [];

  return (
    <section id={id} aria-label="Filters" className="space-y-4 rounded-lg border bg-card p-4" data-testid="filter-panel">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Status</legend>
        <div className="flex flex-wrap gap-1.5">
          {TRAIN_STATES.map((state) => {
            const meta = STATE_META[state];
            const Icon = STATE_ICONS[state];
            const on = statuses.includes(state);
            return (
              <button
                key={state}
                type="button"
                aria-pressed={on}
                data-testid={`filter-status-${state}`}
                onClick={() => toggleStatus(state)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? cn(TONE_BADGE[meta.tone], 'ring-1 ring-current') : 'bg-background text-muted-foreground hover:bg-accent',
                )}
              >
                <Icon aria-hidden className="size-3.5" />
                {meta.label}
                {on && <span className="sr-only"> (selected)</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Delay (minutes)</legend>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${uid}-min`} className="sr-only">
              Minimum delay in minutes
            </Label>
            <Input
              id={`${uid}-min`}
              type="number"
              inputMode="numeric"
              placeholder="Min"
              data-testid="filter-min-delay"
              value={filters.minDelay ?? ''}
              onChange={(e) => onChange({ minDelay: toInt(e.target.value) })}
            />
            <span aria-hidden className="text-muted-foreground">
              –
            </span>
            <Label htmlFor={`${uid}-max`} className="sr-only">
              Maximum delay in minutes
            </Label>
            <Input
              id={`${uid}-max`}
              type="number"
              inputMode="numeric"
              placeholder="Max"
              data-testid="filter-max-delay"
              value={filters.maxDelay ?? ''}
              onChange={(e) => onChange({ maxDelay: toInt(e.target.value) })}
            />
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-station`}>Route station</Label>
          <Input
            id={`${uid}-station`}
            placeholder="Code or name, e.g. KOTA"
            data-testid="filter-station"
            value={filters.station ?? ''}
            onChange={(e) => onChange({ station: e.target.value || undefined })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${uid}-source`}>Source</Label>
          <Input
            id={`${uid}-source`}
            placeholder="Origin station"
            data-testid="filter-source"
            value={filters.source ?? ''}
            onChange={(e) => onChange({ source: e.target.value || undefined })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${uid}-dest`}>Destination</Label>
          <Input
            id={`${uid}-dest`}
            placeholder="Terminating station"
            data-testid="filter-destination"
            value={filters.destination ?? ''}
            onChange={(e) => onChange({ destination: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${uid}-updated`}>Last updated</Label>
          <NativeSelect
            id={`${uid}-updated`}
            data-testid="filter-updated-within"
            className="w-44"
            value={filters.updatedWithinMinutes ? String(filters.updatedWithinMinutes) : ''}
            onChange={(e) => onChange({ updatedWithinMinutes: toInt(e.target.value) })}
          >
            {UPDATED_WITHIN.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {providers.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Provider</legend>
            <div className="flex flex-wrap gap-3">
              {providers.map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <Checkbox
                    id={`${uid}-prov-${p}`}
                    data-testid={`filter-provider-${p}`}
                    checked={selectedProviders.includes(p)}
                    onCheckedChange={(v) =>
                      onChange({
                        providers: v === true ? [...selectedProviders, p] : selectedProviders.filter((x) => x !== p),
                      })
                    }
                  />
                  <Label htmlFor={`${uid}-prov-${p}`} className="font-normal">
                    {PROVIDER_NAMES[p]}
                  </Label>
                </div>
              ))}
            </div>
          </fieldset>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          data-testid="filter-clear"
          onClick={() =>
            onChange({
              statuses: undefined,
              minDelay: undefined,
              maxDelay: undefined,
              station: undefined,
              source: undefined,
              destination: undefined,
              updatedWithinMinutes: undefined,
              providers: undefined,
            })
          }
        >
          <X aria-hidden /> Clear filters
        </Button>
      </div>
    </section>
  );
}
