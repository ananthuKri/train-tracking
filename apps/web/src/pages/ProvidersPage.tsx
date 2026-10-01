import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { CircleCheck, CircleX, ExternalLink, Gauge, Lock, PlugZap, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { relativeTime, type ProviderHealth, type Tone } from '@railtrack/shared';
import { isApiError } from '@/api/client';
import { useMe, useProviderHealth, useProviderUsage } from '@/api/hooks';
import { PageHeader } from '@/components/common/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DemoBadge } from '@/components/train/badges';
import { TrainErrorState } from '@/components/train/TrainErrorState';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNow } from '@/hooks/useNow';
import { TONE_BADGE } from '@/lib/tone';
import { ist } from '@/lib/time';
import { cn } from '@/lib/utils';

const HEALTH: Record<ProviderHealth['status'], { label: string; tone: Tone; icon: typeof CircleCheck }> = {
  up: { label: 'Up', tone: 'success', icon: CircleCheck },
  degraded: { label: 'Degraded', tone: 'warning', icon: TriangleAlert },
  down: { label: 'Down', tone: 'danger', icon: CircleX },
  not_configured: { label: 'Not configured', tone: 'neutral', icon: PlugZap },
};

export default function ProvidersPage() {
  useDocumentTitle('Provider health');
  const health = useProviderHealth();
  const now = useNow();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Provider health"
        description="Live train data comes from public websites (scraped first) and licensed APIs (last resort). This page shows which sources are active and whether each one is reachable."
        actions={
          <Button variant="outline" onClick={() => void health.refetch()} disabled={health.isFetching} data-testid="refresh-health">
            <RefreshCw aria-hidden className={cn(health.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {health.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : health.error ? (
        <TrainErrorState
          code={isApiError(health.error) ? health.error.code : null}
          message={health.error.message}
          onRetry={() => void health.refetch()}
          retrying={health.isFetching}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {health.data?.providers.map((p) => {
            const meta = HEALTH[p.status];
            const Icon = meta.icon;
            return (
              <li key={p.provider}>
                <Card data-testid="provider-card" data-provider={p.provider} className={cn('h-full', p.active && 'border-primary ring-1 ring-primary')}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {p.name}
                      {p.active && <Badge>Active</Badge>}
                      {p.isDemo && <DemoBadge />}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">{p.provider}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        data-testid="provider-status"
                        className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium', TONE_BADGE[meta.tone])}
                      >
                        <Icon aria-hidden className="size-3.5" /> {meta.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{p.configured ? 'Credentials configured' : 'No credentials configured'}</span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Latency</dt>
                        <dd className="font-mono tabular-nums">{p.latencyMs !== null ? `${Math.round(p.latencyMs)} ms` : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Checked</dt>
                        <dd>
                          <span className="font-mono tabular-nums">{ist(p.checkedAt, 'time')}</span> ({relativeTime(p.checkedAt, now)})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Max concurrent</dt>
                        <dd className="font-mono tabular-nums">{p.limits.maxConcurrent}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Min request gap</dt>
                        <dd className="font-mono tabular-nums">{p.limits.minIntervalMs} ms</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Live cache</dt>
                        <dd className="font-mono tabular-nums">{p.limits.liveCacheSeconds} s</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Route cache</dt>
                        <dd className="font-mono tabular-nums">{p.limits.routeCacheSeconds} s</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted-foreground">Minimum monitoring interval</dt>
                        <dd className="font-mono tabular-nums">{p.limits.minPollMinutes} min</dd>
                      </div>
                    </dl>
                    {p.message && <p className="rounded-md bg-muted px-3 py-2 text-xs">{p.message}</p>}
                    {p.docsUrl && (
                      <a
                        href={p.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Provider documentation <ExternalLink aria-hidden className="size-3" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <UsageSection />
    </div>
  );
}

function UsageSection() {
  const [hours, setHours] = useState(24);
  const location = useLocation();
  const { data: user, isLoading: meLoading } = useMe();
  const isAdmin = user?.role === 'ADMIN';
  const usage = useProviderUsage(hours, !!isAdmin);
  const forbidden = !!user && !isAdmin;
  const usageCode = isApiError(usage.error) ? usage.error.code : null;

  return (
    <Card data-testid="provider-usage">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge aria-hidden className="size-4" /> Provider usage
        </CardTitle>
        <CardDescription>Requests made to each provider — useful for staying within licensed quotas.</CardDescription>
        {isAdmin && (
          <div data-slot="card-action" className="col-start-2 row-span-2 row-start-1 self-start justify-self-end space-y-1">
            <Label htmlFor="usage-hours" className="sr-only">
              Time window
            </Label>
            <NativeSelect id="usage-hours" value={String(hours)} onChange={(e) => setHours(Number(e.target.value))} className="w-36">
              <option value="1">Last hour</option>
              <option value="6">Last 6 hours</option>
              <option value="24">Last 24 hours</option>
              <option value="72">Last 3 days</option>
              <option value="168">Last 7 days</option>
            </NativeSelect>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {meLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !user || usageCode === 'UNAUTHENTICATED' ? (
          <Alert tone="neutral" icon={Lock} title="Sign in to view usage" data-testid="usage-signin">
            <p>
              Provider usage is available to administrators.{' '}
              <Link
                to={`/login?next=${encodeURIComponent(location.pathname)}`}
                className="font-medium text-primary underline underline-offset-2"
              >
                Sign in
              </Link>
            </p>
          </Alert>
        ) : forbidden || usageCode === 'FORBIDDEN' ? (
          <Alert tone="neutral" icon={ShieldAlert} title="Admins only" data-testid="usage-forbidden">
            Your account doesn’t have administrator access, so provider usage isn’t shown.
          </Alert>
        ) : usage.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : usage.error ? (
          <TrainErrorState compact code={usageCode} message={usage.error.message} onRetry={() => void usage.refetch()} />
        ) : !usage.data?.items.length ? (
          <p className="text-sm text-muted-foreground">No provider requests in this window.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Provider</TableHead>
                <TableHead scope="col" className="text-right">Total</TableHead>
                <TableHead scope="col" className="text-right">Success</TableHead>
                <TableHead scope="col" className="text-right">Errors</TableHead>
                <TableHead scope="col" className="text-right">Rate limited</TableHead>
                <TableHead scope="col" className="text-right">Avg latency</TableHead>
                <TableHead scope="col">Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.data.items.map((u) => (
                <TableRow key={u.provider}>
                  <TableCell className="font-medium">{u.provider}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{u.total}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{u.success}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{u.errors}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{u.rateLimited}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{u.avgLatencyMs !== null ? `${Math.round(u.avgLatencyMs)} ms` : '—'}</TableCell>
                  <TableCell className="max-w-[18rem] text-xs">
                    {u.lastError ? (
                      <>
                        <span className="text-destructive">{u.lastError}</span>
                        {u.lastErrorAt && <span className="block text-muted-foreground">{ist(u.lastErrorAt)}</span>}
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
