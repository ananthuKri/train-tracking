/**
 * Time handling rules for RailTrack Live:
 *  - All instants are stored and transported as ISO-8601 UTC strings.
 *  - Journey/running dates are calendar dates in Asia/Kolkata, formatted YYYY-MM-DD.
 *  - Everything shown to people is rendered in IST.
 * IST has no daylight saving, so a fixed +05:30 offset is exact.
 */
export const IST_TIME_ZONE = 'Asia/Kolkata';
export const IST_OFFSET_MINUTES = 330;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export const JOURNEY_DATE_MAX_PAST_DAYS = 7;
export const JOURNEY_DATE_MAX_FUTURE_DAYS = 3;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE_PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Calendar date (YYYY-MM-DD) in IST for the given instant. */
export function toIstDate(instant: Date | string | number = new Date()): string {
  const ms = new Date(instant).getTime() + IST_OFFSET_MINUTES * MINUTE_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

export function todayInIst(now: Date = new Date()): string {
  return toIstDate(now);
}

export function addDaysToDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days between two calendar dates (b - a). */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/**
 * Convert an IST wall-clock time on a journey to a UTC instant.
 * @param journeyDate YYYY-MM-DD the train started from its origin (IST)
 * @param hhmm "HH:mm" in IST
 * @param day journey day number (1 = the journey date itself)
 */
export function istWallClockToUtc(journeyDate: string, hhmm: string, day = 1): Date {
  const [y, m, d] = journeyDate.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MINUTES * MINUTE_MS + (day - 1) * DAY_MS;
  return new Date(utcMs);
}

/** "HH:mm" wall-clock time in IST for an instant. */
export function toIstClock(instant: Date | string): string {
  const ms = new Date(instant).getTime() + IST_OFFSET_MINUTES * MINUTE_MS;
  return new Date(ms).toISOString().slice(11, 16);
}

export interface JourneyDateCheck {
  ok: boolean;
  reason?: string;
}

export function checkJourneyDate(journeyDate: string, now: Date = new Date()): JourneyDateCheck {
  if (!isValidIsoDate(journeyDate)) return { ok: false, reason: 'Journey date must be a valid date in YYYY-MM-DD format' };
  const delta = diffDays(todayInIst(now), journeyDate);
  if (delta < -JOURNEY_DATE_MAX_PAST_DAYS) {
    return { ok: false, reason: `Journey date can be at most ${JOURNEY_DATE_MAX_PAST_DAYS} days in the past` };
  }
  if (delta > JOURNEY_DATE_MAX_FUTURE_DAYS) {
    return { ok: false, reason: `Journey date can be at most ${JOURNEY_DATE_MAX_FUTURE_DAYS} days ahead` };
  }
  return { ok: true };
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, ...options });
    formatterCache.set(key, f);
  }
  return f;
}

export type IstFormat = 'time' | 'date' | 'datetime' | 'short' | 'weekday-date';

/** Human-readable IST rendering. Returns "—" for empty input. */
export function formatIst(instant: Date | string | null | undefined, format: IstFormat = 'datetime'): string {
  if (instant === null || instant === undefined || instant === '') return '—';
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '—';
  switch (format) {
    case 'time':
      return formatter('time', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    case 'date':
      return formatter('date', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
    case 'short':
      return formatter('short', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    case 'weekday-date':
      return formatter('weekday-date', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(date);
    default:
      return formatter('datetime', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
  }
}

/** Format a YYYY-MM-DD journey date for display ("01 Oct 2026"). */
export function formatJourneyDate(journeyDate: string): string {
  if (!isValidIsoDate(journeyDate)) return journeyDate;
  return formatIst(istWallClockToUtc(journeyDate, '12:00'), 'date');
}

export function minutesBetween(a: Date | string, b: Date | string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / MINUTE_MS);
}

/** "just now", "4 min ago", "2 h ago", "3 d ago". */
export function relativeTime(instant: Date | string | null | undefined, now: Date = new Date()): string {
  if (!instant) return '—';
  const diffMin = minutesBetween(instant, now);
  if (Number.isNaN(diffMin)) return '—';
  if (diffMin < -1) return `in ${formatDuration(-diffMin)}`;
  if (diffMin < 1) return 'just now';
  return `${formatDuration(diffMin)} ago`;
}

export function formatDuration(totalMinutes: number): string {
  const m = Math.abs(Math.round(totalMinutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 48) return rem ? `${h} h ${rem} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/**
 * Parse dates found in uploaded spreadsheets.
 * Accepts YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY (Indian day-first convention)
 * and Excel serial day numbers. Returns YYYY-MM-DD or null.
 */
export function parseFlexibleDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number') return excelSerialToIsoDate(value);

  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text) && Number(text) > 20_000) return excelSerialToIsoDate(Number(text));

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (m) return buildIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (m) return buildIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

function buildIsoDate(y: number, m: number, d: number): string | null {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** Excel's 1900 date system: serial 1 = 1900-01-01, with the historic 1900 leap-year bug (epoch 1899-12-30). */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}
