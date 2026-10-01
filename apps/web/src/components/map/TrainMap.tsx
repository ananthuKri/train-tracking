import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { divIcon, latLngBounds, type LatLngTuple, type Map as LeafletMap } from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from 'react-leaflet';
import { Link } from 'react-router';
import { LocateFixed, Maximize2, MapPinned, Pause, Play } from 'lucide-react';
import {
  buildRouteGeometry,
  pointAtDistance,
  positionToRouteKm,
  relativeTime,
  trainStyle,
  type LatLng,
  type NormalizedTrainStatus,
} from '@railtrack/shared';
import { useConfig } from '@/api/hooks';
import { DemoBadge, StatusBadge, TrainGlyph } from '@/components/train/badges';
import { EVENT_LABELS, stationText } from '@/components/train/KeyFacts';
import { prefersReducedMotion, usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { ist } from '@/lib/time';
import { trainDetailPath } from '@/lib/trainKey';
import { cn } from '@/lib/utils';
import { useAnimatedNumber, useLivePosition } from './animation';
import {
  INDIA_CENTER,
  boundsPoints,
  fallbackTravelledKm,
  missingCoordinatesNote,
  positionCaption,
  splitRouteAtKm,
  stationPoint,
} from './mapModel';
import { stationPillHtml, trainMarkerHtml } from './markers';

export interface MapTrain {
  key: string;
  status: NormalizedTrainStatus;
  /** Index into the colour/shape palette (keep stable per train). */
  styleIndex: number;
}

export interface TrainMapProps {
  trains: readonly MapTrain[];
  focusedKey?: string | null;
  onFocusChange?: (key: string | null) => void;
  className?: string;
  /** Tailwind height class for the map viewport. */
  heightClass?: string;
  scrollWheelZoom?: boolean;
  showLegend?: boolean;
  defaultShowStations?: boolean;
  /** Accessible name of the map region. */
  label?: string;
  /** Show "Open details" links in popups. */
  detailLinks?: boolean;
}

const DEFAULT_TILES = {
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 18,
};

const tuple = (p: LatLng): LatLngTuple => [p.lat, p.lng];

export default function TrainMap({
  trains,
  focusedKey = null,
  onFocusChange,
  className,
  heightClass = 'h-80',
  scrollWheelZoom = false,
  showLegend = true,
  defaultShowStations,
  label = 'Train map',
  detailLinks = true,
}: TrainMapProps) {
  const { data: config } = useConfig();
  const tiles = config?.map ?? DEFAULT_TILES;
  const reducedMotion = usePrefersReducedMotion();
  const [animate, setAnimate] = useState(() => !prefersReducedMotion());
  const [showStations, setShowStations] = useState(defaultShowStations ?? trains.length === 1);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, LatLng>());

  useEffect(() => {
    if (reducedMotion) setAnimate(false);
  }, [reducedMotion]);

  const single = trains.length === 1;
  const effectiveFocus = focusedKey ?? (single ? (trains[0]?.key ?? null) : null);
  const focusedTrain = trains.find((t) => t.key === effectiveFocus) ?? null;

  const onFocusRef = useRef(onFocusChange);
  onFocusRef.current = onFocusChange;
  const selectTrain = useCallback((key: string) => onFocusRef.current?.(key), []);

  const reportPosition = useCallback((key: string, ll: LatLng | null) => {
    if (ll) positions.current.set(key, ll);
    else positions.current.delete(key);
  }, []);

  const fitTo = useCallback(
    (subset: readonly MapTrain[]) => {
      if (!map) return;
      const pts = subset.flatMap((t) => boundsPoints(t.status));
      if (pts.length === 0) return;
      if (pts.length === 1) {
        map.setView(tuple(pts[0]!), 9, { animate: !reducedMotion });
        return;
      }
      map.fitBounds(latLngBounds(pts.map(tuple)), { padding: [28, 28], maxZoom: 12, animate: !reducedMotion });
    },
    [map, reducedMotion],
  );

  // Fit on first render and whenever the set of trains changes.
  const trainSetKey = trains.map((t) => t.key).join('|');
  const trainsRef = useRef(trains);
  trainsRef.current = trains;
  useEffect(() => {
    fitTo(trainsRef.current);
  }, [fitTo, trainSetKey]);

  // Pan to a train when it is focused from the list.
  useEffect(() => {
    if (!map || !focusedKey || trainsRef.current.length < 2) return;
    const pos = positions.current.get(focusedKey);
    const t = trainsRef.current.find((x) => x.key === focusedKey);
    if (pos) map.setView(tuple(pos), Math.max(map.getZoom(), 8), { animate: !reducedMotion });
    else if (t) fitTo([t]);
  }, [focusedKey, map, fitTo, reducedMotion]);

  // Leaflet must be told when its container resizes (drawers animate open, layouts reflow).
  useEffect(() => {
    if (!map || !wrapperRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [map]);

  const recenter = () => {
    const target = focusedTrain ?? trains[0];
    if (!map || !target) return;
    const pos = positions.current.get(target.key);
    if (pos) map.setView(tuple(pos), Math.max(map.getZoom(), 9), { animate: !reducedMotion });
    else fitTo([target]);
  };
  const fullRoute = () => fitTo(focusedTrain ? [focusedTrain] : trains);

  const missingCount = useMemo(() => {
    const codes = new Set<string>();
    for (const t of trains) for (const c of buildRouteGeometry(t.status.stops).missingCoordinates) codes.add(c);
    return codes.size;
  }, [trains]);
  const missingNote = missingCoordinatesNote(missingCount);

  return (
    <div className={cn('space-y-2', className)}>
      <div
        ref={wrapperRef}
        data-testid="train-map"
        role="region"
        aria-label={label}
        className={cn('relative isolate overflow-hidden rounded-lg border bg-muted', heightClass)}
      >
        <MapContainer
          ref={setMap}
          center={tuple(INDIA_CENTER)}
          zoom={5}
          maxZoom={tiles.maxZoom}
          scrollWheelZoom={scrollWheelZoom}
          className="h-full w-full"
        >
          <TileLayer url={tiles.tileUrl} attribution={tiles.attribution} maxZoom={tiles.maxZoom} />
          {trains.map((t) => (
            <TrainLayer
              key={t.key}
              train={t}
              focused={t.key === effectiveFocus}
              dimmed={!!effectiveFocus && t.key !== effectiveFocus}
              showStations={showStations && (single || !effectiveFocus || t.key === effectiveFocus)}
              showContext={single || t.key === effectiveFocus}
              animate={animate}
              detailLinks={detailLinks}
              onSelect={selectTrain}
              onPosition={reportPosition}
            />
          ))}
        </MapContainer>

        <div className="absolute right-2 top-2 z-[1001] flex flex-col gap-1.5" role="toolbar" aria-label="Map controls">
          <MapButton
            testId="map-recenter"
            onClick={recenter}
            label={focusedTrain ? `Recenter on train ${focusedTrain.status.trainNumber}` : 'Recenter'}
            text="Recenter"
            icon={LocateFixed}
            disabled={trains.length === 0}
          />
          <MapButton testId="map-full-route" onClick={fullRoute} label="Show full route" text="Full route" icon={Maximize2} disabled={trains.length === 0} />
          <MapButton
            testId="map-toggle-stations"
            onClick={() => setShowStations((v) => !v)}
            label="Show stations"
            text="Stations"
            icon={MapPinned}
            pressed={showStations}
          />
          <MapButton
            testId="map-toggle-animation"
            onClick={() => setAnimate((v) => !v)}
            label="Animate train movement"
            text={animate ? 'Animation on' : 'Animation off'}
            icon={animate ? Pause : Play}
            pressed={animate}
          />
        </div>
      </div>

      {showLegend && (
        <MapLegend
          trains={trains}
          focusedKey={effectiveFocus}
          onFocus={onFocusChange}
          missingNote={missingNote}
        />
      )}
      {!showLegend && missingNote && (
        <p data-testid="missing-coords" className="text-xs text-muted-foreground">
          {missingNote}
        </p>
      )}
    </div>
  );
}

function MapButton({
  testId,
  onClick,
  label,
  text,
  icon: Icon,
  pressed,
  disabled,
}: {
  testId: string;
  onClick: () => void;
  label: string;
  text: string;
  icon: typeof Play;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      title={label}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border bg-card/95 px-2 text-xs font-medium text-card-foreground shadow-sm backdrop-blur outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        pressed && 'border-primary bg-accent text-accent-foreground',
      )}
    >
      <Icon aria-hidden className="size-4" />
      <span className="hidden sm:inline">{text}</span>
    </button>
  );
}

