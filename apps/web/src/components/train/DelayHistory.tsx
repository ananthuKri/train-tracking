import { useMemo, useState, type PointerEvent } from 'react';
import { formatDelay, STATE_META, type SnapshotSummary } from '@railtrack/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ist } from '@/lib/time';
import { cn } from '@/lib/utils';
import { DemoBadge } from './badges';

const W = 320;
const H = 88;
const PAD = { top: 10, right: 8, bottom: 14, left: 8 };

interface Point {
  x: number;
  y: number;
  snap: SnapshotSummary;
}

/** Delay-over-time sparkline (single series → no legend) with a hover crosshair and a table view. */
export function DelaySparkline({ items, className }: { items: readonly SnapshotSummary[]; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(
    () =>
      [...items]
        .filter((s) => s.delayMinutes !== null)
        .sort((a, b) => new Date(a.fetchedAt).getTime() - new Date(b.fetchedAt).getTime()),
    [items],
  );

  const model = useMemo(() => {
    if (series.length < 2) return null;
    const t0 = new Date(series[0]!.fetchedAt).getTime();
    const t1 = new Date(series[series.length - 1]!.fetchedAt).getTime();
    const delays = series.map((s) => s.delayMinutes!);
    const min = Math.min(0, ...delays);
    const max = Math.max(5, ...delays);
    const sx = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
    const sy = (d: number) => PAD.top + (1 - (d - min) / Math.max(1, max - min)) * (H - PAD.top - PAD.bottom);
    const points: Point[] = series.map((s) => ({ x: sx(new Date(s.fetchedAt).getTime()), y: sy(s.delayMinutes!), snap: s }));
    return { points, zeroY: sy(0), max, min };
  }, [series]);

  if (!model) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Not enough verified fetches yet to chart the delay trend.
      </p>
    );
  }

  const path = model.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const active = hover !== null ? model.points[hover] : model.points[model.points.length - 1];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    model.points.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(model.points[best]!.x - x)) best = i;
    });
    setHover(best);
  };

  return (
    <figure className={cn('space-y-1', className)}>
      <figcaption className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>Delay trend (minutes late)</span>
        {active && (
          <span aria-live="polite" className="text-foreground">
            <span className="font-mono tabular-nums">{formatDelay(active.snap.delayMinutes)}</span>
            <span className="text-muted-foreground"> · {ist(active.snap.fetchedAt)}</span>
          </span>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-24 w-full touch-none overflow-visible"
        role="img"
        aria-label={`Delay over the last ${series.length} verified fetches, from ${formatDelay(series[0]!.delayMinutes)} to ${formatDelay(
          series[series.length - 1]!.delayMinutes,
        )}. See the table below for values.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* on-time baseline */}
        <line x1={PAD.left} x2={W - PAD.right} y1={model.zeroY} y2={model.zeroY} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />
        <text x={W - PAD.right} y={model.zeroY - 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
          on time
        </text>
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && active && (
          <line x1={active.x} x2={active.x} y1={PAD.top - 4} y2={H - PAD.bottom} className="stroke-muted-foreground/60" strokeWidth={1} />
        )}
        {active && (
          <circle cx={active.x} cy={active.y} r={4} className="fill-primary stroke-background" strokeWidth={2} />
        )}
      </svg>
    </figure>
  );
}

export function DelayHistory({
  items,
  isLoading,
  error,
}: {
  items: readonly SnapshotSummary[] | undefined;
  isLoading: boolean;
  error: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (error) return <p className="text-sm text-muted-foreground">History unavailable: {error}</p>;
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground">No verified fetches recorded for this journey yet.</p>;
  }
  const rows = expanded ? items : items.slice(0, 8);
  const allDemo = items.every((s) => s.isDemo);
  return (
    <div data-testid="delay-history" className="space-y-3">
      {allDemo && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <DemoBadge /> Simulated history
        </p>
      )}
      <DelaySparkline items={items} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Verified fetches, newest first</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="py-1.5 pr-2 font-medium">Fetched (IST)</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Status</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Delay</th>
              <th scope="col" className="py-1.5 font-medium">Last / next</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="py-1.5 pr-2 font-mono tabular-nums">
                  {ist(s.fetchedAt)} {s.isDemo && !allDemo && <DemoBadge className="ml-1 align-middle" />}
                </td>
                <td className="py-1.5 pr-2">{STATE_META[s.state].label}</td>
                <td className="py-1.5 pr-2 font-mono tabular-nums">{formatDelay(s.delayMinutes)}</td>
                <td className="py-1.5 font-mono">
                  {s.lastStationCode ?? '—'} → {s.nextStationCode ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 8 && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? 'Show fewer' : `Show all ${items.length}`}
        </Button>
      )}
    </div>
  );
}
