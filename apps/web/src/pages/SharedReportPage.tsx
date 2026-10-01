import { Link, useParams } from 'react-router';
import { Camera, ExternalLink, Link2Off } from 'lucide-react';
import {
  REPORT_FIELDS,
  formatJourneyDate,
  osmLink,
  resolveReportFields,
  trainStyle,
  type NormalizedTrainStatus,
  type ReportFieldId,
} from '@railtrack/shared';
import { isApiError } from '@/api/client';
import { useSharedReport } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { TrainMap } from '@/components/map/LazyTrainMap';
import { positionCaption } from '@/components/map/mapModel';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DelayChip, DemoBadge, StatusBadge, TrainGlyph } from '@/components/train/badges';
import { ExceptionBanners } from '@/components/train/ExceptionBanners';
import { JourneyProgress } from '@/components/train/JourneyProgress';
import { EVENT_LABELS, stationText } from '@/components/train/KeyFacts';
import { SourceFreshness } from '@/components/train/SourceFreshness';
import { TrainErrorState } from '@/components/train/TrainErrorState';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ist } from '@/lib/time';
import { trainKey } from '@/lib/trainKey';
import { useReportDemo } from '@/stores/demo';

const MAP_FIELDS: ReportFieldId[] = ['currentLocation', 'mapLink', 'route'];

export default function SharedReportPage() {
  useDocumentTitle('Shared train report');
  const { token = '' } = useParams();
  const query = useSharedReport(token);
  const report = query.data;
  const anyDemo = report?.trains.some((t) => t.provider.isDemo) ?? false;
  useReportDemo(`shared-${token}`, anyDemo);

  if (query.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading shared report">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (query.error) {
    const code = isApiError(query.error) ? query.error.code : null;
    if (code === 'NOT_FOUND') {
      return (
        <EmptyState
          testId="shared-not-found"
          icon={Link2Off}
          title="This shared link is invalid or has expired"
          description="Shared report links are read-only snapshots that expire. Ask the sender for a new report."
          action={
            <Button asChild variant="outline">
              <Link to="/">Track a train yourself</Link>
            </Button>
          }
        />
      );
    }
    return <TrainErrorState code={code} message={query.error.message} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  if (!report) return null;

  const fields = new Set(resolveReportFields(report.fields));
  const showMap = MAP_FIELDS.some((f) => fields.has(f));
  const fieldLabels = REPORT_FIELDS.filter((f) => fields.has(f.id)).map((f) => f.label);
  const mapTrains = report.trains.map((s, i) => ({ key: trainKey(s), status: s, styleIndex: i }));

  return (
    <div data-testid="shared-report" className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Shared train report · read-only</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {report.trains.length === 1
            ? `Train ${report.trains[0]!.trainNumber} ${report.trains[0]!.trainName}`
            : `${report.trains.length} trains`}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="snapshot-time">
          <Camera aria-hidden className="size-4" />
          Snapshot as of {ist(report.createdAt)} · link expires {ist(report.expiresAt)}
          {anyDemo && <DemoBadge />}
        </p>
      </header>

      <Alert tone="info" title="This is a snapshot, not a live view">
        The data below was captured when the report was created and does not update.{' '}
        <Link to="/" className="font-medium underline underline-offset-2">
          Track live status
        </Link>
      </Alert>

      {showMap && mapTrains.length > 0 && (
        <TrainMap trains={mapTrains} heightClass="h-[340px] sm:h-[420px]" detailLinks={false} label="Map of trains in this report" />
      )}

      <p className="text-xs text-muted-foreground">Included: {fieldLabels.join(', ')}</p>

      <ul className="grid gap-4 md:grid-cols-2">
        {report.trains.map((s, i) => (
          <li key={trainKey(s)}>
            <SharedTrainCard status={s} fields={fields} styleIndex={i} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-b py-1.5 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function SharedTrainCard({ status: s, fields, styleIndex }: { status: NormalizedTrainStatus; fields: Set<ReportFieldId>; styleIndex: number }) {
  const { color, shape } = trainStyle(styleIndex);
  const caption = positionCaption(s);
  return (
    <article data-testid="shared-train" className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
      <header className="space-y-1.5">
        <h2 className="flex flex-wrap items-center gap-2 text-base">
          <TrainGlyph shape={shape} color={color} dashed={caption.kind === 'estimated'} />
          <span className="font-mono font-semibold">{s.trainNumber}</span>
          {fields.has('identity') && <span className="font-medium">{s.trainName}</span>}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {fields.has('identity') && <StatusBadge state={s.state} />}
          {fields.has('delays') && <DelayChip minutes={s.delayMinutes} />}
          {s.provider.isDemo && <DemoBadge />}
        </div>
        {fields.has('identity') && <p className="text-xs text-muted-foreground">Journey {formatJourneyDate(s.journeyDate)}</p>}
      </header>

      {fields.has('exceptions') && <ExceptionBanners status={s} compact />}

      <dl>
        {fields.has('sourceDestination') && (
          <>
            <Row label="Source">{stationText(s.source)}</Row>
            <Row label="Destination">{stationText(s.destination)}</Row>
          </>
        )}
        {fields.has('currentLocation') && (
          <>
            <Row label="Last reported">
              {s.lastReportedStation
                ? `${s.lastReportedEvent ? `${EVENT_LABELS[s.lastReportedEvent]} ` : ''}${stationText(s.lastReportedStation)}`
                : '—'}
              {s.lastReportedAt && <span className="block text-xs font-normal text-muted-foreground">{ist(s.lastReportedAt)}</span>}
            </Row>
            <Row label="Position">
              <span data-testid="position-label">{caption.label}</span>
            </Row>
          </>
        )}
        {fields.has('nextStation') && (
          <Row label="Next station">
            {stationText(s.nextStation)}
            {s.nextStationEta && <span className="block text-xs font-normal text-muted-foreground">Expected {ist(s.nextStationEta)}</span>}
          </Row>
        )}
        {fields.has('schedule') && (
          <>
            <Row label="Scheduled departure">{ist(s.scheduledDeparture)}</Row>
            <Row label="Scheduled arrival">{ist(s.scheduledArrival)}</Row>
          </>
        )}
        {fields.has('actualTimings') && (
          <>
            <Row label="Actual departure">{ist(s.actualDeparture)}</Row>
            {s.actualArrival ? (
              <Row label="Actual arrival">{ist(s.actualArrival)}</Row>
            ) : (
              <Row label="Expected arrival">{ist(s.expectedArrival)}</Row>
            )}
          </>
        )}
        {fields.has('platform') && <Row label="Platform">{s.platform ?? '—'}</Row>}
        {fields.has('route') && (
          <Row label="Route">
            <span className="font-mono text-xs">
              {s.stops
                .filter((st) => st.isHalt)
                .map((st) => st.stationCode)
                .join(' › ') || '—'}
            </span>
          </Row>
        )}
        {fields.has('mapLink') && s.position && (
          <Row label="Map">
            <a
              href={osmLink(s.position.lat, s.position.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
            >
              Open in OpenStreetMap <ExternalLink aria-hidden className="size-3" />
              <span className="sr-only">(opens in a new tab; {caption.label})</span>
            </a>
          </Row>
        )}
      </dl>

      {fields.has('currentLocation') && <JourneyProgress status={s} compact />}

      {fields.has('sourceFreshness') ? (
        <SourceFreshness status={s} variant="compact" />
      ) : (
        <p className="text-xs text-muted-foreground">
          Source: {s.provider.name} · fetched {ist(s.fetchedAt)}
        </p>
      )}
    </article>
  );
}
