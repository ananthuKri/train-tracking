import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  FileSpreadsheet,
  History,
  Keyboard,
  LoaderCircle,
  MapPinned,
  RotateCcw,
  ShieldCheck,
  TrainFront,
} from 'lucide-react';
import {
  JOURNEY_DATE_MAX_FUTURE_DAYS,
  JOURNEY_DATE_MAX_PAST_DAYS,
  MAX_TRAINS_PER_REQUEST,
  addDaysToDate,
  checkJourneyDate,
  formatJourneyDate,
  parseTrainNumbers,
  relativeTime,
  todayInIst,
  type TrackResponse,
  type TrackingHistoryItem,
} from '@railtrack/shared';
import { isApiError } from '@/api/client';
import { queryKeys, useMe, useTrack, useTrackingHistory } from '@/api/hooks';
import { trackItemsInBatches } from '@/api/track';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrainErrorState } from '@/components/train/TrainErrorState';
import { TrainNumberInput } from '@/components/train/TrainNumberInput';
import { UploadPanel } from '@/components/upload/UploadPanel';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNow } from '@/hooks/useNow';
import { ist } from '@/lib/time';
import type { TrainRef } from '@/lib/trainKey';
import { plural } from '@/lib/utils';
import { useDashboardStore, type ResultSource } from '@/stores/dashboard';

const EXAMPLES = [
  { label: '12082', value: '12082' },
  { label: '12082, 12627, 16348', value: '12082, 12627, 16348' },
  { label: '22691, 12622, 12859', value: '22691, 12622, 12859' },
];

