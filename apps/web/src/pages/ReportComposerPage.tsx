import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  Download,
  Eye,
  Inbox,
  Link2,
  LoaderCircle,
  Mail,
  Send,
  TrainTrack,
} from 'lucide-react';
import {
  MAX_TRAINS_PER_REQUEST,
  REPORT_FIELDS,
  REPORT_FIELD_IDS,
  formatJourneyDate,
  resolveReportFields,
  type EmailReportResult,
  type ReportFieldId,
  type Tone,
} from '@railtrack/shared';
import { isApiError } from '@/api/client';
import { useConfig, useMe, useReportPreview, useReports, useSendReport } from '@/api/hooks';
import { EmailChipsInput } from '@/components/common/EmailChipsInput';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { RequireAuth } from '@/components/common/RequireAuth';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { DemoBadge } from '@/components/train/badges';
import { TrainErrorState } from '@/components/train/TrainErrorState';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { downloadCsv } from '@/lib/download';
import { TONE_BADGE } from '@/lib/tone';
import { ist } from '@/lib/time';
import { parseTrainRefs, trainKey, type TrainRef } from '@/lib/trainKey';
import { cn, plural } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard';

const STATUS_TONE: Record<EmailReportResult['status'], Tone> = {
  QUEUED: 'info',
  SENT: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
};

