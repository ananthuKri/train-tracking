import { isValidIsoDate, isValidTrainNumber, type TrackResult } from '@railtrack/shared';

export interface TrainRef {
  trainNumber: string;
  journeyDate: string;
}

/** Stable key "12082:2026-10-01" — also the wire format of `?trains=` lists. */
export function trainKey(ref: TrainRef): string {
  return `${ref.trainNumber}:${ref.journeyDate}`;
}

export const resultKey = (r: TrackResult): string => trainKey(r);

/** Serialise refs to "12082:2026-10-01,12627:2026-10-01". */
export function serializeTrainRefs(refs: readonly TrainRef[]): string {
  return refs.map(trainKey).join(',');
}

/** Parse "12082:2026-10-01,12627:2026-10-01" (invalid or duplicate entries are dropped). */
export function parseTrainRefs(value: string | null | undefined): TrainRef[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: TrainRef[] = [];
  for (const part of value.split(',')) {
    const [trainNumber = '', journeyDate = ''] = part.trim().split(':');
    if (!isValidTrainNumber(trainNumber) || !isValidIsoDate(journeyDate)) continue;
    const key = `${trainNumber}:${journeyDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ trainNumber, journeyDate });
  }
  return out;
}

export function trainDetailPath(ref: TrainRef): string {
  return `/trains/${encodeURIComponent(ref.trainNumber)}?date=${encodeURIComponent(ref.journeyDate)}`;
}