// ---------------------------------------------------------------- per-train layer

function TrainLayer({
  train,
  focused,
  dimmed,
  showStations,
  showContext,
  animate,
  detailLinks,
  onSelect,
  onPosition,
}: {
  train: MapTrain;
  focused: boolean;
  dimmed: boolean;
  showStations: boolean;
  showContext: boolean;
  animate: boolean;
  detailLinks: boolean;
  onSelect: (key: string) => void;
  onPosition: (key: string, ll: LatLng | null) => void;
}) {
  const { status } = train;
  const { color, shape } = trainStyle(train.styleIndex);
  const geometry = useMemo(() => buildRouteGeometry(status.stops), [status.stops]);
  const position = useLivePosition(status, animate);
  const targetKm = useMemo(
    () => (position && geometry.points.length > 1 ? positionToRouteKm(geometry, position) : null),
    [geometry, position],
  );
  const displayKm = useAnimatedNumber(targetKm, animate);
  const animating = targetKm !== null && displayKm !== null && Math.abs(displayKm - targetKm) > 1e-3;
  const markerPos: LatLng | null = position
    ? animating
      ? (pointAtDistance(geometry.points, displayKm!) ?? position)
      : { lat: position.lat, lng: position.lng }
    : null;
  const splitKm = displayKm ?? fallbackTravelledKm(status, geometry);
  const { travelled, remaining } = useMemo(() => splitRouteAtKm(geometry.points, splitKm), [geometry, splitKm]);
  const caption = positionCaption(status, position);

  useEffect(() => {
    onPosition(train.key, markerPos);
  });

  const icon = useMemo(
    () =>
      caption.kind === 'none'
        ? null
        : divIcon({
            className: 'rt-divicon',
            html: trainMarkerHtml({ color, shape, kind: caption.kind, trainNumber: status.trainNumber, focused, dimmed }),
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -14],
          }),
    [color, shape, caption.kind, status.trainNumber, focused, dimmed],
  );

  const weight = focused ? 5 : 4;
  const handlers = useMemo(() => ({ click: () => onSelect(train.key) }), [onSelect, train.key]);
  const origin = showContext ? stationPoint(status, status.source) : null;
  const dest = showContext ? stationPoint(status, status.destination) : null;
  const prev = showContext ? stationPoint(status, status.previousStation) : null;
  const next = showContext ? stationPoint(status, status.nextStation) : null;
  const originIcon = useMemo(
    () => (origin ? divIcon({ className: 'rt-divicon', html: stationPillHtml(origin.code, 'origin'), iconSize: [0, 0] }) : null),
    [origin?.code], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const destIcon = useMemo(
    () => (dest ? divIcon({ className: 'rt-divicon', html: stationPillHtml(dest.code, 'dest'), iconSize: [0, 0] }) : null),
    [dest?.code], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <>
      {travelled.length > 1 && (
        <>
          <Polyline positions={travelled.map(tuple)} pathOptions={{ color: '#ffffff', weight: weight + 3, opacity: dimmed ? 0.35 : 0.9 }} interactive={false} />
          <Polyline positions={travelled.map(tuple)} pathOptions={{ color, weight, opacity: dimmed ? 0.45 : 1 }} eventHandlers={handlers} />
        </>
      )}
      {remaining.length > 1 && (
        <Polyline
          positions={remaining.map(tuple)}
          pathOptions={{ color, weight: weight - 1, opacity: dimmed ? 0.3 : 0.65, dashArray: '6 8' }}
          eventHandlers={handlers}
        />
      )}

      {showStations &&
        geometry.points.map((p) => {
          const stop = status.stops[p.stopIndex]!;
          return (
            <CircleMarker
              key={`${p.stationCode}-${p.stopIndex}`}
              center={tuple(p)}
              radius={stop.isHalt ? 4 : 2.5}
              pathOptions={{ color, weight: 1.5, fillColor: '#ffffff', fillOpacity: 1, opacity: dimmed ? 0.5 : 1 }}
            >
              <Tooltip direction="top" offset={[0, -4]}>
                {stop.stationName} ({stop.stationCode}){stop.isHalt ? '' : ' · no halt'}
              </Tooltip>
            </CircleMarker>
          );
        })}

      {prev && (
        <CircleMarker center={tuple(prev)} radius={7} pathOptions={{ color: '#0f172a', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -6]}>
            Previous station: {prev.name} ({prev.code})
          </Tooltip>
        </CircleMarker>
      )}
      {next && (
        <CircleMarker center={tuple(next)} radius={7} pathOptions={{ color, weight: 3, fillColor: '#ffffff', fillOpacity: 1, dashArray: '3 3' }}>
          <Tooltip direction="top" offset={[0, -6]}>
            Next station: {next.name} ({next.code})
          </Tooltip>
        </CircleMarker>
      )}
      {origin && originIcon && (
        <Marker position={tuple(origin)} title={`Origin: ${origin.name} (${origin.code})`} icon={originIcon} />
      )}
      {dest && destIcon && (
        <Marker position={tuple(dest)} title={`Destination: ${dest.name} (${dest.code})`} icon={destIcon} />
      )}

      {icon && markerPos && (
        <Marker
          position={tuple(markerPos)}
          icon={icon}
          title={`Train ${status.trainNumber} — ${caption.label}`}
          zIndexOffset={focused ? 1000 : 0}
          eventHandlers={handlers}
          keyboard
        >
          <Popup>
            <TrainPopup status={status} caption={caption} color={color} shape={shape} detailLinks={detailLinks} />
          </Popup>
        </Marker>
      )}
    </>
  );
}

