import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Activity, BellRing, CirclePause, CirclePlay, CircleStop, LoaderCircle, Pencil, ServerCog } from 'lucide-react';
import {
  JOURNEY_DATE_MAX_FUTURE_DAYS,
  JOURNEY_DATE_MAX_PAST_DAYS,
  MONITORING_DEFAULT_INTERVAL_MINUTES,
  MONITORING_MAX_INTERVAL_MINUTES,
  MONITORING_MIN_INTERVAL_MINUTES,
  MonitoringCreateSchema,
  MonitoringPatchSchema,
  addDaysToDate,
  formatDelay,
  formatJourneyDate,
  isValidIsoDate,
  isValidTrainNumber,
  relativeTime,
  todayInIst,
  type AlertRules,
  type MonitoringSubscription,
  type Tone,
} from '@railtrack/shared';
import { errorMessage, isApiError } from '@/api/client';
import {
  useConfig,
  useCreateMonitoring,
  useMe,
  useMonitoring,
  usePatchMonitoring,
  useProviderHealth,
  useStopMonitoring,
} from '@/api/hooks';
import { EmailChipsInput } from '@/components/common/EmailChipsInput';
import { PageHeader } from '@/components/common/PageHeader';
import { RequireAuth } from '@/components/common/RequireAuth';
import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { DemoBadge, StatusBadge } from '@/components/train/badges';
import { errorMeta } from '@/components/train/errorMeta';
import { TrainErrorState } from '@/components/train/TrainErrorState';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNow } from '@/hooks/useNow';
import { TONE_BADGE } from '@/lib/tone';
import { ist } from '@/lib/time';
import { trainDetailPath } from '@/lib/trainKey';
import { cn, plural } from '@/lib/utils';

const BASE_INTERVALS = [10, 15, 20, 30, 60];

export function intervalOptions(min: number, max: number): number[] {
  const opts = BASE_INTERVALS.filter((n) => n >= min && n <= max);
  if (opts.length === 0 || opts[0]! > min) opts.unshift(min);
  return [...new Set(opts)].sort((a, b) => a - b);
}

interface RulesDraft {
  nextStation: boolean;
  delayEnabled: boolean;
  delayAbove: string;
  exceptions: boolean;
  arrival: boolean;
}

const rulesToDraft = (r: AlertRules): RulesDraft => ({
  nextStation: r.nextStation,
  delayEnabled: r.delayAboveMinutes !== null,
  delayAbove: String(r.delayAboveMinutes ?? 30),
  exceptions: r.exceptions,
  arrival: r.arrival,
});

const draftToRules = (d: RulesDraft): AlertRules => ({
  nextStation: d.nextStation,
  delayAboveMinutes: d.delayEnabled ? Number.parseInt(d.delayAbove, 10) || 0 : null,
  exceptions: d.exceptions,
  arrival: d.arrival,
});

const DEFAULT_RULES: RulesDraft = { nextStation: false, delayEnabled: false, delayAbove: '30', exceptions: true, arrival: true };

function firstIssue(error: { issues: { message: string; path: PropertyKey[] }[] }): string {
  const issue = error.issues[0];
  if (!issue) return 'Please check the form.';
  const field = issue.path.map(String).join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}

/** Interval bounds: server config + the active provider's minimum polling interval. */
function useIntervalBounds() {
  const { data: config } = useConfig();
  const { data: health } = useProviderHealth();
  const active = health?.providers.find((p) => p.provider === health.activeProvider);
  const providerMin = active?.limits.minPollMinutes ?? 0;
  const min = Math.max(config?.limits.monitoring.minIntervalMinutes ?? MONITORING_MIN_INTERVAL_MINUTES, providerMin);
  const max = config?.limits.monitoring.maxIntervalMinutes ?? MONITORING_MAX_INTERVAL_MINUTES;
  const options = intervalOptions(min, Math.max(min, max));
  const preferred = config?.limits.monitoring.defaultIntervalMinutes ?? MONITORING_DEFAULT_INTERVAL_MINUTES;
  const fallback = options.includes(preferred) ? preferred : options[0]!;
  return { options, fallback, providerMin, providerName: active?.name ?? null, min };
}

