import { ProviderError } from './errors.ts';

export interface RateLimiterOptions {
  /** Requests allowed in flight at once. */
  maxConcurrent: number;
  /** Minimum spacing between request starts. */
  minIntervalMs: number;
  /** Optional rolling one-minute cap. */
  maxPerMinute?: number;
  /** Queue length after which new work is rejected instead of waiting. */
  maxQueue?: number;
  /** Provider id used in rejection errors. */
  name: string;
}

interface Task {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * In-process outbound limiter that keeps calls to a provider within its documented burst limits.
 * (One limiter per provider per process; scale-out deployments should divide limits by replica count.)
 */
export class RateLimiter {
  private readonly queue: Task[] = [];
  private active = 0;
  private lastStart = 0;
  private readonly starts: number[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: RateLimiterOptions) {}

  get pending(): number {
    return this.queue.length;
  }

  schedule<T>(run: () => Promise<T>): Promise<T> {
    const maxQueue = this.options.maxQueue ?? 200;
    if (this.queue.length >= maxQueue) {
      return Promise.reject(
        new ProviderError(this.options.name, 'RATE_LIMITED', 'Too many queued requests for this data provider; try again shortly', {
          retryAfterSeconds: 30,
        }),
      );
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.timer) return;
    while (this.queue.length > 0 && this.active < this.options.maxConcurrent) {
      const now = Date.now();
      while (this.starts.length && now - this.starts[0]! >= 60_000) this.starts.shift();
      let waitMs = Math.max(0, this.lastStart + this.options.minIntervalMs - now);
      if (this.options.maxPerMinute && this.starts.length >= this.options.maxPerMinute) {
        waitMs = Math.max(waitMs, this.starts[0]! + 60_000 - now);
      }
      if (waitMs > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, waitMs);
        this.timer.unref?.();
        return;
      }
      const task = this.queue.shift()!;
      this.active++;
      this.lastStart = now;
      this.starts.push(now);
      task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}
