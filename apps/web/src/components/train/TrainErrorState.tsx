import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCountdown, useCountdown } from '@/hooks/useCountdown';
import { TONE_ICON, TONE_SURFACE } from '@/lib/tone';
import { cn } from '@/lib/utils';
import type { ClientErrorCode } from '@/api/client';
import { errorMeta } from './errorMeta';

export interface TrainErrorStateProps {
  code: ClientErrorCode | string | null | undefined;
  /** Server-provided message (shown as detail when it adds information). */
  message?: string | null;
  retryAfterSeconds?: number | null;
  trainNumber?: string;
  journeyDate?: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  /** ARIA role; lists of results use "status" so every card isn't announced as an alert. */
  role?: 'alert' | 'status';
  actions?: ReactNode;
  className?: string;
}

/** One component for every train-level failure: maps error codes to title, description and icon. */
export function TrainErrorState({
  code,
  message,
  retryAfterSeconds,
  trainNumber,
  journeyDate,
  onRetry,
  retrying,
  compact,
  role = 'alert',
  actions,
  className,
}: TrainErrorStateProps) {
  const meta = errorMeta(code, { trainNumber, journeyDate });
  const Icon = meta.icon;
  const isRateLimited = code === 'RATE_LIMITED';
  const remaining = useCountdown(isRateLimited ? retryAfterSeconds : null);
  const showDetail = message && message.trim() && message !== meta.description;

  return (
    <div
      role={role}
      data-testid="train-error"
      data-code={code ?? 'UNKNOWN'}
      className={cn(
        'rounded-lg border',
        TONE_SURFACE[meta.tone],
        compact ? 'flex gap-3 p-3 text-sm' : 'flex flex-col items-center gap-3 px-6 py-8 text-center',
        className,
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-background/70',
          compact ? 'size-8' : 'size-12',
          TONE_ICON[meta.tone],
        )}
      >
        <Icon aria-hidden className={compact ? 'size-4' : 'size-6'} />
      </span>
      <div className={cn('min-w-0 space-y-1', !compact && 'max-w-md')}>
        <p className={cn('font-semibold', compact ? 'text-sm' : 'text-lg')}>{meta.title}</p>
        <p className={cn('text-current/90', compact ? 'text-xs' : 'text-sm')}>{meta.description}</p>
        {showDetail && <p className={cn('opacity-80', compact ? 'text-xs' : 'text-sm')}>Details: {message}</p>}
        {isRateLimited && (
          <p data-testid="retry-countdown" aria-live="polite" className={cn('font-medium', compact ? 'text-xs' : 'text-sm')}>
            {remaining > 0 ? (
              <>
                You can retry in <span className="font-mono tabular-nums">{formatCountdown(remaining)}</span>.
              </>
            ) : retryAfterSeconds ? (
              'You can retry now.'
            ) : (
              'Please wait a minute before retrying.'
            )}
          </p>
        )}
        {(onRetry || actions) && (
          <div className={cn('flex flex-wrap gap-2 pt-2', !compact && 'justify-center')}>
            {onRetry && meta.retryable && (
              <Button
                size="sm"
                variant="outline"
                onClick={onRetry}
                disabled={retrying || (isRateLimited && remaining > 0)}
                data-testid="error-retry"
              >
                <RefreshCw aria-hidden className={cn(retrying && 'animate-spin')} />
                {retrying ? 'Retrying…' : 'Try again'}
              </Button>
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
