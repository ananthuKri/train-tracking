import * as React from 'react';
import type { Tone } from '@railtrack/shared';
import { cn } from '@/lib/utils';
import { TONE_ICON, TONE_SURFACE } from '@/lib/tone';

/** Tone-coloured callout. Always pair with text that states the meaning (never colour alone). */
function Alert({
  className,
  tone = 'neutral',
  icon: Icon,
  title,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title?: React.ReactNode;
}) {
  return (
    <div
      data-slot="alert"
      data-tone={tone}
      className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', TONE_SURFACE[tone], className)}
      {...props}
    >
      {Icon && <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', TONE_ICON[tone])} />}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children && <div className="leading-relaxed [&_p]:leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

export { Alert };
