import type { ComponentType } from 'react';
import { Ban, CalendarClock, CircleSlash, Info, Scissors, Shuffle } from 'lucide-react';
import type { NormalizedTrainStatus, Tone, TrainException } from '@railtrack/shared';
import { TONE_ICON, TONE_SURFACE } from '@/lib/tone';
import { cn } from '@/lib/utils';

interface BannerSpec {
  key: string;
  type: TrainException['type'] | 'state';
  title: string;
  message: string;
  stations: string[];
  tone: Tone;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  critical: boolean;
}

const EXCEPTION_COPY: Record<TrainException['type'], { title: string; tone: Tone; icon: BannerSpec['icon']; critical: boolean }> = {
  cancellation: { title: 'Train cancelled', tone: 'danger', icon: Ban, critical: true },
  partial_cancellation: { title: 'Partially cancelled', tone: 'danger', icon: Scissors, critical: true },
  diversion: { title: 'Train diverted', tone: 'warning', icon: Shuffle, critical: true },
  reschedule: { title: 'Departure rescheduled', tone: 'warning', icon: CalendarClock, critical: false },
  skipped_stop: { title: 'Skipping stops', tone: 'warning', icon: CircleSlash, critical: false },
  short_termination: { title: 'Short-terminated', tone: 'warning', icon: Scissors, critical: true },
  short_origination: { title: 'Short-originated', tone: 'warning', icon: Scissors, critical: false },
  other: { title: 'Service notice', tone: 'info', icon: Info, critical: false },
};

/** Banners for cancellations, diversions, reschedules, skipped stops etc. Pure builder exported for tests. */
export function buildExceptionBanners(status: Pick<NormalizedTrainStatus, 'state' | 'exceptions' | 'stateDetail'>): BannerSpec[] {
  const banners: BannerSpec[] = status.exceptions.map((e, i) => {
    const copy = EXCEPTION_COPY[e.type];
    const title =
      e.type === 'reschedule' && e.rescheduledByMinutes ? `${copy.title} by ${e.rescheduledByMinutes} min` : copy.title;
    return {
      key: `${e.type}-${i}`,
      type: e.type,
      title,
      message: e.message,
      stations: e.stationCodes,
      tone: copy.tone,
      icon: copy.icon,
      critical: copy.critical,
    };
  });
  const has = (t: TrainException['type']) => status.exceptions.some((e) => e.type === t);
  const fallback = (type: TrainException['type']) => {
    const copy = EXCEPTION_COPY[type];
    banners.unshift({
      key: `state-${type}`,
      type: 'state',
      title: copy.title,
      message: status.stateDetail ?? '',
      stations: [],
      tone: copy.tone,
      icon: copy.icon,
      critical: copy.critical,
    });
  };
  if (status.state === 'cancelled' && !has('cancellation') && !has('partial_cancellation')) fallback('cancellation');
  if (status.state === 'diverted' && !has('diversion')) fallback('diversion');
  if (status.state === 'rescheduled' && !has('reschedule')) fallback('reschedule');
  return banners;
}

export function ExceptionBanners({
  status,
  compact,
  className,
}: {
  status: Pick<NormalizedTrainStatus, 'state' | 'exceptions' | 'stateDetail'>;
  compact?: boolean;
  className?: string;
}) {
  const banners = buildExceptionBanners(status);
  if (banners.length === 0) return null;
  return (
    <section aria-label="Service alerts" className={cn('space-y-2', className)}>
      {banners.map((b) => {
        const Icon = b.icon;
        return (
          <div
            key={b.key}
            role={b.critical ? 'alert' : undefined}
            data-testid="exception-banner"
            data-type={b.type}
            className={cn(
              'flex gap-3 rounded-lg border-2',
              TONE_SURFACE[b.tone],
              compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm',
            )}
          >
            <Icon aria-hidden className={cn('mt-0.5 shrink-0', compact ? 'size-4' : 'size-5', TONE_ICON[b.tone])} />
            <div className="min-w-0 space-y-0.5">
              <p className={cn('font-semibold', !compact && 'text-base')}>{b.title}</p>
              {b.message && <p>{b.message}</p>}
              {b.stations.length > 0 && (
                <p className="text-xs">
                  Stations: <span className="font-mono">{b.stations.join(', ')}</span>
                </p>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