function TrainPopup({
  status,
  caption,
  color,
  shape,
  detailLinks,
}: {
  status: NormalizedTrainStatus;
  caption: ReturnType<typeof positionCaption>;
  color: string;
  shape: ReturnType<typeof trainStyle>['shape'];
  detailLinks: boolean;
}) {
  return (
    <div className="w-60 space-y-1.5" data-testid="map-popup">
      <div className="flex items-center gap-1.5">
        <TrainGlyph shape={shape} color={color} dashed={caption.kind === 'estimated'} />
        <span className="font-mono text-sm font-semibold">{status.trainNumber}</span>
        <span className="truncate text-xs text-muted-foreground">{status.trainName}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {status.provider.isDemo && <DemoBadge />}
        <StatusBadge state={status.state} />
      </div>
      <p className="font-semibold">{caption.label}</p>
      {caption.basis && <p className="text-xs text-muted-foreground">{caption.basis}</p>}
      {status.lastReportedStation && (
        <p className="text-xs">
          {status.lastReportedEvent ? EVENT_LABELS[status.lastReportedEvent] : 'Last reported at'} {stationText(status.lastReportedStation)}
          {status.lastReportedAt ? ` · ${ist(status.lastReportedAt, 'time')}` : ''}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {status.provider.name} · fetched {ist(status.fetchedAt, 'time')} ({relativeTime(status.fetchedAt)})
      </p>
      {detailLinks && (
        <Link to={trainDetailPath(status)} className="inline-block text-xs font-medium text-primary underline underline-offset-2">
          Open train details
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- legend

function MapLegend({
  trains,
  focusedKey,
  onFocus,
  missingNote,
}: {
  trains: readonly MapTrain[];
  focusedKey: string | null;
  onFocus?: (key: string | null) => void;
  missingNote: string | null;
}) {
  const single = trains.length === 1;
  return (
    <div data-testid="map-legend" className="space-y-2 text-xs">
      <ul className={cn('flex flex-wrap gap-1.5', single && 'block')}>
        {trains.map((t) => {
          const { color, shape } = trainStyle(t.styleIndex);
          const caption = positionCaption(t.status);
          const focused = t.key === focusedKey;
          const content = (
            <>
              <TrainGlyph shape={shape} color={color} dashed={caption.kind === 'estimated'} />
              <span className="font-mono font-semibold">{t.status.trainNumber}</span>
              <span
                data-testid="position-label"
                data-kind={caption.kind}
                className={cn(caption.kind === 'estimated' && 'italic', caption.kind === 'none' && 'text-muted-foreground')}
              >
                {caption.label}
              </span>
            </>
          );
          return (
            <li key={t.key} className={cn(single && 'space-y-1')}>
              {single || !onFocus ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">{content}</span>
              ) : (
                <button
                  type="button"
                  aria-pressed={focused}
                  onClick={() => onFocus(focused ? null : t.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                    focused && 'border-primary bg-accent',
                  )}
                >
                  {content}
                </button>
              )}
              {(single || focused) && caption.basis && (
                <p data-testid="position-basis" className="mt-1 text-muted-foreground">
                  {caption.basis}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <TrainGlyph shape="circle" color="#334155" /> Reported position (from provider)
        </span>
        <span className="inline-flex items-center gap-1">
          <TrainGlyph shape="circle" color="#334155" dashed /> ≈ Estimated position — not GPS
        </span>
        <span>Solid line: travelled · Dashed: remaining</span>
      </p>
      {missingNote && (
        <p data-testid="missing-coords" className="text-muted-foreground">
          {missingNote}
        </p>
      )}
    </div>
  );
}
