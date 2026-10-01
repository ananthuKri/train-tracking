import {
  checkJourneyDate,
  diffDays,
  todayInIst,
  type AlertRules,
  type MonitoringSubscription,
} from '@railtrack/shared';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import { requireDb, type Db } from '../lib/prisma.ts';
import type { MonitoringSubscription as SubscriptionRow, Prisma } from '../generated/prisma/client.ts';
import type { MonitoringScheduler } from '../jobs/scheduler.ts';
import { evaluateAlerts, type LastKnown } from './alertRules.ts';
import type { AuditService } from './auditService.ts';
import type { EmailReportService } from './emailReportService.ts';
import type { TrackingService } from './trackingService.ts';

const MAX_ACTIVE_PER_USER = 25;
/** After this many consecutive failed checks the subscription is parked in ERROR. */
const MAX_CONSECUTIVE_FAILURES = 12;
/** Stop checking a journey this many days after its start date. */
const JOURNEY_EXPIRY_DAYS = 4;

export interface CreateMonitoringInput {
  trainNumber: string;
  journeyDate: string;
  intervalMinutes: number;
  rules: AlertRules;
  recipients: string[];
}

export interface PatchMonitoringInput {
  action?: 'pause' | 'resume';
  intervalMinutes?: number;
  rules?: AlertRules;
  recipients?: string[];
}

export class MonitoringService {
  constructor(
    private readonly deps: {
      db: Db | null;
      scheduler: MonitoringScheduler | null;
      tracking: TrackingService;
      reports: EmailReportService;
      audit: AuditService;
      logger: Logger;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private requireScheduler(): MonitoringScheduler {
    if (!this.deps.scheduler) {
      throw new AppError('MONITORING_UNAVAILABLE', 'Monitoring needs Redis-backed background jobs, which are not configured on this server.');
    }
    return this.deps.scheduler;
  }

  private checkInterval(intervalMinutes: number): void {
    const min = this.deps.tracking.provider.limits.minPollMinutes;
    if (intervalMinutes < min) {
      throw new AppError('VALIDATION_ERROR', `The ${this.deps.tracking.provider.info.name} provider allows checks every ${min} minutes or more.`);
    }
  }

  async create(userId: string, input: CreateMonitoringInput, ip: string | null): Promise<MonitoringSubscription> {
    const db = requireDb(this.deps.db);
    const scheduler = this.requireScheduler();
    this.checkInterval(input.intervalMinutes);
    const dateCheck = checkJourneyDate(input.journeyDate, this.now());
    if (!dateCheck.ok) throw new AppError('VALIDATION_ERROR', dateCheck.reason!);

    const active = await db.monitoringSubscription.count({ where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } } });
    if (active >= MAX_ACTIVE_PER_USER) throw new AppError('CONFLICT', `You can monitor at most ${MAX_ACTIVE_PER_USER} trains at once. Stop one first.`);

    // Validate the train up front so users are not subscribed to a number that does not exist.
    const probe = await this.deps.tracking.getLiveStatus(input.trainNumber, input.journeyDate);
    if (!probe.ok && probe.error && ['TRAIN_NOT_FOUND', 'NOT_RUNNING_ON_DATE', 'INVALID_TRAIN_NUMBER'].includes(probe.error.code)) {
      throw new AppError(probe.error.code, probe.error.message);
    }

    const row = await db.monitoringSubscription.create({
      data: {
        userId,
        trainNumber: input.trainNumber,
        journeyDate: input.journeyDate,
        trainName: probe.status?.trainName ?? null,
        intervalMinutes: input.intervalMinutes,
        rules: input.rules as unknown as Prisma.InputJsonValue,
        recipients: [...new Set(input.recipients)],
        status: 'ACTIVE',
        nextCheckAt: this.now(),
      },
    });
    await scheduler.schedule(row.id, row.intervalMinutes);
    await this.deps.audit.record({
      userId,
      action: 'monitoring.create',
      entityType: 'MonitoringSubscription',
      entityId: row.id,
      metadata: { trainNumber: row.trainNumber, intervalMinutes: row.intervalMinutes, recipientCount: row.recipients.length },
      ip,
    });
    return toDto(row);
  }

