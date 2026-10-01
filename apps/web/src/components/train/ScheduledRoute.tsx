import { formatIst, istWallClockToUtc, type NormalizedRoute } from '@railtrack/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** Timetable (from /route) shown when live status isn't available — scheduled times only. */
export function ScheduledRoute({ route, journeyDate }: { route: NormalizedRoute; journeyDate: string }) {
  const time = (hhmm: string | null, day: number | null) =>
    hhmm ? formatIst(istWallClockToUtc(journeyDate, hhmm, day ?? 1), 'time') : '—';
  const halts = route.stops.filter((s) => s.isHalt);
  return (
    <div className="space-y-2" data-testid="scheduled-route">
      <p className="text-xs text-muted-foreground">
        Scheduled timetable (IST) from {route.provider.name}
        {route.runningDays?.length ? ` · runs ${route.runningDays.join(' ')}` : ''}
        {route.totalDistanceKm ? ` · ${Math.round(route.totalDistanceKm)} km` : ''}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Station</TableHead>
            <TableHead scope="col">Arrival (IST)</TableHead>
            <TableHead scope="col">Departure (IST)</TableHead>
            <TableHead scope="col">Day</TableHead>
            <TableHead scope="col">Platform</TableHead>
            <TableHead scope="col" className="text-right">
              km
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {halts.map((s) => (
            <TableRow key={`${s.sequence}-${s.stationCode}`}>
              <TableCell>
                {s.stationName} <span className="font-mono text-xs text-muted-foreground">{s.stationCode}</span>
              </TableCell>
              <TableCell className="font-mono tabular-nums">{time(s.scheduledArrival, s.day)}</TableCell>
              <TableCell className="font-mono tabular-nums">{time(s.scheduledDeparture, s.day)}</TableCell>
              <TableCell className="font-mono tabular-nums">{s.day ?? '—'}</TableCell>
              <TableCell className="font-mono">{s.platform ?? '—'}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{s.distanceKm !== null ? Math.round(s.distanceKm) : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