function EmailStatusBadge({ status }: { status: EmailReportResult['status'] | 'QUEUED' | 'SENT' | 'FAILED' }) {
  const Icon = status === 'SENT' ? CircleCheck : status === 'FAILED' ? CircleX : Clock;
  return (
    <span
      data-testid="email-status"
      className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium', TONE_BADGE[STATUS_TONE[status]])}
    >
      <Icon aria-hidden className="size-3.5" />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

export default function ReportComposerPage() {
  useDocumentTitle('Email report');
  return (
    <RequireAuth>
      <Composer />
    </RequireAuth>
  );
}

function Composer() {
  const [searchParams] = useSearchParams();
  const { data: config } = useConfig();
  const { data: user } = useMe();
  const results = useDashboardStore((s) => s.results);
  const selectedKeys = useDashboardStore((s) => s.selectedKeys);
  const uploadEmails = useDashboardStore((s) => s.uploadEmails);

  // Candidate trains: ?trains= param first, else dashboard selection, else the whole dashboard.
  const candidates: TrainRef[] = useMemo(() => {
    const fromParam = parseTrainRefs(searchParams.get('trains'));
    if (fromParam.length) return fromParam;
    const ok = results.filter((r) => r.status);
    const sel = ok.filter((r) => selectedKeys.includes(trainKey(r)));
    return (sel.length ? sel : ok).map((r) => ({ trainNumber: r.trainNumber, journeyDate: r.journeyDate }));
  }, [searchParams, results, selectedKeys]);

  const candidatesKey = candidates.map(trainKey).join(',');
  const [included, setIncluded] = useState<string[]>(() => candidates.slice(0, MAX_TRAINS_PER_REQUEST).map(trainKey));
  useEffect(() => {
    setIncluded(candidatesKey ? candidatesKey.split(',').slice(0, MAX_TRAINS_PER_REQUEST) : []);
  }, [candidatesKey]);

  const [recipients, setRecipients] = useState<string[]>(() => uploadEmails.slice(0, 20));
  const [fullReport, setFullReport] = useState(true);
  const [fields, setFields] = useState<ReportFieldId[]>([...REPORT_FIELD_IDS]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [includeShareLink, setIncludeShareLink] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const preview = useReportPreview();
  const send = useSendReport();
  const [sent, setSent] = useState<EmailReportResult | null>(null);

  const trains = candidates.filter((c) => included.includes(trainKey(c)));
  const nameOf = (ref: TrainRef) => results.find((r) => trainKey(r) === trainKey(ref))?.status;
  const emailEnabled = config?.features.email !== false;
  const shareEnabled = config?.features.shareLinks !== false;

  const body = () => ({
    trains,
    fields: fullReport ? undefined : resolveReportFields(fields),
    includeShareLink: shareEnabled && includeShareLink,
    subject: subject.trim() || undefined,
    message: message.trim() || undefined,
  });

  const validate = (needRecipients: boolean): boolean => {
    let problem: string | null = null;
    if (trains.length === 0) problem = 'Select at least one train.';
    else if (!fullReport && fields.length === 0) problem = 'Choose at least one field, or send the full report.';
    else if (needRecipients && recipients.length === 0) problem = 'Add at least one recipient.';
    setFormError(problem);
    return problem === null;
  };

  const onPreview = () => {
    if (!validate(false)) return;
    preview.mutate(body());
  };

  const onSend = (e: FormEvent) => {
    e.preventDefault();
    if (!validate(true)) return;
    send.mutate(
      { ...body(), recipients },
      {
        onSuccess: (result) => {
          setSent(result);
          const sentCount = result.recipients.filter((r) => r.status === 'SENT').length;
          if (result.status === 'FAILED') toast.error('Report could not be sent', { description: result.error ?? undefined });
          else if (result.status === 'PARTIAL') toast.warning(`Sent to ${sentCount} of ${result.recipients.length} recipients`);
          else
            toast.success(result.delivery === 'outbox' ? 'Report written to the dev outbox' : `Report sent to ${plural(result.recipients.length, 'recipient')}`);
        },
      },
    );
  };

  const sendError = send.error;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Email report"
        description="Send the status of selected trains to one or more people. Reports show the data source, freshness and demo labels."
      />

      {!emailEnabled && (
        <Alert tone="neutral" icon={Mail} title="Email is not configured on this server">
          You can still preview reports, but sending is disabled until an administrator configures email delivery.
        </Alert>
      )}

      {candidates.length === 0 ? (
        <EmptyState
          icon={TrainTrack}
          title="No trains to report on"
          description="Track some trains first, then choose “Email report” from the dashboard or a train page."
          action={
            <Button asChild>
              <Link to="/">Track trains</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <form onSubmit={onSend} noValidate className="space-y-6" aria-label="Compose report" data-testid="report-form">
            <Card>
              <CardHeader>
                <CardTitle>Trains</CardTitle>
                <CardDescription>
                  {plural(trains.length, 'train')} selected{candidates.length > MAX_TRAINS_PER_REQUEST ? ` (max ${MAX_TRAINS_PER_REQUEST})` : ''}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 sm:grid-cols-2" aria-label="Trains to include">
                  {candidates.map((ref) => {
                    const key = trainKey(ref);
                    const s = nameOf(ref);
                    const id = `train-${key}`;
                    const checked = included.includes(key);
                    return (
                      <li key={key} className="flex items-start gap-2 rounded-md border p-2">
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={!checked && included.length >= MAX_TRAINS_PER_REQUEST}
                          onCheckedChange={(v) => setIncluded((cur) => (v === true ? [...cur, key] : cur.filter((k) => k !== key)))}
                          data-testid="report-train"
                        />
                        <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
                          <span>
                            <span className="font-mono font-semibold">{ref.trainNumber}</span> {s?.trainName ?? ''}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatJourneyDate(ref.journeyDate)} {s?.provider.isDemo && <DemoBadge className="ml-1" />}
                          </span>
                        </Label>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recipients</CardTitle>
                {uploadEmails.length > 0 && <CardDescription>Prefilled from the email column of your upload.</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-3">
                <EmailChipsInput value={recipients} onChange={setRecipients} max={20} />
                {user && !recipients.includes(user.email.toLowerCase()) && (
                  <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setRecipients((r) => [...r, user.email.toLowerCase()])}>
                    Add myself ({user.email})
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
                  <Checkbox
                    id="full-report"
                    checked={fullReport}
                    onCheckedChange={(v) => {
                      setFullReport(v === true);
                      if (v === true) setFields([...REPORT_FIELD_IDS]);
                    }}
                    data-testid="full-report"
                  />
                  <Label htmlFor="full-report" className="flex flex-col items-start gap-0.5">
                    Send full report
                    <span className="text-xs font-normal text-muted-foreground">All fields below. Untick to choose specific fields.</span>
                  </Label>
                </div>
                <fieldset disabled={fullReport} className="grid gap-2 sm:grid-cols-2" aria-describedby="fields-help">
                  <legend className="sr-only">Report fields</legend>
                  {REPORT_FIELDS.map((f) => {
                    const id = `field-${f.id}`;
                    return (
                      <div key={f.id} className={cn('flex items-start gap-2', fullReport && 'opacity-70')}>
                        <Checkbox
                          id={id}
                          checked={fullReport || fields.includes(f.id)}
                          disabled={fullReport}
                          data-testid={`field-${f.id}`}
                          onCheckedChange={(v) => setFields((cur) => (v === true ? [...cur, f.id] : cur.filter((x) => x !== f.id)))}
                        />
                        <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
                          <span className="font-medium">{f.label}</span>
                          <span className="text-xs text-muted-foreground">{f.description}</span>
                        </Label>
                      </div>
                    );
                  })}
                </fieldset>
                <p id="fields-help" className="text-xs text-muted-foreground">
                  The train number is always included.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="report-subject">Subject (optional)</Label>
                  <Input
                    id="report-subject"
                    maxLength={150}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Train status report"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="report-message">Message (optional)</Label>
                  <Textarea
                    id="report-message"
                    maxLength={1000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    placeholder="Add a note for the recipients"
                  />
                  <p className="text-right text-xs text-muted-foreground">{message.length}/1000</p>
                </div>

                <div className="flex items-start gap-3 rounded-md border p-3">
                  <Switch
                    id="share-link"
                    checked={includeShareLink}
                    onCheckedChange={setIncludeShareLink}
                    disabled={!shareEnabled}
                    data-testid="share-link-switch"
                    aria-describedby="share-link-help"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="share-link">Include a public share link</Label>
                    <p id="share-link-help" className="text-xs text-muted-foreground">
                      {shareEnabled
                        ? 'Off by default. Creates a read-only web link to a snapshot of this report. Anyone with the link can view it until it expires — it never allows changes.'
                        : 'Share links are disabled on this server.'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div aria-live="polite" className="space-y-3 empty:hidden">
              {formError && (
                <p role="alert" className="text-sm font-medium text-destructive" data-testid="report-form-error">
                  {formError}
                </p>
              )}
              {sendError && (
                <TrainErrorState
                  compact
                  code={isApiError(sendError) ? sendError.code : null}
                  message={sendError.message}
                  retryAfterSeconds={isApiError(sendError) ? sendError.retryAfterSeconds : null}
                />
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={onPreview} disabled={preview.isPending} data-testid="preview-report">
                {preview.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Eye aria-hidden />}
                Preview
              </Button>
              <Button type="submit" disabled={send.isPending || !emailEnabled} data-testid="send-report">
                {send.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Send aria-hidden />}
                {send.isPending ? 'Sending…' : `Send to ${plural(recipients.length, 'recipient')}`}
              </Button>
            </div>
          </form>

          <div className="space-y-6">
            {sent && <SendResult result={sent} />}
            <PreviewPanel preview={preview} />
          </div>
        </div>
      )}

      <EmailHistory />
    </div>
  );
}

function SendResult({ result }: { result: EmailReportResult }) {
  const copy = async () => {
    if (!result.shareUrl) return;
    try {
      await navigator.clipboard.writeText(result.shareUrl);
      toast.success('Share link copied');
    } catch {
      toast.error('Could not copy — select the link and copy it manually');
    }
  };
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card data-testid="send-result" className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {result.status === 'FAILED' ? 'Report not sent' : 'Report sent'} <EmailStatusBadge status={result.status} />
          </CardTitle>
          <CardDescription>
            {result.subject} · {ist(result.createdAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {result.delivery === 'outbox' && (
            <Alert tone="info" icon={Inbox} title="Development mode: written to the local outbox" data-testid="outbox-notice">
              SMTP isn’t configured on this server, so the email was saved to the server’s local mail outbox instead of being delivered.
            </Alert>
          )}
          {result.error && <p className="text-destructive">{result.error}</p>}
          <div>
            <p className="mb-1 font-medium">Recipients</p>
            <ul className="space-y-1">
              {result.recipients.map((r) => (
                <li key={r.email} className="flex flex-wrap items-center gap-2">
                  <EmailStatusBadge status={r.status} />
                  <span className="break-all">{r.email}</span>
                  {r.error && <span className="text-xs text-destructive">{r.error}</span>}
                </li>
              ))}
            </ul>
          </div>
          {result.shareUrl && (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 font-medium">
                <Link2 aria-hidden className="size-4" /> Read-only share link
              </p>
              <div className="flex gap-2">
                <Input readOnly value={result.shareUrl} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="outline" size="icon" onClick={() => void copy()} aria-label="Copy share link">
                  <Copy aria-hidden />
                </Button>
              </div>
              {result.shareExpiresAt && <p className="text-xs text-muted-foreground">Expires {ist(result.shareExpiresAt)}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function PreviewPanel({ preview }: { preview: ReturnType<typeof useReportPreview> }) {
  if (preview.isPending) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (preview.error) {
    return (
      <TrainErrorState
        compact
        code={isApiError(preview.error) ? preview.error.code : null}
        message={preview.error.message}
        retryAfterSeconds={isApiError(preview.error) ? preview.error.retryAfterSeconds : null}
      />
    );
  }
  if (!preview.data) {
    return (
      <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        <Eye aria-hidden className="size-6" />
        Choose “Preview” to see the email and CSV attachment before sending.
      </div>
    );
  }
  const data = preview.data;
  return (
    <Card data-testid="report-preview">
      <CardHeader>
        <CardTitle>Preview</CardTitle>
        <CardDescription>
          Subject: <span className="font-medium text-foreground">{data.subject}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={data.html}
          className="h-[480px] w-full rounded-md border bg-white"
          data-testid="preview-iframe"
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">CSV attachment · {data.csvFileName}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => downloadCsv(data.csvFileName, data.csv)}>
              <Download aria-hidden /> Download
            </Button>
          </div>
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed">{data.csv}</pre>
        </div>
      </CardContent>
    </Card>
  );
}

function EmailHistory() {
  const [kind, setKind] = useState<'' | 'REPORT' | 'ALERT'>('');
  const reports = useReports(kind || undefined);
  const fieldLabel = (fields: readonly ReportFieldId[]) =>
    fields.length === 0 || fields.length === REPORT_FIELD_IDS.length ? 'Full report' : plural(fields.length, 'field');
  return (
    <Card data-testid="email-history">
      <CardHeader>
        <CardTitle>Email history</CardTitle>
        <CardDescription>Reports and monitoring alerts sent from your account.</CardDescription>
        <div data-slot="card-action" className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Label htmlFor="history-kind" className="sr-only">
            Kind
          </Label>
          <NativeSelect id="history-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-36">
            <option value="">All</option>
            <option value="REPORT">Reports</option>
            <option value="ALERT">Alerts</option>
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent>
        {reports.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : reports.error ? (
          <TrainErrorState
            compact
            code={isApiError(reports.error) ? reports.error.code : null}
            message={reports.error.message}
            onRetry={() => void reports.refetch()}
          />
        ) : !reports.data?.items.length ? (
          <p className="text-sm text-muted-foreground">No emails sent yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Sent (IST)</TableHead>
                <TableHead scope="col">Kind</TableHead>
                <TableHead scope="col">Recipients</TableHead>
                <TableHead scope="col">Fields</TableHead>
                <TableHead scope="col">Trains</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">{ist(r.createdAt)}</TableCell>
                  <TableCell>{r.kind === 'ALERT' ? 'Alert' : 'Report'}</TableCell>
                  <TableCell>
                    <span title={r.recipients.map((x) => x.email).join(', ')}>{plural(r.recipients.length, 'recipient')}</span>
                    {r.delivery === 'outbox' && <span className="block text-xs text-muted-foreground">dev outbox</span>}
                  </TableCell>
                  <TableCell>{fieldLabel(r.fields)}</TableCell>
                  <TableCell className="max-w-[14rem]">
                    <span className="font-mono text-xs">{r.trains.map((t) => t.trainNumber).join(', ')}</span>
                  </TableCell>
                  <TableCell>
                    <EmailStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="max-w-[14rem] text-xs text-destructive">{r.error ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
