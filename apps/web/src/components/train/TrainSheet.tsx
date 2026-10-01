import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { formatJourneyDate, type TrackResult } from '@railtrack/shared';
import { TrainMap } from '@/components/map/LazyTrainMap';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { resultKey, trainDetailPath } from '@/lib/trainKey';
import { DelayChip, DemoBadge, ResultStatusBadge } from './badges';
import { ExceptionBanners } from './ExceptionBanners';
import { JourneyProgress } from './JourneyProgress';
import { KeyFacts } from './KeyFacts';
import { RouteTimeline } from './RouteTimeline';
import { SourceFreshness } from './SourceFreshness';
import { TrainErrorState } from './TrainErrorState';

/** Side drawer with a train's key facts, mini map and route — opened from the dashboard without navigating. */
export function TrainSheet({
  result,
  styleIndex,
  open,
  onOpenChange,
}: {
  result: TrackResult | null;
  styleIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const s = result?.status ?? null;
  return (
    <Sheet open={open && !!result} onOpenChange={onOpenChange}>
      <SheetContent data-testid="train-sheet" className="gap-0 overflow-y-auto">
        {result && (
          <>
            <SheetHeader className="border-b pr-12">
              <SheetTitle className="flex flex-wrap items-baseline gap-x-2 text-lg">
                <span className="font-mono tabular-nums">{result.trainNumber}</span>
                <span>{s?.trainName ?? 'Train'}</span>
              </SheetTitle>
              <SheetDescription>Journey date {formatJourneyDate(result.journeyDate)}</SheetDescription>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <ResultStatusBadge result={result} />
                {s && <DelayChip minutes={s.delayMinutes} />}
                {s?.provider.isDemo && <DemoBadge />}
              </div>
            </SheetHeader>
            <div className="space-y-5 p-4">
              {s ? (
                <>
                  <SourceFreshness status={s} error={result.error} />
                  <ExceptionBanners status={s} compact />
                  <JourneyProgress status={s} />
                  <TrainMap
                    trains={[{ key: resultKey(result), status: s, styleIndex }]}
                    heightClass="h-60"
                    detailLinks={false}
                    label={`Map of train ${result.trainNumber}`}
                  />
                  <KeyFacts status={s} />
                  <section aria-labelledby="sheet-route-heading" className="space-y-2">
                    <h3 id="sheet-route-heading" className="text-sm font-semibold">
                      Route
                    </h3>
                    <RouteTimeline stops={s.stops} compact />
                  </section>
                </>
              ) : (
                <TrainErrorState
                  code={result.error?.code}
                  message={result.error?.message}
                  retryAfterSeconds={result.error?.retryAfterSeconds}
                  trainNumber={result.trainNumber}
                  journeyDate={result.journeyDate}
                />
              )}
              <Button asChild className="w-full" data-testid="sheet-full-details">
                <Link to={trainDetailPath(result)}>
                  <ExternalLink aria-hidden />
                  Open full train details
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
