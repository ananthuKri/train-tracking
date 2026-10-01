import { LocateFixed } from 'lucide-react';
import { lastUpdateTime, relativeTime, trainStyle, type TrackResult } from '@railtrack/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DelayChip, DemoBadge, ResultStatusBadge, TrainGlyph } from '@/components/train/badges';
import { errorMeta } from '@/components/train/errorMeta';
import { currentLocationText, nextStationEtaText } from '@/components/train/summary';
import { useNow } from '@/hooks/useNow';
import { ist } from '@/lib/time';
import { resultKey } from '@/lib/trainKey';
import { cn } from '@/lib/utils';

export function ResultsTable({
  results,
  styleIndex,
  selectedKeys,
  focusedKey,
  onToggleSelect,
  onSelectAll,
  onOpen,
  onFocus,
}: {
  results: readonly TrackResult[];
  styleIndex: (key: string) => number;
  selectedKeys: readonly string[];
  focusedKey: string | null;
  onToggleSelect: (key: string) => void;
  onSelectAll: (select: boolean) => void;
  onOpen: (key: string) => void;
  onFocus: (key: string) => void;
}) {
  const now = useNow();
  const selected = new Set(selectedKeys);
  const allSelected = results.length > 0 && results.every((r) => selected.has(resultKey(r)));
  const someSelected = !allSelected && results.some((r) => selected.has(resultKey(r)));

  return (
    <div className="rounded-lg border bg-card">
      <Table data-testid="results-table" className="min-w-[1080px]">
        <caption className="sr-only">Tracked trains. Select a row to open its details.</caption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">
              <Checkbox
                aria-label={allSelected ? 'Deselect all shown trains' : 'Select all shown trains'}
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(v) => onSelectAll(v === true)}
                data-testid="select-all"
              />
            </TableHead>
            <TableHead scope="col">Train</TableHead>
            <TableHead scope="col">Name</TableHead>
            <TableHead scope="col">Source</TableHead>
            <TableHead scope="col">Destination</TableHead>
            <TableHead scope="col">Current location</TableHead>
            <TableHead scope="col">Next station</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Delay</TableHead>
            <TableHead scope="col">Updated (IST)</TableHead>
            <TableHead scope="col">
              <span className="sr-only">Map</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r) => {
            const key = resultKey(r);
            const s = r.status;
            const { color, shape } = trainStyle(styleIndex(key));
            const updated = lastUpdateTime(r);
            const isSelected = selected.has(key);
            return (
              <TableRow
                key={key}
                data-testid="result-row"
                data-train={r.trainNumber}
                data-state={isSelected ? 'selected' : undefined}
                onClick={() => onOpen(key)}
                className={cn('cursor-pointer', focusedKey === key && 'bg-accent/60', !r.ok && 'bg-red-50/40 dark:bg-red-950/20')}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleSelect(key)}
                    aria-label={`Select train ${r.trainNumber}`}
                    data-testid="select-row"
                  />
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(key);
                    }}
                    className="inline-flex items-center gap-1.5 rounded font-mono font-semibold tabular-nums text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Open details for train ${r.trainNumber}`}
                  >
                    <TrainGlyph shape={shape} color={color} dashed={s?.position?.kind === 'estimated'} />
                    {r.trainNumber}
                  </button>
                  {s?.provider.isDemo && <DemoBadge className="mt-1 block w-fit" />}
                </TableCell>
                <TableCell className="max-w-[12rem]">
                  <span className="line-clamp-2">{s?.trainName ?? '—'}</span>
                </TableCell>
                <TableCell className="max-w-[10rem]">
                  {s ? (
                    <span className="line-clamp-2" title={`${s.source.name} (${s.source.code})`}>
                      {s.source.name} <span className="font-mono text-xs text-muted-foreground">{s.source.code}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="max-w-[10rem]">
                  {s ? (
                    <span className="line-clamp-2" title={`${s.destination.name} (${s.destination.code})`}>
                      {s.destination.name} <span className="font-mono text-xs text-muted-foreground">{s.destination.code}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="max-w-[14rem]">
                  {s ? (
                    <>
                      <span className="line-clamp-2">{currentLocationText(s)}</span>
                      {s.lastReportedAt && <span className="font-mono text-xs text-muted-foreground tabular-nums">{ist(s.lastReportedAt, 'time')}</span>}
                    </>
                  ) : (
                    <span className="text-xs">{errorMeta(r.error?.code ?? null).title}</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[12rem]">
                  {s?.nextStation ? (
                    <>
                      <span className="line-clamp-2">
                        {s.nextStation.name} <span className="font-mono text-xs text-muted-foreground">{s.nextStation.code}</span>
                      </span>
                      {nextStationEtaText(s) && <span className="font-mono text-xs text-muted-foreground tabular-nums">{nextStationEtaText(s)}</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <ResultStatusBadge result={r} />
                    {s?.freshness === 'stale' && (
                      <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Last verified</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{s ? <DelayChip minutes={s.delayMinutes} /> : '—'}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {updated ? (
                    <>
                      <span className="block font-mono text-xs tabular-nums">{ist(new Date(updated), 'short')}</span>
                      <span className="text-xs text-muted-foreground">{relativeTime(new Date(updated), now)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {s?.position && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onFocus(key)}
                      aria-label={`Show train ${r.trainNumber} on the map`}
                      aria-pressed={focusedKey === key}
                    >
                      <LocateFixed aria-hidden />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
