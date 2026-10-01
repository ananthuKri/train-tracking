import {
  REPORT_FIELD_IDS,
  TrainFiltersQuerySchema,
  filtersToSearchParams,
  type ReportFieldId,
  type SortKey,
  type TrainFilters,
} from '@railtrack/shared';
import { serializeTrainRefs, type TrainRef } from './trainKey';

export const DEFAULT_SORT: SortKey = 'latest_update';

function clean(filters: TrainFilters): TrainFilters {
  const out: TrainFilters = {};
  for (const [k, v] of Object.entries(filters) as [keyof TrainFilters, unknown][]) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Read dashboard filters + sort from the URL (invalid params are ignored individually). */
export function parseFilterParams(params: URLSearchParams): { filters: TrainFilters; sort: SortKey } {
  const raw: Record<string, string> = {};
  for (const [k, v] of params.entries()) raw[k] = v;
  const whole = TrainFiltersQuerySchema.safeParse(raw);
  let data: Record<string, unknown> = {};
  if (whole.success) data = whole.data;
  else {
    for (const key of Object.keys(TrainFiltersQuerySchema.shape)) {
      if (!(key in raw)) continue;
      const one = TrainFiltersQuerySchema.safeParse({ [key]: raw[key] });
      if (one.success) data[key] = (one.data as Record<string, unknown>)[key];
    }
  }
  const { sort, ...filters } = data as TrainFilters & { sort?: SortKey };
  return { filters: clean(filters), sort: sort ?? DEFAULT_SORT };
}

export function writeFilterParams(filters: TrainFilters, sort: SortKey): URLSearchParams {
  return filtersToSearchParams(clean(filters), sort === DEFAULT_SORT ? undefined : sort);
}

export function activeFilterCount(filters: TrainFilters): number {
  return Object.entries(clean(filters)).filter(([k]) => k !== 'q').length;
}

/** Query for GET /api/tracking/export.csv — trains, fields, sort and the active filters. */
export function exportSearchParams(
  trains: readonly TrainRef[],
  filters: TrainFilters,
  sort: SortKey,
  fields: readonly ReportFieldId[] = REPORT_FIELD_IDS,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('trains', serializeTrainRefs(trains));
  params.set('fields', fields.join(','));
  for (const [k, v] of filtersToSearchParams(clean(filters), sort)) params.set(k, v);
  return params;
}