  async list(userId: string): Promise<MonitoringSubscription[]> {
    const db = requireDb(this.deps.db);
    const rows = await db.monitoringSubscription.findMany({ where: { userId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 });
    return rows.map(toDto);
  }

  private async owned(db: Db, userId: string, id: string): Promise<SubscriptionRow> {
    const row = await db.monitoringSubscription.findFirst({ where: { id, userId } });
    if (!row) throw new AppError('NOT_FOUND', 'Monitoring subscription not found');
    return row;
  }

  async update(userId: string, id: string, patch: PatchMonitoringInput, ip: string | null): Promise<MonitoringSubscription> {
    const db = requireDb(this.deps.db);
    const scheduler = this.requireScheduler();
    const row = await this.owned(db, userId, id);
    if (row.status === 'STOPPED' || row.status === 'COMPLETED') throw new AppError('CONFLICT', 'This subscription has ended; create a new one instead.');
    if (patch.intervalMinutes !== undefined) this.checkInterval(patch.intervalMinutes);

    let status = row.status;
    if (patch.action === 'pause') status = 'PAUSED';
    if (patch.action === 'resume') status = 'ACTIVE';

    const updated = await db.monitoringSubscription.update({
      where: { id },
      data: {
        status,
        intervalMinutes: patch.intervalMinutes ?? row.intervalMinutes,
        rules: patch.rules ? (patch.rules as unknown as Prisma.InputJsonValue) : undefined,
        recipients: patch.recipients ? [...new Set(patch.recipients)] : undefined,
        // Resuming from ERROR gives the subscription a fresh start.
        consecutiveFailures: patch.action === 'resume' ? 0 : undefined,
        lastError: patch.action === 'resume' ? null : undefined,
        nextCheckAt: status === 'ACTIVE' ? this.now() : null,
      },
    });
    if (updated.status === 'ACTIVE') await scheduler.schedule(id, updated.intervalMinutes);
    else await scheduler.unschedule(id);
    await this.deps.audit.record({
      userId,
      action: `monitoring.${patch.action ?? 'update'}`,
      entityType: 'MonitoringSubscription',
      entityId: id,
      metadata: { status: updated.status, intervalMinutes: updated.intervalMinutes },
      ip,
    });
    return toDto(updated);
  }

  async stop(userId: string, id: string, ip: string | null): Promise<MonitoringSubscription> {
    const db = requireDb(this.deps.db);
    const row = await this.owned(db, userId, id);
    await this.deps.scheduler?.unschedule(id);
    const updated =
      row.status === 'STOPPED' ? row : await db.monitoringSubscription.update({ where: { id }, data: { status: 'STOPPED', nextCheckAt: null } });
    await this.deps.audit.record({ userId, action: 'monitoring.stop', entityType: 'MonitoringSubscription', entityId: id, ip });
    return toDto(updated);
  }

  /** One scheduled check (called by the BullMQ worker). */
  async runCheck(id: string): Promise<{ outcome: 'skipped' | 'checked' | 'alerted' | 'completed' | 'failed'; alerts: number }> {
    const db = requireDb(this.deps.db);
    const row = await db.monitoringSubscription.findUnique({ where: { id } });
    if (!row || row.status !== 'ACTIVE') {
      await this.deps.scheduler?.unschedule(id);
      return { outcome: 'skipped', alerts: 0 };
    }
    const now = this.now();

    if (diffDays(row.journeyDate, todayInIst(now)) > JOURNEY_EXPIRY_DAYS) {
      await db.monitoringSubscription.update({ where: { id }, data: { status: 'COMPLETED', nextCheckAt: null, lastCheckedAt: now } });
      await this.deps.scheduler?.unschedule(id);
      return { outcome: 'completed', alerts: 0 };
    }

    const result = await this.deps.tracking.getLiveStatus(row.trainNumber, row.journeyDate);
    const nextCheckAt = new Date(now.getTime() + row.intervalMinutes * 60_000);

    if (!result.ok || !result.status || result.status.freshness === 'stale') {
      const failures = row.consecutiveFailures + 1;
      const parked = failures >= MAX_CONSECUTIVE_FAILURES;
      await db.monitoringSubscription.update({
        where: { id },
        data: {
          lastCheckedAt: now,
          consecutiveFailures: failures,
          lastError: result.error?.message ?? 'Live data temporarily unavailable',
          status: parked ? 'ERROR' : undefined,
          nextCheckAt: parked ? null : nextCheckAt,
        },
      });
      if (parked) await this.deps.scheduler?.unschedule(id);
      return { outcome: 'failed', alerts: 0 };
    }

    const evaluation = evaluateAlerts(row.lastKnown as LastKnown | null, result.status, row.rules as unknown as AlertRules, row.firedAlerts);
    let alertStatus: string | null = null;
    if (evaluation.alerts.length) {
      try {
        alertStatus = await this.deps.reports.sendAlert({
          userId: row.userId,
          subscriptionId: row.id,
          recipients: row.recipients,
          status: result.status,
          alertLines: evaluation.alerts.map((a) => a.line),
        });
      } catch (err) {
        this.deps.logger.error({ err, subscriptionId: id }, 'alert email failed');
        alertStatus = 'FAILED';
      }
    }
    const delivered = alertStatus === 'SENT' || alertStatus === 'PARTIAL';

    await db.monitoringSubscription.update({
      where: { id },
      data: {
        trainName: result.status.trainName,
        lastCheckedAt: now,
        lastKnown: evaluation.lastKnown as unknown as Prisma.InputJsonValue,
        // If delivery failed entirely, keep the alerts un-fired so the next check retries them.
        firedAlerts: delivered || !evaluation.alerts.length ? evaluation.fired : row.firedAlerts,
        alertCount: delivered ? { increment: evaluation.alerts.length } : undefined,
        lastAlertAt: delivered ? now : undefined,
        consecutiveFailures: 0,
        lastError: alertStatus === 'FAILED' ? 'Alert email could not be delivered' : null,
        status: evaluation.terminal ? 'COMPLETED' : undefined,
        nextCheckAt: evaluation.terminal ? null : nextCheckAt,
      },
    });
    if (evaluation.terminal) {
      await this.deps.scheduler?.unschedule(id);
      return { outcome: 'completed', alerts: evaluation.alerts.length };
    }
    return { outcome: evaluation.alerts.length ? 'alerted' : 'checked', alerts: evaluation.alerts.length };
  }

  /** Re-create schedulers for active subscriptions (e.g. after Redis was flushed). */
  async reconcile(): Promise<number> {
    if (!this.deps.db || !this.deps.scheduler) return 0;
    const active = await this.deps.db.monitoringSubscription.findMany({ where: { status: 'ACTIVE' }, select: { id: true, intervalMinutes: true } });
    for (const sub of active) await this.deps.scheduler.schedule(sub.id, sub.intervalMinutes);
    return active.length;
  }
}

export function toDto(row: SubscriptionRow): MonitoringSubscription {
  const lastKnown = row.lastKnown as LastKnown | null;
  return {
    id: row.id,
    trainNumber: row.trainNumber,
    journeyDate: row.journeyDate,
    trainName: row.trainName,
    intervalMinutes: row.intervalMinutes,
    rules: row.rules as unknown as AlertRules,
    recipients: row.recipients,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastAlertAt: row.lastAlertAt?.toISOString() ?? null,
    nextCheckAt: row.nextCheckAt?.toISOString() ?? null,
    alertCount: row.alertCount,
    lastError: row.lastError,
    lastKnown: lastKnown
      ? {
          state: lastKnown.state,
          delayMinutes: lastKnown.delayMinutes,
          lastStationCode: lastKnown.lastStationCode,
          nextStationCode: lastKnown.nextStationCode,
          isDemo: lastKnown.isDemo,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}
