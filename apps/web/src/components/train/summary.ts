import type { NormalizedTrainStatus } from '@railtrack/shared';
import { ist } from '@/lib/time';

const EVENT_VERB: Record<'arrived' | 'departed' | 'passed', string> = {
  arrived: 'Arrived',
  departed: 'Departed',
  passed: 'Passed',
};

/** "Departed Kota Jn (KOTA)" — the last reported station + event. */
export function currentLocationText(status: Pick<NormalizedTrainStatus, 'lastReportedStation' | 'lastReportedEvent' | 'state' | 'source' | 'destination'>): string {
  if (status.lastReportedStation) {
    const verb = status.lastReportedEvent ? `${EVENT_VERB[status.lastReportedEvent]} ` : 'At ';
    return `${verb}${status.lastReportedStation.name} (${status.lastReportedStation.code})`;
  }
  if (status.state === 'not_started' || status.state === 'rescheduled') return `Not yet departed ${status.source.name}`;
  if (status.state === 'arrived') return `Arrived ${status.destination.name}`;
  if (status.state === 'cancelled') return 'Cancelled';
  return 'No station report yet';
}

export function nextStationText(status: Pick<NormalizedTrainStatus, 'nextStation' | 'nextStationEta'>): string {
  if (!status.nextStation) return '—';
  return `${status.nextStation.name} (${status.nextStation.code})`;
}

export function nextStationEtaText(status: Pick<NormalizedTrainStatus, 'nextStationEta'>): string | null {
  return status.nextStationEta ? `Expected ${ist(status.nextStationEta, 'time')}` : null;
}
