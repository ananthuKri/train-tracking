import {
  buildReportTable,
  CSV_BOM,
  formatDelay,
  formatIst,
  formatJourneyDate,
  freshnessLabel,
  osmLink,
  positionLabel,
  REPORT_FIELDS,
  resolveReportFields,
  STATE_META,
  toCsv,
  todayInIst,
  type NormalizedTrainStatus,
  type ReportFieldId,
  type TrackResult,
} from '@railtrack/shared';

export interface BuildReportInput {
  statuses: NormalizedTrainStatus[];
  /** Trains that could not be fetched at all. */
  failures: TrackResult[];
  fields?: ReportFieldId[];
  appBaseUrl: string;
  shareUrl?: string | null;
  subject?: string;
  message?: string;
  generatedAt?: Date;
  /** Heading override for monitoring alerts. */
  alertLines?: string[];
}

export interface BuiltReport {
  subject: string;
  html: string;
  text: string;
  csv: string;
  csvFileName: string;
  fields: ReportFieldId[];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function trainPageUrl(appBaseUrl: string, s: { trainNumber: string; journeyDate: string }): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/trains/${s.trainNumber}?date=${s.journeyDate}`;
}

export function mapLinkFor(input: Pick<BuildReportInput, 'appBaseUrl' | 'shareUrl'>, s: NormalizedTrainStatus): string {
  return input.shareUrl ? `${input.shareUrl}#train-${s.trainNumber}` : trainPageUrl(input.appBaseUrl, s);
}

const TONE_COLORS = {
  success: { bg: '#e7f6ec', fg: '#14532d' },
  info: { bg: '#e6efff', fg: '#1e3a8a' },
  warning: { bg: '#fff4d6', fg: '#7c4a03' },
  danger: { bg: '#fde8e8', fg: '#7f1d1d' },
  neutral: { bg: '#eef0f3', fg: '#334155' },
} as const;

const station = (ref: { code: string; name: string } | null) => (ref ? `${escapeHtml(ref.name)} (${escapeHtml(ref.code)})` : '—');
const ist = (iso: string | null) => (iso ? `${escapeHtml(formatIst(iso))} IST` : '—');

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#475569;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:4px 0;color:#0f172a;font-size:13px">${value}</td></tr>`;
}