function RulesEditor({ value, onChange, idPrefix }: { value: RulesDraft; onChange: (v: RulesDraft) => void; idPrefix: string }) {
  const set = (patch: Partial<RulesDraft>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Alert me when…</legend>
      <div className="flex items-center gap-2">
        <Checkbox id={`${idPrefix}-next`} checked={value.nextStation} onCheckedChange={(v) => set({ nextStation: v === true })} />
        <Label htmlFor={`${idPrefix}-next`} className="font-normal">
          The train reaches its next station
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox id={`${idPrefix}-delay`} checked={value.delayEnabled} onCheckedChange={(v) => set({ delayEnabled: v === true })} />
        <Label htmlFor={`${idPrefix}-delay`} className="font-normal">
          Delay rises above
        </Label>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={1440}
          aria-label="Delay threshold in minutes"
          className="h-8 w-20"
          value={value.delayAbove}
          disabled={!value.delayEnabled}
          onChange={(e) => set({ delayAbove: e.target.value })}
        />
        <span className="text-sm text-muted-foreground">minutes</span>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id={`${idPrefix}-exc`} checked={value.exceptions} onCheckedChange={(v) => set({ exceptions: v === true })} />
        <Label htmlFor={`${idPrefix}-exc`} className="font-normal">
          It is diverted, cancelled or rescheduled
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id={`${idPrefix}-arr`} checked={value.arrival} onCheckedChange={(v) => set({ arrival: v === true })} />
        <Label htmlFor={`${idPrefix}-arr`} className="font-normal">
          It arrives at its destination
        </Label>
      </div>
    </fieldset>
  );
}

export default function MonitoringPage() {
  useDocumentTitle('Monitoring');
  return (
    <RequireAuth>
      <Monitoring />
    </RequireAuth>
  );
}

