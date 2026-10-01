import { useEffect, useId } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, BellRing, Mail, RefreshCw } from 'lucide-react';
import {
  JOURNEY_DATE_MAX_FUTURE_DAYS,
  JOURNEY_DATE_MAX_PAST_DAYS,
  addDaysToDate,
  formatJourneyDate,
  isValidIsoDate,
  isValidTrainNumber,
  relativeTime,
  todayInIst,
  type TrackResult,
} from '@railtrack/shared';
import { isApiError } from '@/api/client';
import { TRAIN_REFETCH_MS, useRefreshTrain, useSnapshots, useTrainRoute, useTrainStatus } from '@/api/hooks';
import { TrainMap } from '@/components/map/LazyTrainMap';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { DelayChip, DemoBadge, ResultStatusBadge } from '@/components/train/badges';
import { DelayHistory } from '@/components/train/DelayHistory';
import { errorMeta } from '@/components/train/errorMeta';
import { ExceptionBanners } from '@/components/train/ExceptionBanners';
import { JourneyProgress } from '@/components/train/JourneyProgress';
import { KeyFacts } from '@/components/train/KeyFacts';
import { RouteTimeline } from '@/components/train/RouteTimeline';
import { ScheduledRoute } from '@/components/train/ScheduledRoute';
import { SourceFreshness } from '@/components/train/SourceFreshness';
import { TrainErrorState } from '@/components/train/TrainErrorState';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNow } from '@/hooks/useNow';
import { ist } from '@/lib/time';
import { serializeTrainRefs, trainKey } from '@/lib/trainKey';
import { cn } from '@/lib/utils';
import { selectResult, useDashboardStore } from '@/stores/dashboard';
import { useReportDemo } from '@/stores/demo';

