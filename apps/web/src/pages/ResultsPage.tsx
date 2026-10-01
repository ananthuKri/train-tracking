import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  ChevronDown,
  Download,
  EyeOff,
  LayoutGrid,
  ListFilter,
  Mail,
  Map as MapGlyph,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Table2,
  Trash2,
  TrainTrack,
} from 'lucide-react';
import {
  MAX_TRAINS_PER_REQUEST,
  SORT_KEYS,
  SORT_LABELS,
  filterResults,
  sortResults,
  type ProviderId,
  type SortKey,
  type TrainFilters,
} from '@railtrack/shared';
import { exportCsvUrl, isApiError } from '@/api/client';
import { trackItemsInBatches } from '@/api/track';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { FilterPanel } from '@/components/dashboard/FilterPanel';
import { ResultsTable } from '@/components/dashboard/ResultsTable';
import { StatChips } from '@/components/dashboard/StatChips';
import { TrainMap, type MapTrain } from '@/components/map/LazyTrainMap';
import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { DemoBadge } from '@/components/train/badges';
import { errorMeta } from '@/components/train/errorMeta';
import { TrainCard } from '@/components/train/TrainCard';
import { TrainErrorState } from '@/components/train/TrainErrorState';
import { TrainSheet } from '@/components/train/TrainSheet';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNow } from '@/hooks/useNow';
import { activeFilterCount, exportSearchParams, parseFilterParams, writeFilterParams } from '@/lib/filterParams';
import { ist } from '@/lib/time';
import { resultKey, serializeTrainRefs } from '@/lib/trainKey';
import { cn, plural } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard';