function summaryToast(response: TrackResponse) {
  const { ok, failed } = response.summary;
  const extra = [
    response.invalid.length ? plural(response.invalid.length, 'invalid entry', 'invalid entries') + ' skipped' : null,
    response.duplicates.length ? plural(response.duplicates.length, 'duplicate') + ' merged' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const title = failed ? `${ok} tracked, ${failed} could not be fetched` : `${plural(ok, 'train')} tracked`;
  if (failed) toast.warning(title, { description: extra || undefined });
  else toast.success(title, { description: extra || undefined });
}

export default function TrackPage() {
  useDocumentTitle('Track trains');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setTracked = useDashboardStore((s) => s.setTracked);
  const dashboardCount = useDashboardStore((s) => s.results.length);
  const { data: user } = useMe();
  const today = todayInIst();

  const [tab, setTab] = useState('numbers');
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseTrainNumbers(text), [text]);
  const [date, setDate] = useState(today);
  const dateCheck = checkJourneyDate(date);
  const track = useTrack();

  const [batch, setBatch] = useState<{ running: boolean; progress: string | null; error: unknown }>({
    running: false,
    progress: null,
    error: null,
  });

  const canSubmit =
    parsed.valid.length > 0 && parsed.valid.length <= MAX_TRAINS_PER_REQUEST && dateCheck.ok && !track.isPending;

  const submitNumbers = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    track.mutate(
      { trainNumbers: parsed.valid, journeyDate: date, source: 'manual' },
      {
        onSuccess: (response) => {
          setTracked({ response, source: 'manual' });
          summaryToast(response);
          navigate('/results');
        },
      },
    );
  };

  const trackItems = async (items: TrainRef[], source: ResultSource, emails: string[] = []) => {
    setBatch({ running: true, progress: `Tracking 0 of ${items.length}…`, error: null });
    try {
      const { response, partialError, untracked } = await trackItemsInBatches(items, {
        source,
        onProgress: (done, total) => setBatch((b) => ({ ...b, progress: `Tracking ${done} of ${total}…` })),
      });
      setTracked({ response, source, uploadEmails: emails });
      void queryClient.invalidateQueries({ queryKey: queryKeys.history });
      if (partialError) {
        toast.warning(`Tracked ${items.length - untracked.length} of ${items.length} trains`, {
          description: `${partialError.message} The remaining ${untracked.length} were not requested.`,
        });
      } else summaryToast(response);
      setBatch({ running: false, progress: null, error: null });
      navigate('/results');
    } catch (error) {
      setBatch({ running: false, progress: null, error });
    }
  };

  const trackError = track.error ?? (batch.error as Error | null);

  return (
    <div className="space-y-8">
      <section aria-labelledby="track-heading" className="mx-auto max-w-3xl space-y-3 pt-2 text-center sm:pt-6">
        <h1 id="track-heading" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Track Indian Railways trains
        </h1>
        <p className="mx-auto max-w-2xl text-balance text-muted-foreground">
          Running status from licensed data providers — up to {MAX_TRAINS_PER_REQUEST} trains at once, or upload a sheet.
        </p>
        <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1 pt-1 text-xs text-muted-foreground">
          <li className="inline-flex items-center gap-1.5">
            <ShieldCheck aria-hidden className="size-3.5" /> Source &amp; freshness on every result
          </li>
          <li className="inline-flex items-center gap-1.5">
            <MapPinned aria-hidden className="size-3.5" /> Estimated positions clearly labelled
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Clock aria-hidden className="size-3.5" /> All times in IST
          </li>
        </ul>
      </section>

      <Card className="mx-auto max-w-3xl gap-0 py-0 shadow-sm">
        <Tabs value={tab} onValueChange={setTab} className="gap-0">
          <div className="border-b px-5 pt-5 pb-4">
            <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-grid">
              <TabsTrigger value="numbers" data-testid="tab-numbers">
                <Keyboard aria-hidden /> Train numbers
              </TabsTrigger>
              <TabsTrigger value="upload" data-testid="tab-upload">
                <FileSpreadsheet aria-hidden /> Upload CSV/Excel
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="numbers" className="p-5">
            <form onSubmit={submitNumbers} noValidate className="space-y-5" aria-label="Track trains by number">
              <TrainNumberInput value={text} onChange={setText} parsed={parsed} disabled={track.isPending} onSubmitShortcut={submitNumbers} />

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Examples:</span>
                {EXAMPLES.map((ex) => (
                  <Button
                    key={ex.value}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 font-mono text-xs"
                    data-testid="example-fill"
                    onClick={() => setText(ex.value)}
                  >
                    {ex.label}
                  </Button>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="journey-date">
                    <CalendarDays aria-hidden className="size-4" /> Journey date
                  </Label>
                  <Input
                    id="journey-date"
                    type="date"
                    data-testid="journey-date"
                    value={date}
                    min={addDaysToDate(today, -JOURNEY_DATE_MAX_PAST_DAYS)}
                    max={addDaysToDate(today, JOURNEY_DATE_MAX_FUTURE_DAYS)}
                    onChange={(e) => setDate(e.target.value || today)}
                    aria-invalid={!dateCheck.ok || undefined}
                    aria-describedby="journey-date-help"
                    className="w-full sm:w-52"
                  />
                </div>
                <p id="journey-date-help" className="text-xs text-muted-foreground sm:pb-2.5">
                  {dateCheck.ok ? (
                    <>
                      The date the train left its origin ({formatJourneyDate(date)}). Today in IST is {formatJourneyDate(today)}.
                    </>
                  ) : (
                    <span className="font-medium text-destructive">{dateCheck.reason}</span>
                  )}
                </p>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                {dashboardCount > 0 ? (
                  <Link to="/results" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                    Back to dashboard ({plural(dashboardCount, 'train')}) <ArrowRight aria-hidden className="inline size-3.5" />
                  </Link>
                ) : (
                  <span />
                )}
                <Button type="submit" size="lg" disabled={!canSubmit} data-testid="track-submit" className="sm:min-w-48">
                  {track.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <TrainFront aria-hidden />}
                  {track.isPending
                    ? 'Fetching status…'
                    : parsed.valid.length > 1
                      ? `Track ${parsed.valid.length} trains`
                      : 'Track train'}
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="upload" className="p-5">
            <UploadPanel
              onTrack={(items, emails) => void trackItems(items, 'upload', emails)}
              tracking={batch.running}
              trackingProgress={batch.progress}
            />
          </TabsContent>
        </Tabs>

        <div aria-live="assertive" className="empty:hidden px-5 pb-5">
          {trackError && (
            <TrainErrorState
              compact
              code={isApiError(trackError) ? trackError.code : null}
              message={trackError.message}
              retryAfterSeconds={isApiError(trackError) ? trackError.retryAfterSeconds : null}
              onRetry={tab === 'numbers' ? () => submitNumbers() : undefined}
              retrying={track.isPending}
            />
          )}
        </div>
      </Card>

      {user && <RecentTracking onTrackAgain={(items) => void trackItems(items, 'manual')} busy={batch.running || track.isPending} />}
    </div>
  );
}

const SOURCE_LABEL: Record<TrackingHistoryItem['source'], string> = {
  MANUAL: 'Manual',
  UPLOAD: 'Upload',
  MONITORING: 'Monitoring',
  API: 'API',
};

function RecentTracking({ onTrackAgain, busy }: { onTrackAgain: (items: TrainRef[]) => void; busy: boolean }) {
  const history = useTrackingHistory(true, 5);
  const now = useNow();
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card className="mx-auto max-w-3xl" data-testid="recent-tracking">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History aria-hidden className="size-4" /> Recent tracking
        </CardTitle>
        <CardDescription>Your last tracking requests. Track a set again with one click.</CardDescription>
      </CardHeader>
      <CardContent>
        {history.isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : history.error ? (
          <p className="text-sm text-muted-foreground">Could not load history: {history.error.message}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet — trains you track while signed in will appear here.</p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={item.createdAt}>{ist(item.createdAt)}</time> ({relativeTime(item.createdAt, now)}) ·{' '}
                    {SOURCE_LABEL[item.source]} · {item.summary.ok} ok
                    {item.summary.failed ? `, ${item.summary.failed} failed` : ''}
                  </p>
                  <ul className="flex flex-wrap gap-1" aria-label="Trains">
                    {item.items.slice(0, 12).map((t) => (
                      <li key={`${t.trainNumber}-${t.journeyDate}`}>
                        <Badge
                          variant="outline"
                          className={t.ok ? 'font-mono' : 'border-red-300 font-mono text-red-800 dark:border-red-800 dark:text-red-200'}
                          title={t.ok ? `Journey ${t.journeyDate}` : `Failed: ${t.errorCode ?? 'error'}`}
                        >
                          {t.trainNumber}
                          {!t.ok && <span className="sr-only"> (failed)</span>}
                          {!t.ok && <span aria-hidden> ✕</span>}
                        </Badge>
                      </li>
                    ))}
                    {item.items.length > 12 && <li className="text-xs text-muted-foreground">+{item.items.length - 12} more</li>}
                  </ul>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || item.items.length === 0}
                  onClick={() => onTrackAgain(item.items.map((t) => ({ trainNumber: t.trainNumber, journeyDate: t.journeyDate })))}
                >
                  <RotateCcw aria-hidden /> Track again
                </Button>
              </li>
            ))}
          </ul>
        )}
        {history.hasNextPage && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>
            {history.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
