import { loadConfig, type AppConfig } from '../src/config/env.ts';
import { createDeps, type AppDeps, type DepOverrides } from '../src/container.ts';
import { createLogger } from '../src/lib/logger.ts';
import { createPrisma, type Db } from '../src/lib/prisma.ts';
import { InMemoryScheduler } from '../src/jobs/scheduler.ts';
import { MemoryMailer } from '../src/services/mailer.ts';
import { MemoryCache } from '../src/lib/cache.ts';

/** Integration tests run only when a disposable database is provided, e.g. `prisma dev` or docker compose. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    TRAIN_DATA_PROVIDER: 'mock',
    SESSION_SECRET: 's'.repeat(40),
    REPORT_LINK_SECRET: 'r'.repeat(40),
    APP_BASE_URL: 'http://localhost:5173',
    FRONTEND_URL: 'http://localhost:5173',
    ADMIN_EMAILS: 'admin@example.com',
    ...env,
  });
}

export interface TestContext {
  deps: AppDeps;
  mailer: MemoryMailer;
  scheduler: InMemoryScheduler;
}

export function testDeps(options: { db?: Db | null; env?: Record<string, string>; overrides?: DepOverrides } = {}): TestContext {
  const mailer = new MemoryMailer();
  const scheduler = new InMemoryScheduler();
  const deps = createDeps(testConfig(options.env), {
    logger: createLogger({ level: 'silent' }),
    db: options.db ?? null,
    redis: null,
    cache: new MemoryCache(),
    mailer,
    scheduler,
    ...options.overrides,
  });
  return { deps, mailer, scheduler };
}

let sharedDb: Db | null = null;
export function testDb(): Db {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  sharedDb ??= createPrisma(TEST_DATABASE_URL);
  return sharedDb;
}

export async function resetDb(db: Db): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "EmailReportRecipient", "EmailReport", "MonitoringSubscription", "TrainSnapshot", "TrackingRequest", "TrainRouteStop", "ProviderUsageLog", "AuditLog", "User" CASCADE',
  );
}

/** Wait for fire-and-forget writes (usage logs) to land. */
export const flush = () => new Promise((r) => setTimeout(r, 50));
