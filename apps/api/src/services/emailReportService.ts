import {
  resolveReportFields,
  type EmailReportResult,
  type NormalizedTrainStatus,
  type ReportFieldId,
  type ReportPreview,
  type ReportTrainRef,
  type SharedReport,
} from '@railtrack/shared';
import type { AppConfig } from '../config/env.ts';
import { AppError } from '../lib/errors.ts';
import { hmacSha256, randomToken } from '../lib/crypto.ts';
import type { Logger } from '../lib/logger.ts';
import { requireDb, type Db } from '../lib/prisma.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import type { AuditService } from './auditService.ts';
import type { Mailer } from './mailer.ts';
import { buildReport } from './reportBuilder.ts';
import type { TrackingService } from './trackingService.ts';

export interface ReportOptions {
  trains: ReportTrainRef[];
  fields?: ReportFieldId[];
  subject?: string;
  message?: string;
  includeShareLink: boolean;
}

/**
 * Remove everything the sender did not select before the snapshot is exposed through a public link.
 * Identity, source/destination and provider labels are always kept so shared data stays attributable.
 */
export function redactStatus(status: NormalizedTrainStatus, fields: readonly ReportFieldId[]): NormalizedTrainStatus {
  const f = new Set(fields);
  const s: NormalizedTrainStatus = structuredClone(status);
  if (!f.has('currentLocation')) {
    Object.assign(s, {
      lastReportedStation: null,
      lastReportedEvent: null,
      lastReportedAt: null,
      previousStation: null,
      position: null,
      distanceTravelledKm: null,
      distanceRemainingKm: null,
      progressPercent: null,
    });
  }
  if (!f.has('nextStation')) Object.assign(s, { nextStation: null, nextStationEta: null });
  if (!f.has('schedule')) Object.assign(s, { scheduledDeparture: null, scheduledArrival: null });
  if (!f.has('actualTimings')) Object.assign(s, { actualDeparture: null, actualArrival: null, expectedArrival: null });
  if (!f.has('delays')) s.delayMinutes = null;
  if (!f.has('platform')) s.platform = null;
  if (!f.has('exceptions')) s.exceptions = [];
  if (!f.has('route') && !f.has('mapLink')) s.stops = [];
  s.stops = s.stops.map((stop) => ({
    ...stop,
    ...(f.has('schedule') ? {} : { scheduledArrival: null, scheduledDeparture: null }),
    ...(f.has('actualTimings') ? {} : { actualArrival: null, actualDeparture: null, expectedArrival: null, expectedDeparture: null }),
    ...(f.has('delays') ? {} : { arrivalDelayMinutes: null, departureDelayMinutes: null }),
    ...(f.has('platform') ? {} : { platform: null }),
    ...(f.has('currentLocation') ? {} : { status: 'upcoming' as const }),
  }));
  return s;
}

type ReportRow = Prisma.EmailReportGetPayload<{ include: { recipients: true } }>;

export class EmailReportService {
  constructor(
    private readonly deps: {
      db: Db | null;
      tracking: TrackingService;
      mailer: Mailer;
      config: AppConfig;
      logger: Logger;
      audit: AuditService;
    },
  ) {}

  private async collect(trains: ReportTrainRef[]) {
    const results = await this.deps.tracking.fetchMany(trains);
    return {
      statuses: results.filter((r) => r.ok && r.status).map((r) => r.status!),
      failures: results.filter((r) => !r.ok),
    };
  }

  async preview(options: ReportOptions): Promise<ReportPreview> {
    const { statuses, failures } = await this.collect(options.trains);
    const built = buildReport({
      statuses,
      failures,
      fields: options.fields,
      appBaseUrl: this.deps.config.APP_BASE_URL,
      shareUrl: options.includeShareLink ? `${this.deps.config.APP_BASE_URL}/shared/preview-link` : null,
      subject: options.subject,
      message: options.message,
    });
    return { subject: built.subject, html: built.html, csv: built.csv, csvFileName: built.csvFileName };
  }

