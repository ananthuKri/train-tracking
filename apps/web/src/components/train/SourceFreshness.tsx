import { Database, History, RadioTower } from 'lucide-react';
import { freshnessLabel, relativeTime, type NormalizedTrainStatus, type TrackError } from '@railtrack/shared';
import { Alert } from '@/components/ui/alert';
import { useNow } from '@/hooks/useNow';
import { TONE_BADGE } from '@/lib/tone';
import { ist } from '@/lib/time';
import { cn } from '@/lib/utils';
import { DemoBadge } from './badges';

type FreshnessStatus = Pick<
  NormalizedTrainStatus,
  'provider' | 'providerUpdatedAt' | 'fetchedAt' | 'freshness' | 'notice'
>;

export function FreshnessBadge({ status, className }: { status: Pick<NormalizedTrainStatus, 'freshness' | 'provider'>; className?: string }) {
  const tone = status.provider.isDemo ? 'warning' : status.freshness === 'live' ? 'success' : status.freshness === 'cached' ? 'info' : 'warning';
  return (
    <span
      data-testid="freshness"
      data-freshness={status.freshness}
      className={cn(
        'inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium',
        TONE_BADGE[tone],
        className,
      )}
    >
      {freshnessLabel(status)}
    </span>
  );
}

export function staleNoticeText(status: Pick<NormalizedTrainStatus, 'notice' | 'fetchedAt'>): string {
  return (
    status.notice ??
    `Live data temporarily unavailable — showing last verified result from ${ist(status.fetchedAt)}.`
  );
}

/**
 * Source label + freshness for any train view: provider, "Provider updated …", "Fetched … (… ago)",
 * freshness, and the amber last-verified notice when the provider is failing.
 */
export function SourceFreshness({
  status,
  error,
  variant = 'bar',
  className,
}: {
  status: FreshnessStatus;
  /** Provider error that accompanies a stale result. */
  error?: TrackError | null;
  variant?: 'bar' | 'compact';
  className?: string;
}) {
  const now = useNow();
  const compact = variant === 'compact';
  return (
    <div className={cn('space-y-2', className)}>
      <div
        data-testid="source-freshness"
        role="group"
        aria-label="Data source and freshness"
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground',
          compact ? 'text-xs' : 'rounded-lg border bg-muted/40 px-3 py-2 text-xs sm:text-sm',
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <Database aria-hidden className="size-3.5" />
          <span>
            Source: <span className="font-medium text-foreground">{status.provider.name}</span>
          </span>
        </span>
        {status.provider.isDemo && <DemoBadge />}
        <FreshnessBadge status={status} />
        <span className="inline-flex items-center gap-1.5">
          <RadioTower aria-hidden className="size-3.5" />
          {status.providerUpdatedAt ? (
            <span>
              Provider updated <time dateTime={status.providerUpdatedAt}>{ist(status.providerUpdatedAt)}</time>
            </span>
          ) : (
            <span>Provider update time not reported</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <History aria-hidden className="size-3.5" />
          <span>
            Fetched <time dateTime={status.fetchedAt}>{ist(status.fetchedAt)}</time> ({relativeTime(status.fetchedAt, now)})
          </span>
        </span>
        {!compact && status.provider.attribution && <span className="basis-full text-xs">{status.provider.attribution}</span>}
      </div>
      {status.freshness === 'stale' && (
        <Alert tone="warning" icon={History} data-testid="stale-notice" role="status" className={compact ? 'px-3 py-2 text-xs' : undefined}>
          <p>{staleNoticeText(status)}</p>
          {error && <p className="text-xs opacity-80">Provider error: {error.message}</p>}
        </Alert>
      )}
    </div>
  );
}