function Monitoring() {
  const { data: config } = useConfig();
  const unavailable = config?.features.monitoring === false;
  const list = useMonitoring(!unavailable);
  const listUnavailable = isApiError(list.error) && list.error.code === 'MONITORING_UNAVAILABLE';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring"
        description="Get emailed when a train reaches a station, runs late, or is diverted/cancelled."
      />

      <Alert tone="info" icon={ServerCog} title="Checks run on our servers on a schedule">
        Once a train is monitored, RailTrack Live checks it at the interval you choose and emails the recipients when an alert rule
        matches. It is safe to close this page. Intervals respect the data provider’s rate limits.
      </Alert>

      {(unavailable || listUnavailable) && (
        <Alert tone="warning" icon={Activity} title="Monitoring is unavailable on this server" data-testid="monitoring-unavailable">
          The scheduler (Redis) isn’t configured, so new monitors can’t be created right now.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <CreateMonitorCard disabled={unavailable || listUnavailable} />
        <section aria-labelledby="subs-heading" className="space-y-3">
          <h2 id="subs-heading" className="text-base font-semibold">
            Your monitored trains
          </h2>
          {list.isLoading ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : list.error && !listUnavailable ? (
            <TrainErrorState
              compact
              code={isApiError(list.error) ? list.error.code : null}
              message={list.error.message}
              onRetry={() => void list.refetch()}
              retrying={list.isFetching}
            />
          ) : !list.data?.items.length ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No monitored trains yet. Create one with the form.
            </p>
          ) : (
            <ul className="space-y-3">
              <AnimatePresence initial={false}>
                {list.data.items.map((sub) => (
                  <motion.li key={sub.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <SubscriptionCard sub={sub} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function CreateMonitorCard({ disabled }: { disabled: boolean }) {
  const [params] = useSearchParams();
  const { data: user } = useMe();
  const today = todayInIst();
  const bounds = useIntervalBounds();
  const create = useCreateMonitoring();
  const uid = useId();

  const paramTrain = params.get('train') ?? '';
  const paramDate = params.get('date');
  const [trainNumber, setTrainNumber] = useState(isValidTrainNumber(paramTrain) ? paramTrain : '');
  const [journeyDate, setJourneyDate] = useState(paramDate && isValidIsoDate(paramDate) ? paramDate : today);
  const [interval, setIntervalChoice] = useState<number | null>(null);
  const [rules, setRules] = useState<RulesDraft>(DEFAULT_RULES);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (user && recipients.length === 0) setRecipients([user.email.toLowerCase()]);
    // only prefill once the user is known
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const effectiveInterval = interval !== null && bounds.options.includes(interval) ? interval : bounds.fallback;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      trainNumber: trainNumber.trim(),
      journeyDate,
      intervalMinutes: effectiveInterval,
      rules: draftToRules(rules),
      recipients,
    };
    const parsed = MonitoringCreateSchema.safeParse(body);
    if (!parsed.success) {
      setFormError(firstIssue(parsed.error));
      return;
    }
    setFormError(null);
    create.mutate(body, {
      onSuccess: (sub) => {
        toast.success(`Monitoring train ${sub.trainNumber}`, { description: `Checks every ${sub.intervalMinutes} min` });
        setTrainNumber('');
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing aria-hidden className="size-4" /> Monitor a train
        </CardTitle>
        <CardDescription>Alerts are emailed to the recipients below.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-5" data-testid="monitoring-form" aria-label="Create a monitor">
          <fieldset disabled={disabled || create.isPending} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${uid}-train`}>Train number</Label>
                <Input
                  id={`${uid}-train`}
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="12082"
                  className="font-mono"
                  value={trainNumber}
                  onChange={(e) => setTrainNumber(e.target.value.replace(/\D/g, ''))}
                  aria-invalid={(trainNumber.length > 0 && !isValidTrainNumber(trainNumber)) || undefined}
                  data-testid="monitor-train-number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${uid}-date`}>Journey date</Label>
                <Input
                  id={`${uid}-date`}
                  type="date"
                  value={journeyDate}
                  min={addDaysToDate(today, -JOURNEY_DATE_MAX_PAST_DAYS)}
                  max={addDaysToDate(today, JOURNEY_DATE_MAX_FUTURE_DAYS)}
                  onChange={(e) => setJourneyDate(e.target.value || today)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-interval`}>Check every</Label>
              <NativeSelect
                id={`${uid}-interval`}
                className="w-40"
                value={String(effectiveInterval)}
                onChange={(e) => setIntervalChoice(Number(e.target.value))}
                aria-describedby={`${uid}-interval-help`}
                data-testid="monitor-interval"
              >
                {bounds.options.map((n) => (
                  <option key={n} value={n}>
                    {n} minutes
                  </option>
                ))}
              </NativeSelect>
              <p id={`${uid}-interval-help`} className="text-xs text-muted-foreground">
                Minimum {bounds.min} min
                {bounds.providerName && bounds.providerMin > 0 ? ` (${bounds.providerName} allows polling every ${bounds.providerMin} min at most)` : ''}.
              </p>
            </div>
            <RulesEditor value={rules} onChange={setRules} idPrefix={`${uid}-rules`} />
            <EmailChipsInput value={recipients} onChange={setRecipients} max={10} label="Alert recipients" testId="monitor-recipients" />
          </fieldset>

          <div aria-live="polite" className="space-y-2 empty:hidden">
            {formError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {formError}
              </p>
            )}
            {create.error && (
              <TrainErrorState
                compact
                code={isApiError(create.error) ? create.error.code : null}
                message={create.error.message}
                retryAfterSeconds={isApiError(create.error) ? create.error.retryAfterSeconds : null}
              />
            )}
          </div>

          <Button type="submit" disabled={disabled || create.isPending} data-testid="monitor-submit">
            {create.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <BellRing aria-hidden />}
            Start monitoring
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const SUB_STATUS: Record<MonitoringSubscription['status'], { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  STOPPED: { label: 'Stopped', tone: 'neutral' },
  COMPLETED: { label: 'Completed', tone: 'info' },
  ERROR: { label: 'Error', tone: 'danger' },
};

function rulesSummary(r: AlertRules): string {
  const parts: string[] = [];
  if (r.nextStation) parts.push('next station');
  if (r.delayAboveMinutes !== null) parts.push(`delay > ${r.delayAboveMinutes} min`);
  if (r.exceptions) parts.push('diversion/cancellation/reschedule');
  if (r.arrival) parts.push('arrival');
  return parts.join(' · ') || 'none';
}

function SubscriptionCard({ sub }: { sub: MonitoringSubscription }) {
  const now = useNow();
  const patch = usePatchMonitoring();
  const stop = useStopMonitoring();
  const [editing, setEditing] = useState(false);
  const meta = SUB_STATUS[sub.status];
  const finished = sub.status === 'STOPPED' || sub.status === 'COMPLETED';
  const onError = (e: unknown) =>
    toast.error(isApiError(e) ? errorMeta(e.code).title : 'Action failed', { description: errorMessage(e) });

  return (
    <article data-testid="monitoring-item" data-status={sub.status} className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-baseline gap-x-2">
            <Link to={trainDetailPath(sub)} className="font-mono text-base font-semibold text-primary hover:underline">
              {sub.trainNumber}
            </Link>
            <span className="font-medium">{sub.trainName ?? ''}</span>
          </h3>
          <p className="text-xs text-muted-foreground">Journey {formatJourneyDate(sub.journeyDate)}</p>
        </div>
        <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', TONE_BADGE[meta.tone])}>
          {meta.label}
        </span>
      </header>

      <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Interval</dt>
          <dd>Every {sub.intervalMinutes} min</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Alerts sent</dt>
          <dd>
            {sub.alertCount}
            {sub.lastAlertAt ? ` · last ${ist(sub.lastAlertAt)}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last check</dt>
          <dd>{sub.lastCheckedAt ? `${ist(sub.lastCheckedAt)} (${relativeTime(sub.lastCheckedAt, now)})` : 'Not yet'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Next check</dt>
          <dd>{sub.nextCheckAt && !finished ? `${ist(sub.nextCheckAt)} (${relativeTime(sub.nextCheckAt, now)})` : '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Last known state</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {sub.lastKnown ? (
              <>
                <StatusBadge state={sub.lastKnown.state} />
                <span className="font-mono">{formatDelay(sub.lastKnown.delayMinutes)}</span>
                <span className="font-mono text-muted-foreground">
                  {sub.lastKnown.lastStationCode ?? '—'} → {sub.lastKnown.nextStationCode ?? '—'}
                </span>
                {sub.lastKnown.isDemo && <DemoBadge />}
              </>
            ) : (
              'Not checked yet'
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Rules</dt>
          <dd>{rulesSummary(sub.rules)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Recipients</dt>
          <dd className="break-all">{sub.recipients.join(', ')}</dd>
        </div>
        {sub.lastError && (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Last error</dt>
            <dd className="font-medium text-destructive">{sub.lastError}</dd>
          </div>
        )}
      </dl>

      {!finished && (
        <div className="flex flex-wrap gap-2">
          {sub.status === 'ACTIVE' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={patch.isPending}
              onClick={() => patch.mutate({ id: sub.id, patch: { action: 'pause' } }, { onError, onSuccess: () => toast.success('Paused') })}
            >
              <CirclePause aria-hidden /> Pause
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={patch.isPending}
              onClick={() => patch.mutate({ id: sub.id, patch: { action: 'resume' } }, { onError, onSuccess: () => toast.success('Resumed') })}
            >
              <CirclePlay aria-hidden /> Resume
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                <CircleStop aria-hidden /> Stop
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop monitoring train {sub.trainNumber}?</AlertDialogTitle>
                <AlertDialogDescription>
                  No more checks will run and no more alerts will be sent. This can’t be undone — create a new monitor to start again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep monitoring</AlertDialogCancel>
                <AlertDialogAction onClick={() => stop.mutate(sub.id, { onError, onSuccess: () => toast.success('Monitoring stopped') })}>
                  Stop monitoring
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <EditDialog sub={sub} open={editing} onOpenChange={setEditing} />
    </article>
  );
}

function EditDialog({ sub, open, onOpenChange }: { sub: MonitoringSubscription; open: boolean; onOpenChange: (o: boolean) => void }) {
  const bounds = useIntervalBounds();
  const patch = usePatchMonitoring();
  const uid = useId();
  const [interval, setIntervalChoice] = useState(sub.intervalMinutes);
  const [rules, setRules] = useState<RulesDraft>(() => rulesToDraft(sub.rules));
  const [recipients, setRecipients] = useState<string[]>(sub.recipients);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIntervalChoice(sub.intervalMinutes);
    setRules(rulesToDraft(sub.rules));
    setRecipients(sub.recipients);
    setFormError(null);
  }, [open, sub]);

  const options = useMemo(
    () => (bounds.options.includes(sub.intervalMinutes) ? bounds.options : [...bounds.options, sub.intervalMinutes].sort((a, b) => a - b)),
    [bounds.options, sub.intervalMinutes],
  );

  const save = (e: FormEvent) => {
    e.preventDefault();
    const body = { intervalMinutes: interval, rules: draftToRules(rules), recipients };
    const parsed = MonitoringPatchSchema.safeParse(body);
    if (!parsed.success) {
      setFormError(firstIssue(parsed.error));
      return;
    }
    patch.mutate(
      { id: sub.id, patch: body },
      {
        onSuccess: () => {
          toast.success('Monitor updated');
          onOpenChange(false);
        },
        onError: (err) => setFormError(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit monitor · {sub.trainNumber}</DialogTitle>
          <DialogDescription>Changes apply from the next scheduled check.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={`${uid}-interval`}>Check every</Label>
            <NativeSelect id={`${uid}-interval`} className="w-40" value={String(interval)} onChange={(e) => setIntervalChoice(Number(e.target.value))}>
              {options.map((n) => (
                <option key={n} value={n}>
                  {n} minutes
                </option>
              ))}
            </NativeSelect>
          </div>
          <RulesEditor value={rules} onChange={setRules} idPrefix={`${uid}-rules`} />
          <EmailChipsInput value={recipients} onChange={setRecipients} max={10} label="Alert recipients" testId="edit-recipients" />
          {formError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={patch.isPending}>
              {patch.isPending && <LoaderCircle aria-hidden className="animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
        <p className="text-xs text-muted-foreground">{plural(sub.alertCount, 'alert')} sent so far.</p>
      </DialogContent>
    </Dialog>
  );
}
