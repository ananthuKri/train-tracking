import { Worker } from 'bullmq';
import { loadConfig, loadDotenvFiles } from './config/env.ts';
import { createDeps } from './container.ts';
import { MONITORING_QUEUE, type MonitoringJobData } from './jobs/scheduler.ts';
import { createRedis } from './lib/redis.ts';

/**
 * Background worker: runs scheduled monitoring checks from the BullMQ queue.
 * Start it separately from the API (`npm run start:worker`) so checks survive API restarts and page closes.
 */
loadDotenvFiles();
const config = loadConfig();
const deps = createDeps(config);

if (!config.REDIS_URL || !deps.db) {
  deps.logger.warn('Monitoring worker needs REDIS_URL and DATABASE_URL; nothing to do. Exiting.');
  await deps.close();
  process.exit(0);
}

// Workers need their own blocking connection.
const connection = createRedis(config.REDIS_URL, (err) => deps.logger.warn({ errMessage: err.message }, 'worker redis error'), { forWorker: true });
const worker = new Worker<MonitoringJobData>(
  MONITORING_QUEUE,
  async (job) => {
    const result = await deps.monitoring.runCheck(job.data.subscriptionId);
    deps.logger.info({ subscriptionId: job.data.subscriptionId, ...result }, 'monitoring check');
    return result;
  },
  { connection, concurrency: 5 },
);
worker.on('failed', (job, err) => deps.logger.error({ err, subscriptionId: job?.data.subscriptionId }, 'monitoring check failed'));

const restored = await deps.monitoring.reconcile();
deps.logger.info({ restored, provider: config.TRAIN_DATA_PROVIDER }, 'RailTrack Live monitoring worker started');

async function shutdown(signal: string) {
  deps.logger.info({ signal }, 'worker shutting down');
  await worker.close();
  connection.disconnect();
  await deps.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
