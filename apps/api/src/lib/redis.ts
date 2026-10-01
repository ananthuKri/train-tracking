import { Redis } from 'ioredis';

/**
 * Two connection profiles:
 *  - default (API cache, rate limits, job scheduling): commands fail fast while Redis is unreachable,
 *    so requests degrade to "no cache" instead of hanging.
 *  - worker: BullMQ workers need blocking commands, which require `maxRetriesPerRequest: null`.
 * Connection errors are reported through `onError` rather than crashing the process.
 */
export function createRedis(url: string, onError: (err: Error) => void, options: { forWorker?: boolean } = {}): Redis {
  const redis = new Redis(
    url,
    options.forWorker
      ? { maxRetriesPerRequest: null, enableReadyCheck: true }
      : { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3_000, enableReadyCheck: true },
  );
  let lastReport = 0;
  redis.on('error', (err: Error) => {
    // ioredis retries forever; report at most once a minute to keep logs readable.
    if (Date.now() - lastReport > 60_000) {
      lastReport = Date.now();
      onError(err);
    }
  });
  return redis;
}

export type { Redis };
