import type { CsvCell } from './csv';
import { formatIst } from './dates';
import { STATE_META, freshnessLabel } from './display';
import type { NormalizedTrainStatus } from './schemas';

export const REPORT_FIELD_IDS = [
  'identity',
  'sourceDestination',
  'currentLocation',
  'nextStation',
  'route',
  'schedule',
  'actualTimings',
  'delays',
  'platform',
  'exceptions',
  'mapLink',
  'sourceFreshness',
] as const;
export type ReportFieldId = (typeof REPORT_FIELD_IDS)[number];

/** Subject used for every report email unless an API client sets its own. */
export const REPORT_SUBJECT = 'Status Tracker';

export const REPORT_FIELDS: readonly { id: ReportFieldId; label: string; description: string }[] = [
  { id: 'identity', label: 'Train identity', description: 'Number, name, journey date and status' },
  { id: 'sourceDestination', label: 'Source / destination', description: 'Origin and terminating stations' },
  { id: 'currentLocation', label: 'Current location', description: 'Last reported station, position type and progress' },
  { id: 'nextStation', label: 'Next station', description: 'Next station and its expected arrival' },
  { id: 'route', label: 'Route', description: 'Station-by-station route' },
  { id: 'schedule', label: 'Schedule', description: 'Scheduled departure and arrival' },
  { id: 'actualTimings', label: 'Actual timings', description: 'Actual departure and actual/expected arrival' },
  { id: 'delays', label: 'Delays', description: 'Current delay in minutes' },
  { id: 'platform', label: 'Platform', description: 'Platform number, where available' },
  { id: 'exceptions', label: 'Exceptions', description: 'Diversions, cancellations, reschedules, skipped stops' },
  { id: 'mapLink', label: 'Map link', description: 'Link to the map view (shared link only if enabled)' },
  { id: 'sourceFreshness', label: 'Source & freshness', description: 'Data provider, demo flag and timestamps' },
];

export interface ReportContext {
  /** Returns the URL to include for the map-link field. */
  mapLink?: (status: NormalizedTrainStatus) => string | null;
}

interface ReportColumn {
  header: string;
  value: (s: NormalizedTrainStatus, ctx: ReportContext) => CsvCell;
}

const station = (ref: { code: string; name: string } | null) => (ref ? `${ref.name} (${ref.code})` : '');

export const REPORT_COLUMNS: Record<ReportFieldId, readonly ReportColumn[]> = {
  identity: [
    { header: 'Train Name', value: (s) => s.trainName },
    { header: 'Journey Date', value: (s) => s.journeyDate },
    { header: 'Status', value: (s) => STATE_META[s.state].label },
  ],
  sourceDestination: [
    { header: 'Source', value: (s) => station(s.source) },
    { header: 'Destination', value: (s) => station(s.destination) },
  ],
  currentLocation: [
    { header: 'Last Reported Station', value: (s) => station(s.lastReportedStation) },
    { header: 'Last Event', value: (s) => s.lastReportedEvent ?? '' },
    { header: 'Last Event Time (IST)', value: (s) => (s.lastReportedAt ? formatIst(s.lastReportedAt) : '') },
    { header: 'Position Type', value: (s) => (s.position ? (s.position.kind === 'reported' ? 'Reported' : 'Estimated (not GPS)') : '') },
    { header: 'Latitude', value: (s) => (s.position ? Number(s.position.lat.toFixed(5)) : null) },
    { header: 'Longitude', value: (s) => (s.position ? Number(s.position.lng.toFixed(5)) : null) },
    { header: 'Distance Travelled (km)', value: (s) => roundOrNull(s.distanceTravelledKm) },
    { header: 'Distance Remaining (km)', value: (s) => roundOrNull(s.distanceRemainingKm) },
    { header: 'Progress (%)', value: (s) => roundOrNull(s.progressPercent) },
  ],
  nextStation: [
    { header: 'Next Station', value: (s) => station(s.nextStation) },
    { header: 'Next Station ETA (IST)', value: (s) => (s.nextStationEta ? formatIst(s.nextStationEta) : '') },
  ],
  route: [
    { header: 'Route', value: (s) => s.stops.filter((st) => st.isHalt).map((st) => st.stationCode).join(' > ') },
    { header: 'Halts', value: (s) => s.stops.filter((st) => st.isHalt).length },
  ],
  schedule: [
    { header: 'Scheduled Departure (IST)', value: (s) => (s.scheduledDeparture ? formatIst(s.scheduledDeparture) : '') },
    { header: 'Scheduled Arrival (IST)', value: (s) => (s.scheduledArrival ? formatIst(s.scheduledArrival) : '') },
  ],
  actualTimings: [
    { header: 'Actual Departure (IST)', value: (s) => (s.actualDeparture ? formatIst(s.actualDeparture) : '') },
    { header: 'Actual Arrival (IST)', value: (s) => (s.actualArrival ? formatIst(s.actualArrival) : '') },
    { header: 'Expected Arrival (IST)', value: (s) => (!s.actualArrival && s.expectedArrival ? formatIst(s.expectedArrival) : '') },
  ],
  delays: [{ header: 'Delay (min)', value: (s) => s.delayMinutes }],
  platform: [{ header: 'Platform', value: (s) => s.platform ?? '' }],
  exceptions: [{ header: 'Exceptions', value: (s) => s.exceptions.map((e) => e.message).join(' | ') }],
  mapLink: [{ header: 'Map Link', value: (s, ctx) => ctx.mapLink?.(s) ?? '' }],
  sourceFreshness: [
    { header: 'Data Source', value: (s) => s.provider.name },
    { header: 'Demo Data', value: (s) => (s.provider.isDemo ? 'YES — simulated, not live' : 'No') },
    { header: 'Freshness', value: (s) => freshnessLabel(s) },
    { header: 'Provider Updated (IST)', value: (s) => (s.providerUpdatedAt ? formatIst(s.providerUpdatedAt) : '') },
    { header: 'Fetched At (IST)', value: (s) => formatIst(s.fetchedAt) },
  ],
};

function roundOrNull(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}

/** Normalise a field selection: undefined/empty → full report, keeps canonical order, removes duplicates. */
export function resolveReportFields(fields?: readonly ReportFieldId[] | null): ReportFieldId[] {
  if (!fields || fields.length === 0) return [...REPORT_FIELD_IDS];
  const wanted = new Set(fields);
  return REPORT_FIELD_IDS.filter((f) => wanted.has(f));
}

/** Tabular report (one row per train). "Train Number" is always the first column. */
export function buildReportTable(
  statuses: readonly NormalizedTrainStatus[],
  fields: readonly ReportFieldId[],
  ctx: ReportContext = {},
): { headers: string[]; rows: CsvCell[][] } {
  const columns = resolveReportFields(fields).flatMap((f) => REPORT_COLUMNS[f]);
  const headers = ['Train Number', ...columns.map((c) => c.header)];
  const rows = statuses.map((s) => [s.trainNumber, ...columns.map((c) => c.value(s, ctx))]);
  return { headers, rows };
}
