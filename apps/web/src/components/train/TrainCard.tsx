import { forwardRef } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ExternalLink, LocateFixed, PanelRightOpen } from 'lucide-react';
import { formatJourneyDate, trainStyle, type TrackResult } from '@railtrack/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { trainDetailPath } from '@/lib/trainKey';
import { cn } from '@/lib/utils';
import { DelayChip, DemoBadge, ResultStatusBadge, TrainGlyph } from './badges';
import { ExceptionBanners } from './ExceptionBanners';
import { JourneyProgress } from './JourneyProgress';
import { SourceFreshness } from './SourceFreshness';
import { TrainErrorState } from './TrainErrorState';
import { currentLocationText, nextStationEtaText, nextStationText } from './summary';

export interface TrainCardProps {
  result: TrackResult;
  styleIndex: number;
  selected?: boolean;
  focused?: boolean;
  onToggleSelect?: () => void;
  onOpen?: () => void;
  onFocus?: () => void;
  /** Hide dashboard-only controls (selection, focus). */
  readOnly?: boolean;
}

/** One independent result card — successful or failed. */
export const TrainCard = forwardRef<HTMLElement, TrainCardProps>(function TrainCard(
  { result, styleIndex, selected, focused, onToggleSelect, onOpen, onFocus, readOnly },
  ref,
) {
  const s = result.status;
  const { color, shape } = trainStyle(styleIndex);
  const titleId = `card-${result.trainNumber}-${result.journeyDate}`;
  return (
    <motion.article
      ref={ref}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      data-testid="result-card"
      data-train={result.trainNumber}
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-xs',
        focused && 'ring-2 ring-primary',
        selected && 'border-primary/60',
      )}
    >
      <header className="flex items-start gap-3">
        {!readOnly && onToggleSelect && (
          <Checkbox
            checked={!!selected}
            onCheckedChange={onToggleSelect}
            aria-label={`Select train ${result.trainNumber}`}
            data-testid="select-card"
            className="mt-1"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="flex items-center gap-2 text-base">
            <TrainGlyph shape={shape} color={color} dashed={s?.position?.kind === 'estimated'} />
            <span className="font-mono font-semibold tabular-nums">{result.trainNumber}</span>
            <span className="truncate font-medium">{s?.trainName ?? ''}</span>
          </h3>
          <p className="text-xs text-muted-foreground">Journey {formatJourneyDate(result.journeyDate)}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <ResultStatusBadge result={result} />
        {s && <DelayChip minutes={s.delayMinutes} />}
        {s?.provider.isDemo && <DemoBadge />}
      </div>

      {s ? (
        <>
          <p className="text-sm">
            <span className="font-medium">{s.source.name}</span>
            <span aria-hidden className="text-muted-foreground"> → </span>
            <span className="sr-only"> to </span>
            <span className="font-medium">{s.destination.name}</span>
          </p>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Current location</dt>
              <dd className="mt-0.5 font-medium">{currentLocationText(s)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Next station</dt>
              <dd className="mt-0.5 font-medium">{nextStationText(s)}</dd>
              {nextStationEtaText(s) && <dd className="font-mono text-muted-foreground tabular-nums">{nextStationEtaText(s)}</dd>}
            </div>
          </dl>
          <JourneyProgress status={s} compact />
          <ExceptionBanners status={s} compact />
          <SourceFreshness status={s} error={result.error} variant="compact" />
        </>
      ) : (
        <TrainErrorState
          compact
          role="status"
          code={result.error?.code}
          message={result.error?.message}
          retryAfterSeconds={result.error?.retryAfterSeconds}
          trainNumber={result.trainNumber}
          journeyDate={result.journeyDate}
        />
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {onOpen && (
          <Button size="sm" variant="outline" onClick={onOpen} data-testid="open-sheet">
            <PanelRightOpen aria-hidden />
            Quick view
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild>
          <Link to={trainDetailPath(result)}>
            <ExternalLink aria-hidden />
            Full details
          </Link>
        </Button>
        {!readOnly && onFocus && s?.position && (
          <Button size="icon-sm" variant="ghost" onClick={onFocus} aria-label={`Show train ${result.trainNumber} on the map`} className="ml-auto">
            <LocateFixed aria-hidden />
          </Button>
        )}
      </footer>
    </motion.article>
  );
});