export default function ResultsPage() {
  useDocumentTitle('Dashboard');
  const navigate = useNavigate();
  const results = useDashboardStore((s) => s.results);
  const provider = useDashboardStore((s) => s.provider);
  const trackedAt = useDashboardStore((s) => s.trackedAt);
  const source = useDashboardStore((s) => s.source);
  const invalid = useDashboardStore((s) => s.invalid);
  const duplicates = useDashboardStore((s) => s.duplicates);
  const selectedKeys = useDashboardStore((s) => s.selectedKeys);
  const focusedKey = useDashboardStore((s) => s.focusedKey);
  const view = useDashboardStore((s) => s.view);
  const { toggleSelected, setSelected, setFocused, setView, upsertResults, clear } = useDashboardStore.getState();

  const [searchParams, setSearchParams] = useSearchParams();
  const { filters, sort } = useMemo(() => parseFilterParams(searchParams), [searchParams]);
  const now = useNow();
  const filtered = useMemo(() => sortResults(filterResults(results, filters, now), sort), [results, filters, sort, now]);

  const styleIndexMap = useMemo(() => new Map(results.map((r, i) => [resultKey(r), i])), [results]);
  const styleIndex = useCallback((key: string) => styleIndexMap.get(key) ?? 0, [styleIndexMap]);

  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(() => activeFilterCount(filters) > 0);
  const [showMap, setShowMap] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);

  const providers = useMemo(
    () => [...new Set(results.flatMap((r) => (r.status ? [r.status.provider.id] : [])))] as ProviderId[],
    [results],
  );

  // URL updates commit asynchronously; build each change on the latest requested params so quick
  // successive edits (e.g. sort, then a filter) don't overwrite each other with stale values.
  const latestParams = useRef(searchParams);
  useEffect(() => {
    latestParams.current = searchParams;
  }, [searchParams]);
  const commitParams = (next: URLSearchParams) => {
    latestParams.current = next;
    setSearchParams(next, { replace: true });
  };
  const update = (patch: Partial<TrainFilters>, nextSort?: SortKey) => {
    const current = parseFilterParams(latestParams.current);
    commitParams(writeFilterParams({ ...current.filters, ...patch }, nextSort ?? current.sort));
  };
  const replaceFilters = (next: TrainFilters) => {
    const current = parseFilterParams(latestParams.current);
    commitParams(writeFilterParams({ q: current.filters.q, ...next }, current.sort));
  };

  const selected = useMemo(() => results.filter((r) => selectedKeys.includes(resultKey(r))), [results, selectedKeys]);
  const scope = selected.length ? selected : filtered;
  const exportHref = exportCsvUrl(exportSearchParams(selected.length ? selected : results, filters, sort));

  const mapTrains: MapTrain[] = useMemo(
    () => filtered.flatMap((r) => (r.status ? [{ key: resultKey(r), status: r.status, styleIndex: styleIndex(resultKey(r)) }] : [])),
    [filtered, styleIndex],
  );

  const sheetResult = sheetKey ? (results.find((r) => resultKey(r) === sheetKey) ?? null) : null;
  const openSheet = (key: string) => {
    setFocused(key);
    setSheetKey(key);
  };

  const refreshAll = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const items = results.map((r) => ({ trainNumber: r.trainNumber, journeyDate: r.journeyDate }));
      const { response, partialError, untracked } = await trackItemsInBatches(items, {
        source: source ?? 'manual',
        forceRefresh: true,
      });
      upsertResults(response.results, { provider: response.provider });
      if (partialError) {
        setRefreshError(partialError);
        toast.warning(`Refreshed ${items.length - untracked.length} of ${items.length} trains`, { description: partialError.message });
      } else {
        toast.success(`Refreshed ${plural(response.summary.ok, 'train')}`, {
          description: response.summary.failed ? `${response.summary.failed} could not be fetched` : undefined,
        });
      }
    } catch (error) {
      setRefreshError(error);
      toast.error(isApiError(error) ? errorMeta(error.code).title : 'Refresh failed', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const emailReport = () => {
    const refs = scope.slice(0, MAX_TRAINS_PER_REQUEST);
    if (scope.length > MAX_TRAINS_PER_REQUEST) toast.info(`Reports include up to ${MAX_TRAINS_PER_REQUEST} trains — the first ${MAX_TRAINS_PER_REQUEST} were selected.`);
    navigate(`/reports/new?trains=${encodeURIComponent(serializeTrainRefs(refs))}`);
  };

  if (results.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Results for the trains you track appear here." />
        <EmptyState
          testId="results-empty"
          icon={TrainTrack}
          title="No trains tracked yet"
          description="Enter one or more train numbers, or upload a CSV/Excel sheet, to see live status, delays and positions."
          action={
            <Button asChild>
              <Link to="/">
                <Plus aria-hidden /> Track trains
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const filterCount = activeFilterCount(filters);

  return (
    <div data-testid="results-page" className="space-y-5">
      <PageHeader
        title="Dashboard"
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {plural(results.length, 'train')} · {source === 'upload' ? 'from upload' : 'entered manually'}
              {trackedAt ? ` · tracked ${ist(trackedAt)}` : ''}
              {provider ? ` · via ${provider.name}` : ''}
            </span>
            {provider?.isDemo && <DemoBadge />}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void refreshAll()} disabled={refreshing} data-testid="refresh-all">
              <RefreshCw aria-hidden className={cn(refreshing && 'animate-spin')} />
              {refreshing ? 'Refreshing…' : 'Refresh all'}
            </Button>
            <Button variant="outline" asChild>
              <a href={exportHref} download data-testid="export-csv">
                <Download aria-hidden />
                Export CSV{selected.length ? ` (${selected.length})` : ''}
              </a>
            </Button>
            <Button onClick={emailReport} data-testid="email-report" disabled={scope.length === 0}>
              <Mail aria-hidden />
              Email report{selected.length ? ` (${selected.length})` : ''}
            </Button>
          </>
        }
      />

      {(invalid.length > 0 || duplicates.length > 0) && (
        <Alert tone="info" title="Some input was skipped" data-testid="skipped-input">
          {invalid.length > 0 && (
            <p>
              Invalid:{' '}
              {invalid.map((i, idx) => (
                <span key={`${i.input}-${idx}`}>
                  {idx > 0 && ', '}
                  <span className="font-mono">{i.input}</span> ({i.reason})
                </span>
              ))}
            </p>
          )}
          {duplicates.length > 0 && (
            <p>
              Duplicates tracked once: <span className="font-mono">{duplicates.join(', ')}</span>
            </p>
          )}
        </Alert>
      )}

      {refreshError != null && (
        <TrainErrorState
          compact
          code={isApiError(refreshError) ? refreshError.code : null}
          message={refreshError instanceof Error ? refreshError.message : null}
          retryAfterSeconds={isApiError(refreshError) ? refreshError.retryAfterSeconds : null}
          onRetry={() => void refreshAll()}
          retrying={refreshing}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setRefreshError(null)}>
              Dismiss
            </Button>
          }
        />
      )}

      <StatChips results={results} filters={filters} onApply={replaceFilters} />

      <section aria-labelledby="map-heading" className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 id="map-heading" className="text-sm font-semibold">
            Map{' '}
            <span className="font-normal text-muted-foreground">
({plural(mapTrains.length, 'train')} · select one in the legend, list or map to focus)
            </span>
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setShowMap((v) => !v)} aria-expanded={showMap} aria-controls="dashboard-map">
            {showMap ? <EyeOff aria-hidden /> : <MapGlyph aria-hidden />}
            {showMap ? 'Hide map' : 'Show map'}
          </Button>
        </div>
        {showMap && (
          <div id="dashboard-map">
            {mapTrains.length > 0 ? (
              <TrainMap
                trains={mapTrains}
                focusedKey={focusedKey}
                onFocusChange={setFocused}
                heightClass="h-[340px] sm:h-[400px]"
                label="Map of tracked trains"
              />
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No trains with map data match the current filters.
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="sr-only">
          Train list
        </h2>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="dashboard-search" className="sr-only">
              Search trains
            </Label>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="dashboard-search"
                type="search"
                data-testid="search-input"
                placeholder="Search by train number, name or station"
                value={filters.q ?? ''}
                onChange={(e) => update({ q: e.target.value || undefined })}
                className="pl-8"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-controls="filter-panel"
              data-testid="filter-toggle"
            >
              <ListFilter aria-hidden />
              Filters
              {filterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] leading-5 text-primary-foreground">
                  {filterCount}
                  <span className="sr-only"> active</span>
                </span>
              )}
              <ChevronDown aria-hidden className={cn('transition-transform', showFilters && 'rotate-180')} />
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="dashboard-sort" className="text-xs text-muted-foreground">
                Sort by
              </Label>
              <NativeSelect
                id="dashboard-sort"
                data-testid="sort-select"
                className="w-52"
                value={sort}
                onChange={(e) => update({}, e.target.value as SortKey)}
              >
                {SORT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div role="group" aria-label="View" className="inline-flex rounded-md border p-0.5">
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={view === 'table'}
                onClick={() => setView('table')}
                data-testid="view-table"
                className={cn(view === 'table' && 'bg-accent text-accent-foreground')}
              >
                <Table2 aria-hidden /> Table
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={view === 'cards'}
                onClick={() => setView('cards')}
                data-testid="view-cards"
                className={cn(view === 'cards' && 'bg-accent text-accent-foreground')}
              >
                <LayoutGrid aria-hidden /> Cards
              </Button>
            </div>
          </div>
        </div>

        {showFilters && <FilterPanel id="filter-panel" filters={filters} onChange={(patch) => update(patch)} providers={providers} />}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p aria-live="polite" data-testid="results-count" className="text-muted-foreground">
            Showing {filtered.length} of {plural(results.length, 'train')}
            {selected.length > 0 && ` · ${selected.length} selected`}
          </p>
          <div className="flex items-center gap-2">
            {selected.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                Clear selection
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" data-testid="clear-dashboard">
                  <Trash2 aria-hidden /> Clear dashboard
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear the dashboard?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes all {plural(results.length, 'tracked train')} from this browser. Your signed-in tracking history is not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      clear();
                      navigate('/');
                    }}
                  >
                    Clear
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            testId="results-no-match"
            icon={SearchX}
            title="No trains match"
            description="Try a different search or clear the filters."
            action={
              <Button variant="outline" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                Clear search and filters
              </Button>
            }
          />
        ) : view === 'table' ? (
          <ResultsTable
            results={filtered}
            styleIndex={styleIndex}
            selectedKeys={selectedKeys}
            focusedKey={focusedKey}
            onToggleSelect={toggleSelected}
            onSelectAll={(all) =>
              setSelected(
                all
                  ? [...new Set([...selectedKeys, ...filtered.map(resultKey)])]
                  : selectedKeys.filter((k) => !filtered.some((r) => resultKey(r) === k)),
              )
            }
            onOpen={openSheet}
            onFocus={setFocused}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="results-cards">
            <AnimatePresence mode="popLayout" initial={false}>
              {filtered.map((r) => {
                const key = resultKey(r);
                return (
                  <TrainCard
                    key={key}
                    result={r}
                    styleIndex={styleIndex(key)}
                    selected={selectedKeys.includes(key)}
                    focused={focusedKey === key}
                    onToggleSelect={() => toggleSelected(key)}
                    onOpen={() => openSheet(key)}
                    onFocus={() => setFocused(key)}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </section>

      <TrainSheet
        result={sheetResult}
        styleIndex={sheetKey ? styleIndex(sheetKey) : 0}
        open={!!sheetKey}
        onOpenChange={(open) => !open && setSheetKey(null)}
      />
    </div>
  );
}
