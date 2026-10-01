import { formatIst, relativeTime, type IstFormat } from '@railtrack/shared';

/** IST-formatted instant with an explicit "IST" suffix, or "—". */
export function ist(instant: Date | string | null | undefined, format: IstFormat = 'short'): string {
  const text = formatIst(instant, format);
  return text === '—' ? text : `${text} IST`;
}

/** "14:05 IST (3 min ago)". */
export function istWithRelative(instant: Date | string | null | undefined, now: Date, format: IstFormat = 'short'): string {
  if (!instant) return '—';
  return `${ist(instant, format)} (${relativeTime(instant, now)})`;
}