function trainSection(s: NormalizedTrainStatus, fields: Set<ReportFieldId>, input: BuildReportInput): string {
  const tone = TONE_COLORS[STATE_META[s.state].tone];
  const rows: string[] = [];
  if (fields.has('identity')) rows.push(row('Journey date', escapeHtml(formatJourneyDate(s.journeyDate))));
  if (fields.has('sourceDestination')) {
    rows.push(row('From', station(s.source)), row('To', station(s.destination)));
  }
  if (fields.has('currentLocation')) {
    const event = s.lastReportedEvent ? `${s.lastReportedEvent} ` : '';
    rows.push(row('Last reported', s.lastReportedStation ? `${escapeHtml(event)}${station(s.lastReportedStation)}${s.lastReportedAt ? ` at ${ist(s.lastReportedAt)}` : ''}` : '—'));
    rows.push(row('Position', escapeHtml(positionLabel(s))));
    if (s.progressPercent !== null) {
      rows.push(row('Progress', `${escapeHtml(s.progressPercent)}% · ${escapeHtml(s.distanceTravelledKm ?? '—')} km travelled, ${escapeHtml(s.distanceRemainingKm ?? '—')} km to go`));
    }
  }
  if (fields.has('nextStation')) rows.push(row('Next station', s.nextStation ? `${station(s.nextStation)}${s.nextStationEta ? ` · ETA ${ist(s.nextStationEta)}` : ''}` : '—'));
  if (fields.has('schedule')) rows.push(row('Scheduled departure', ist(s.scheduledDeparture)), row('Scheduled arrival', ist(s.scheduledArrival)));
  if (fields.has('actualTimings')) {
    rows.push(row('Actual departure', ist(s.actualDeparture)));
    rows.push(row(s.actualArrival ? 'Actual arrival' : 'Expected arrival', ist(s.actualArrival ?? s.expectedArrival)));
  }
  if (fields.has('delays')) rows.push(row('Delay', escapeHtml(formatDelay(s.delayMinutes))));
  if (fields.has('platform')) rows.push(row('Platform', escapeHtml(s.platform ?? '—')));
  if (fields.has('exceptions')) rows.push(row('Exceptions', s.exceptions.length ? s.exceptions.map((e) => escapeHtml(e.message)).join('<br>') : 'None reported'));
  if (fields.has('mapLink')) {
    const links = [`<a href="${escapeHtml(mapLinkFor(input, s))}" style="color:#1d4ed8">Open map</a>`];
    if (s.position) {
      links.push(`<a href="${escapeHtml(osmLink(s.position.lat, s.position.lng))}" style="color:#1d4ed8">${escapeHtml(s.position.kind === 'estimated' ? 'Estimated location (not GPS)' : 'Reported location')}</a>`);
    }
    rows.push(row('Map', links.join(' · ')));
  }
  if (fields.has('sourceFreshness')) {
    rows.push(row('Data source', escapeHtml(s.provider.name)), row('Freshness', escapeHtml(freshnessLabel(s))));
    rows.push(row('Provider updated', ist(s.providerUpdatedAt)), row('Fetched', ist(s.fetchedAt)));
  }

  let route = '';
  if (fields.has('route')) {
    const halts = s.stops.filter((st) => st.isHalt);
    route = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-collapse:collapse;font-size:12px">
      <tr style="background:#f1f5f9"><th align="left" style="padding:4px 6px">Station</th><th align="left" style="padding:4px 6px">Sch. arr/dep</th><th align="left" style="padding:4px 6px">Actual / expected</th><th align="left" style="padding:4px 6px">Status</th></tr>
      ${halts
        .map((st) => {
          const actual = st.actualArrival ?? st.actualDeparture;
          const expected = st.expectedArrival ?? st.expectedDeparture;
          return `<tr style="border-top:1px solid #e2e8f0"><td style="padding:4px 6px">${escapeHtml(st.stationName)} (${escapeHtml(st.stationCode)})</td><td style="padding:4px 6px">${escapeHtml(formatIst(st.scheduledArrival, 'time'))} / ${escapeHtml(formatIst(st.scheduledDeparture, 'time'))}</td><td style="padding:4px 6px">${actual ? `${escapeHtml(formatIst(actual, 'time'))} actual` : expected ? `${escapeHtml(formatIst(expected, 'time'))} expected` : '—'}</td><td style="padding:4px 6px">${escapeHtml(st.status)}</td></tr>`;
        })
        .join('')}
    </table>`;
  }

  const demo = s.provider.isDemo
    ? '<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:#7c2d12;color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em">DEMO DATA</span>'
    : '';
  const stale = s.freshness === 'stale' && s.notice ? `<p style="margin:8px 0;padding:8px;border-radius:6px;background:#fff4d6;color:#7c4a03;font-size:12px">${escapeHtml(s.notice)}</p>` : '';
  return `<tr><td id="train-${escapeHtml(s.trainNumber)}" style="padding:16px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff">
    <div style="font-size:16px;font-weight:700;color:#0f172a">${escapeHtml(s.trainNumber)} · ${escapeHtml(s.trainName)}${demo}</div>
    <div style="margin-top:6px"><span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-size:12px;font-weight:600">${escapeHtml(STATE_META[s.state].label)}</span>
    ${s.delayMinutes !== null ? `<span style="margin-left:8px;font-size:12px;color:#334155">${escapeHtml(formatDelay(s.delayMinutes))}</span>` : ''}</div>
    ${stale}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px">${rows.join('')}</table>
    ${route}
    <p style="margin:10px 0 0;font-size:11px;color:#64748b">Source: ${escapeHtml(s.provider.name)}${s.provider.isDemo ? ' (simulated demo data)' : ''} · Provider updated ${ist(s.providerUpdatedAt)} · Fetched ${ist(s.fetchedAt)}</p>
  </td></tr><tr><td style="height:12px"></td></tr>`;
}

export function buildReport(input: BuildReportInput): BuiltReport {
  const fields = resolveReportFields(input.fields);
  const fieldSet = new Set(fields);
  const generatedAt = input.generatedAt ?? new Date();
  const anyDemo = input.statuses.some((s) => s.provider.isDemo);
  const subject =
    input.subject?.trim() ||
    `${anyDemo ? '[DEMO] ' : ''}RailTrack Live report — ${input.statuses.length + input.failures.length} train${input.statuses.length + input.failures.length === 1 ? '' : 's'} (${formatIst(generatedAt, 'short')} IST)`;

  const table = buildReportTable(input.statuses, fields, { mapLink: (s) => mapLinkFor(input, s) });
  const csv = CSV_BOM + toCsv(table.headers, table.rows);
  const csvFileName = `railtrack-report-${todayInIst(generatedAt)}.csv`;

  const fieldLabels = REPORT_FIELDS.filter((f) => fieldSet.has(f.id)).map((f) => f.label).join(', ');
  const failures = input.failures.length
    ? `<tr><td style="padding:12px 16px;border:1px solid #fecaca;border-radius:10px;background:#fef2f2;font-size:13px;color:#7f1d1d"><strong>Unavailable:</strong><br>${input.failures
        .map((f) => `${escapeHtml(f.trainNumber)} (${escapeHtml(f.journeyDate)}) — ${escapeHtml(f.error?.message ?? 'No data')}`)
        .join('<br>')}</td></tr><tr><td style="height:12px"></td></tr>`
    : '';
  const alertBlock = input.alertLines?.length
    ? `<tr><td style="padding:12px 16px;border-radius:10px;background:#e6efff;color:#1e3a8a;font-size:14px"><strong>Alert</strong><br>${input.alertLines.map(escapeHtml).join('<br>')}</td></tr><tr><td style="height:12px"></td></tr>`
    : '';
  const demoBanner = anyDemo
    ? `<tr><td style="padding:10px 16px;border-radius:10px;background:#7c2d12;color:#ffffff;font-size:13px;font-weight:700">DEMO DATA — simulated trains, not live railway information.</td></tr><tr><td style="height:12px"></td></tr>`
    : '';
  const message = input.message ? `<p style="margin:0 0 12px;font-size:14px;color:#0f172a;white-space:pre-wrap">${escapeHtml(input.message)}</p>` : '';
  const share = input.shareUrl
    ? `<p style="margin:0 0 12px;font-size:13px"><a href="${escapeHtml(input.shareUrl)}" style="color:#1d4ed8">View this report and map online</a> (read-only link that expires)</p>`
    : '';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
<tr><td style="padding:8px 0 16px"><div style="font-size:20px;font-weight:800;color:#1e3a8a">RailTrack Live</div><div style="font-size:12px;color:#475569">Generated ${escapeHtml(formatIst(generatedAt))} IST · Fields: ${escapeHtml(fieldLabels)}</div></td></tr>
${demoBanner}${alertBlock}<tr><td>${message}${share}</td></tr>
${input.statuses.map((s) => trainSection(s, fieldSet, input)).join('')}
${failures}
<tr><td style="padding:8px 0;font-size:11px;color:#64748b;line-height:1.5">Train data is provided by the third-party source named on each train and may be delayed or incomplete. Estimated positions are interpolated between reported stations and are not GPS locations. A CSV with the selected fields is attached.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    'RailTrack Live report',
    `Generated ${formatIst(generatedAt)} IST`,
    anyDemo ? 'DEMO DATA — simulated trains, not live railway information.' : '',
    ...(input.alertLines ?? []),
    input.message ?? '',
    input.shareUrl ? `View online: ${input.shareUrl}` : '',
    '',
    ...input.statuses.map(
      (s) =>
        `${s.trainNumber} ${s.trainName} — ${STATE_META[s.state].label}, ${formatDelay(s.delayMinutes)}. ` +
        `Last reported: ${s.lastReportedStation ? `${s.lastReportedStation.name} (${s.lastReportedStation.code})` : '—'}. ` +
        `Next: ${s.nextStation ? s.nextStation.name : '—'}. Source: ${s.provider.name}${s.provider.isDemo ? ' (DEMO)' : ''}, updated ${formatIst(s.providerUpdatedAt ?? s.fetchedAt)} IST.`,
    ),
    ...input.failures.map((f) => `${f.trainNumber}: unavailable — ${f.error?.message ?? 'no data'}`),
    '',
    'Estimated positions are interpolated, not GPS.',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return { subject: subject.slice(0, 200), html, text, csv, csvFileName, fields };
}