const ROUTE_FALLBACK_CODES = new Set(['NOT_RUNNING_ON_DATE', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED']);

export default function TrainDetailPage() {
  const { trainNumber = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayInIst();
  const dateParam = searchParams.get('date');
  const journeyDate = dateParam && isValidIsoDate(dateParam) ? dateParam : today;
  const validNumber = isValidTrainNumber(trainNumber);
  const dateId = useId();
  const now = useNow();

  const stored = useDashboardStore(selectResult(trainNumber, journeyDate));
  const upsert = useDashboardStore((s) => s.upsertResults);
  const query = useTrainStatus(trainNumber, journeyDate, { enabled: validNumber, placeholder: stored });
  const refresh = useRefreshTrain();

  // Keep showing the last known result if a background refetch fails.
  const result: TrackResult | undefined = query.data ?? (query.isError ? stored : undefined);
  const status = result?.status ?? null;
  const queryErrorCode = isApiError(query.error) ? query.error.code : null;

  useDocumentTitle(validNumber ? `${trainNumber}${status ? ` ${status.trainName}` : ''}` : 'Train');
  useReportDemo(`detail-${trainNumber}-${journeyDate}`, !!status?.provider.isDemo);

  useEffect(() => {
    if (query.data && !query.isPlaceholderData) upsert([query.data], { onlyExisting: true });
  }, [query.data, query.isPlaceholderData, upsert]);

  const snapshots = useSnapshots(trainNumber, journeyDate, validNumber && !!status);
  const routeCode = query.error ? queryErrorCode : (result?.error?.code ?? null);
  const needRoute =
    validNumber && ((!status && !!routeCode && ROUTE_FALLBACK_CODES.has(routeCode)) || (!!status && status.stops.length === 0));
  const route = useTrainRoute(trainNumber, needRoute);

  const doRefresh = () =>
    refresh.mutate(
      { trainNumber, journeyDate },
      {
        onSuccess: (r) => {
          if (r.status?.freshness === 'stale') toast.warning('Provider unavailable — still showing the last verified result');
          else if (r.ok) toast.success(`Train ${trainNumber} refreshed`);
        },
      },
    );

  if (!validNumber) {
    return (
      <TrainErrorState
        code="INVALID_TRAIN_NUMBER"
        trainNumber={trainNumber}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/">Track a train</Link>
          </Button>
        }
      />
    );
  }

  const backToDashboard = stored ? (
    <Link to="/results" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden className="size-4" /> Dashboard
    </Link>
  ) : (
    <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden className="size-4" /> Track another train
    </Link>
  );

  const refreshError = refresh.error;

  return (
    <div data-testid="train-detail" className="space-y-5">
      {backToDashboard}

      <header data-testid="train-header" className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Journey {formatJourneyDate(journeyDate)}
          </p>
          <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-3xl font-semibold tabular-nums">{trainNumber}</span>
            {status ? (
              <span className="text-2xl font-semibold tracking-tight">{status.trainName}</span>
            ) : query.isLoading ? (
              <Skeleton className="h-7 w-56" />
            ) : null}
          </h1>
          {status && (
            <p className="text-sm text-muted-foreground">
              {status.source.name} ({status.source.code}) → {status.destination.name} ({status.destination.code})
            </p>
          )}
          {result && (
            <div className="flex flex-wrap items-center gap-1.5">
              <ResultStatusBadge result={result} />
              {status && <DelayChip minutes={status.delayMinutes} />}
              {status?.provider.isDemo && <DemoBadge />}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={dateId} className="text-xs text-muted-foreground">
              Journey date
            </Label>
            <Input
              id={dateId}
              type="date"
              value={journeyDate}
              min={addDaysToDate(today, -JOURNEY_DATE_MAX_PAST_DAYS)}
              max={addDaysToDate(today, JOURNEY_DATE_MAX_FUTURE_DAYS)}
              onChange={(e) => e.target.value && setSearchParams({ date: e.target.value }, { replace: true })}
              className="h-9 w-44"
            />
          </div>
          <Button variant="outline" onClick={doRefresh} disabled={refresh.isPending} data-testid="refresh-train">
            <RefreshCw aria-hidden className={cn(refresh.isPending && 'animate-spin')} />
            {refresh.isPending ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="outline" asChild data-testid="monitor-train">
            <Link to={`/monitoring?train=${trainNumber}&date=${journeyDate}`}>
              <BellRing aria-hidden /> Monitor
            </Link>
          </Button>
          <Button asChild data-testid="email-train">
            <Link to={`/reports/new?trains=${encodeURIComponent(serializeTrainRefs([{ trainNumber, journeyDate }]))}`}>
              <Mail aria-hidden /> Email report
            </Link>
          </Button>
        </div>
      </header>

      <div aria-live="polite" className="space-y-3 empty:hidden">
        {refreshError && (
          <TrainErrorState
            compact
            code={isApiError(refreshError) ? refreshError.code : null}
            message={refreshError.message}
            retryAfterSeconds={isApiError(refreshError) ? refreshError.retryAfterSeconds : null}
            trainNumber={trainNumber}
            journeyDate={journeyDate}
            onRetry={doRefresh}
            retrying={refresh.isPending}
          />
        )}
        {query.isError && status && (
          <Alert tone="warning" title={`Couldn't update: ${errorMeta(queryErrorCode).title}`} role="status">
            Showing the result fetched {ist(status.fetchedAt)} ({relativeTime(status.fetchedAt, now)}). {query.error.message}
          </Alert>
        )}
      </div>

      {query.isLoading && !result ? (
        <DetailSkeleton />
      ) : !result ? (
        <>
          <TrainErrorState
            code={queryErrorCode}
            message={query.error?.message}
            retryAfterSeconds={isApiError(query.error) ? query.error.retryAfterSeconds : null}
            trainNumber={trainNumber}
            journeyDate={journeyDate}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
          {route.data && <ScheduledRouteCard route={route.data} journeyDate={journeyDate} />}
        </>
      ) : !status ? (
        <>
          <TrainErrorState
            code={result.error?.code}
            message={result.error?.message}
            retryAfterSeconds={result.error?.retryAfterSeconds}
            trainNumber={trainNumber}
            journeyDate={journeyDate}
            onRetry={doRefresh}
            retrying={refresh.isPending}
          />
          {route.data && <ScheduledRouteCard route={route.data} journeyDate={journeyDate} />}
        </>
      ) : (
        <>
          <SourceFreshness status={status} error={result.error} />
          <ExceptionBanners status={status} />

          <Card className="gap-3 py-4">
            <CardContent className="px-4">
              <JourneyProgress status={status} />
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <section aria-labelledby="map-heading" className="space-y-2 lg:col-span-2">
              <h2 id="map-heading" className="text-sm font-semibold">
                Map
              </h2>
              <TrainMap
                trains={[{ key: trainKey(result), status, styleIndex: 0 }]}
                heightClass="h-[360px] sm:h-[460px]"
                scrollWheelZoom
                detailLinks={false}
                label={`Map of train ${trainNumber}`}
              />
            </section>
            <section aria-labelledby="facts-heading" className="space-y-2">
              <h2 id="facts-heading" className="text-sm font-semibold">
                Key facts
              </h2>
              <KeyFacts status={status} className="sm:grid-cols-2 lg:grid-cols-1" />
            </section>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Route timeline</CardTitle>
                <CardDescription>Station-by-station schedule with reported (actual) and expected times.</CardDescription>
              </CardHeader>
              <CardContent>
                {status.stops.length > 0 ? (
                  <RouteTimeline stops={status.stops} />
                ) : route.data ? (
                  <ScheduledRoute route={route.data} journeyDate={journeyDate} />
                ) : (
                  <p className="text-sm text-muted-foreground">Route details are not available.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Delay history</CardTitle>
                <CardDescription>Verified fetches for this journey, newest first.</CardDescription>
              </CardHeader>
              <CardContent>
                <DelayHistory
                  items={snapshots.data?.items}
                  isLoading={snapshots.isLoading}
                  error={snapshots.error ? snapshots.error.message : null}
                />
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground">
            Updates automatically every {TRAIN_REFETCH_MS / 60_000} minutes while this tab is visible
            {query.dataUpdatedAt ? ` · last checked ${ist(new Date(query.dataUpdatedAt), 'time')}` : ''}.
          </p>
        </>
      )}
    </div>
  );
}

function ScheduledRouteCard({ route, journeyDate }: { route: NonNullable<ReturnType<typeof useTrainRoute>['data']>; journeyDate: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {route.trainNumber} {route.trainName} — scheduled route
        </CardTitle>
        <CardDescription>Live running status is unavailable; this is the published timetable.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScheduledRoute route={route} journeyDate={journeyDate} />
      </CardContent>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading train status">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-[360px] lg:col-span-2" />
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
