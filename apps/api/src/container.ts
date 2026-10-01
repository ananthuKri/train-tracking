import type { AppConfig } from './config/env.ts';
import { MemoryCache, RedisCache, SafeCache, type Cache } from './lib/cache.ts';
import { createLogger, type Logger } from './lib/logger.ts';
import { createPrisma, type Db } from './lib/prisma.ts';
import { createRedis, type Redis } from './lib/redis.ts';
import type { FetchLike } from './lib/http.ts';
import { BullMonitoringScheduler, type MonitoringScheduler } from './jobs/scheduler.ts';
import { createProviderRegistry, type ProviderRegistry, type UsageSink } from './providers/registry.ts';
import { AuditService } from './services/auditService.ts';
import { AuthService } from './services/authService.ts';
import { EmailReportService } from './services/emailReportService.ts';
import { createMailer, type Mailer } from './services/mailer.ts';
import { MonitoringService } from './services/monitoringService.ts';
import { TrackingService } from './services/trackingService.ts';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  db: Db | null;
  redis: Redis | null;
  cache: Cache;
  providers: ProviderRegistry;
  tracking: TrackingService;
  mailer: Mailer;
  scheduler: MonitoringScheduler | null;
  audit: AuditService;
  auth: AuthService;
  reports: EmailReportService;
  monitoring: MonitoringService;
  close(): Promise<void>;
}

export interface DepOverrides {
  logger?: Logger;
  db?: Db | null;
  redis?: Redis | null;
  cache?: Cache;
  mailer?: Mailer;
  scheduler?: MonitoringScheduler | null;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

/** Log a recurring infrastructure warning at most once per interval per key. */
function throttledWarn(logger: Logger, intervalMs = 60_000) {
  const last = new Map<string, number>();
  return (key: string, details: Record<string, unknown>, message: string) => {
    const now = Date.now();
    if (now - (last.get(key) ?? 0) < intervalMs) return;
    last.set(key, now);
    logger.warn(details, message);
  };
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.message || (err as NodeJS.ErrnoException).code || err.name;
}

export function createDeps(config: AppConfig, overrides: DepOverrides = {}): AppDeps {
  const logger =
    overrides.logger ??
    createLogger({ level: config.LOG_LEVEL ?? (config.isTest ? 'silent' : 'info'), pretty: !config.isProduction && !config.isTest });

  const db = overrides.db !== undefined ? overrides.db : config.DATABASE_URL ? createPrisma(config.DATABASE_URL) : null;
  const warnOnce = throttledWarn(logger);
  const redis =
    overrides.redis !== undefined
      ? overrides.redis
      : config.REDIS_URL
        ? createRedis(config.REDIS_URL, (err) => warnOnce('redis', { reason: describeError(err) }, 'Redis unreachable — using in-memory fallbacks'))
        : null;

  const cache =
    overrides.cache ??
    new SafeCache(redis ? new RedisCache(redis) : new MemoryCache(), (err, op) =>
      warnOnce('cache', { op, reason: describeError(err) }, 'cache unavailable — continuing without it'),
    );

  const usage: UsageSink = (record) => {
    logger.debug({ provider: record.provider, operation: record.operation, outcome: record.outcome, latencyMs: record.latencyMs }, 'provider call');
    db?.providerUsageLog
      .create({
        data: {
          provider: record.provider,
          operation: record.operation,
          trainNumber: record.trainNumber,
          outcome: record.outcome,
          httpStatus: record.httpStatus,
          latencyMs: record.latencyMs,
          errorCode: record.errorCode,
          message: record.message?.slice(0, 500) ?? null,
        },
      })
      .catch((err: unknown) => logger.warn({ err }, 'could not record provider usage'));
  };

  const providers = createProviderRegistry(config, usage, { fetchImpl: overrides.fetchImpl, now: overrides.now });
  const tracking = new TrackingService({ providers, cache, db, logger, now: overrides.now });
  const mailer = overrides.mailer ?? createMailer(config);
  const scheduler = overrides.scheduler !== undefined ? overrides.scheduler : redis ? new BullMonitoringScheduler(redis, (err) => warnOnce('queue', { reason: describeError(err) }, 'monitoring queue unavailable')) : null;
  const audit = new AuditService(db, config.sessionSecret, logger);
  const auth = new AuthService({ db, config, audit });
  const reports = new EmailReportService({ db, tracking, mailer, config, logger, audit });
  const monitoring = new MonitoringService({ db, scheduler, tracking, reports, audit, logger, now: overrides.now });

  return {
    config,
    logger,
    db,
    redis,
    cache,
    providers,
    tracking,
    mailer,
    scheduler,
    audit,
    auth,
    reports,
    monitoring,
    async close() {
      await scheduler?.close().catch(() => undefined);
      await db?.$disconnect().catch(() => undefined);
      if (redis && overrides.redis === undefined) redis.disconnect();
    },
  };
}