  async send(userId: string, recipients: string[], options: ReportOptions, ip: string | null): Promise<EmailReportResult> {
    const db = requireDb(this.deps.db);
    if (this.deps.mailer.mode === 'disabled') throw new AppError('EMAIL_NOT_CONFIGURED', 'Email delivery is not configured on this server.');
    const uniqueRecipients = [...new Set(recipients.map((r) => r.toLowerCase()))];
    const fields = resolveReportFields(options.fields);

    const { statuses, failures } = await this.collect(options.trains);
    if (statuses.length === 0) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'None of the selected trains has data available right now, so no report was sent.');
    }

    let shareToken: string | null = null;
    let shareExpiresAt: Date | null = null;
    if (options.includeShareLink) {
      if (!this.deps.config.REPORT_LINK_SECRET && this.deps.config.isProduction) {
        throw new AppError('VALIDATION_ERROR', 'Share links are disabled because REPORT_LINK_SECRET is not set.');
      }
      shareToken = randomToken(32);
      shareExpiresAt = new Date(Date.now() + this.deps.config.SHARE_LINK_TTL_DAYS * 86_400_000);
    }
    const shareUrl = shareToken ? `${this.deps.config.APP_BASE_URL.replace(/\/+$/, '')}/shared/${shareToken}` : null;

    const built = buildReport({
      statuses,
      failures,
      fields,
      appBaseUrl: this.deps.config.APP_BASE_URL,
      shareUrl,
      subject: options.subject,
      message: options.message,
    });

    const report = await db.emailReport.create({
      data: {
        userId,
        kind: 'REPORT',
        subject: built.subject,
        fields,
        trains: options.trains as unknown as Prisma.InputJsonValue,
        status: 'QUEUED',
        delivery: this.deps.mailer.mode === 'outbox' ? 'outbox' : 'smtp',
        shareTokenHash: shareToken ? hmacSha256(this.deps.config.reportLinkSecret, shareToken) : null,
        shareExpiresAt,
        sharedSnapshot: shareToken ? (statuses.map((s) => redactStatus(s, fields)) as unknown as Prisma.InputJsonValue) : undefined,
        recipients: { create: uniqueRecipients.map((email) => ({ email })) },
      },
      include: { recipients: true },
    });

    const outcomes = await this.deliver(report.recipients, {
      subject: built.subject,
      html: built.html,
      text: built.text,
      attachments: [{ filename: built.csvFileName, content: built.csv, contentType: 'text/csv; charset=utf-8' }],
    });
    const final = await this.finish(db, report.id, outcomes);

    await this.deps.audit.record({
      userId,
      action: 'report.email',
      entityType: 'EmailReport',
      entityId: report.id,
      metadata: {
        recipientCount: uniqueRecipients.length,
        sent: outcomes.filter((o) => o.ok).length,
        trains: options.trains.length,
        fields,
        shareLink: Boolean(shareToken),
        delivery: this.deps.mailer.mode,
      },
      ip,
    });
    return toResult(final, shareUrl);
  }

  /** Send one alert email per recipient and keep an audit record (used by monitoring). */
  async sendAlert(input: {
    userId: string;
    subscriptionId: string;
    recipients: string[];
    status: NormalizedTrainStatus;
    alertLines: string[];
  }): Promise<'SENT' | 'PARTIAL' | 'FAILED'> {
    const db = requireDb(this.deps.db);
    const fields = resolveReportFields();
    const built = buildReport({
      statuses: [input.status],
      failures: [],
      fields,
      appBaseUrl: this.deps.config.APP_BASE_URL,
      alertLines: input.alertLines,
      subject: `${input.status.provider.isDemo ? '[DEMO] ' : ''}Alert: ${input.status.trainNumber} ${input.alertLines[0] ?? 'update'}`,
    });
    const report = await db.emailReport.create({
      data: {
        userId: input.userId,
        kind: 'ALERT',
        monitoringSubscriptionId: input.subscriptionId,
        subject: built.subject,
        fields,
        trains: [{ trainNumber: input.status.trainNumber, journeyDate: input.status.journeyDate }],
        status: 'QUEUED',
        delivery: this.deps.mailer.mode === 'outbox' ? 'outbox' : 'smtp',
        recipients: { create: [...new Set(input.recipients)].map((email) => ({ email })) },
      },
      include: { recipients: true },
    });
    const outcomes = await this.deliver(report.recipients, {
      subject: built.subject,
      html: built.html,
      text: built.text,
      attachments: [{ filename: built.csvFileName, content: built.csv, contentType: 'text/csv; charset=utf-8' }],
    });
    const final = await this.finish(db, report.id, outcomes);
    return final.status as 'SENT' | 'PARTIAL' | 'FAILED';
  }

  private async deliver(
    recipients: { id: string; email: string }[],
    message: { subject: string; html: string; text: string; attachments: { filename: string; content: string; contentType: string }[] },
  ) {
    const outcomes: { id: string; ok: boolean; messageId: string | null; error: string | null }[] = [];
    // One message per recipient so addresses are never disclosed to each other.
    for (const r of recipients) {
      try {
        const { messageId } = await this.deps.mailer.send({ to: r.email, ...message });
        outcomes.push({ id: r.id, ok: true, messageId, error: null });
      } catch (err) {
        const error = err instanceof AppError ? err.message : 'The mail server rejected or failed to deliver this message';
        this.deps.logger.warn({ errName: err instanceof Error ? err.name : 'unknown' }, 'email delivery failed');
        outcomes.push({ id: r.id, ok: false, messageId: null, error });
      }
    }
    return outcomes;
  }

  private async finish(db: Db, reportId: string, outcomes: { id: string; ok: boolean; messageId: string | null; error: string | null }[]) {
    const sentAt = new Date();
    await db.$transaction(
      outcomes.map((o) =>
        db.emailReportRecipient.update({
          where: { id: o.id },
          data: { status: o.ok ? 'SENT' : 'FAILED', messageId: o.messageId, error: o.error, sentAt: o.ok ? sentAt : null },
        }),
      ),
    );
    const sent = outcomes.filter((o) => o.ok).length;
    const status = sent === outcomes.length ? 'SENT' : sent === 0 ? 'FAILED' : 'PARTIAL';
    return db.emailReport.update({
      where: { id: reportId },
      data: { status, sentAt: sent ? sentAt : null, error: sent === outcomes.length ? null : `${outcomes.length - sent} of ${outcomes.length} recipients failed` },
      include: { recipients: true },
    });
  }

  async list(userId: string, options: { limit: number; kind?: 'REPORT' | 'ALERT' }): Promise<EmailReportResult[]> {
    const db = requireDb(this.deps.db);
    const rows = await db.emailReport.findMany({
      where: { userId, ...(options.kind ? { kind: options.kind } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(options.limit, 1), 100),
      include: { recipients: true },
    });
    return rows.map((r) => toResult(r, null));
  }

  async getShared(token: string): Promise<SharedReport> {
    const db = requireDb(this.deps.db);
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new AppError('NOT_FOUND', 'This shared report link is invalid or has expired.');
    const row = await db.emailReport.findUnique({ where: { shareTokenHash: hmacSha256(this.deps.config.reportLinkSecret, token) } });
    if (!row || !row.shareExpiresAt || row.shareExpiresAt.getTime() < Date.now() || !row.sharedSnapshot) {
      throw new AppError('NOT_FOUND', 'This shared report link is invalid or has expired.');
    }
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.shareExpiresAt.toISOString(),
      fields: row.fields as ReportFieldId[],
      trains: row.sharedSnapshot as unknown as NormalizedTrainStatus[],
    };
  }
}

function toResult(row: ReportRow, shareUrl: string | null): EmailReportResult {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    subject: row.subject,
    fields: row.fields as ReportFieldId[],
    trains: row.trains as unknown as ReportTrainRef[],
    recipients: row.recipients.map((r) => ({ email: r.email, status: r.status, error: r.error })),
    shareUrl,
    shareExpiresAt: row.shareExpiresAt?.toISOString() ?? null,
    error: row.error,
    delivery: row.delivery === 'outbox' ? 'outbox' : 'smtp',
    createdAt: row.createdAt.toISOString(),
  };
}
