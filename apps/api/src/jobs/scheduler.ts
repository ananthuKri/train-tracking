import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const MONITORING_QUEUE = 'railtrack-monitoring';

export interface MonitoringJobData {
  subscriptionId: string;
}

/** Schedules recurring server-side checks, so monitoring keeps running after the browser closes. */
export interface MonitoringScheduler {
  schedule(subscriptionId: string, intervalMinutes: number): Promise<void>;
  unschedule(subscriptionId: string): Promise<void>;
  close(): Promise<void>;
}

const schedulerId = (subscriptionId: string) => `monitor:${subscriptionId}`;

export class BullMonitoringScheduler implements MonitoringScheduler {
  readonly queue: Queue<MonitoringJobData>;

  constructor(connection: Redis) {
    this.queue = new Queue<MonitoringJobData>(MONITORING_QUEUE, {
      connection,
      defaultJobOptions: { removeOnComplete: 200, removeOnFail: 500 },
    });
  }

  async schedule(subscriptionId: string, intervalMinutes: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      schedulerId(subscriptionId),
      { every: intervalMinutes * 60_000 },
      { name: 'check', data: { subscriptionId }, opts: { attempts: 1 } },
    );
  }

  async unschedule(subscriptionId: string): Promise<void> {
    await this.queue.removeJobScheduler(schedulerId(subscriptionId));
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/** Records calls instead of scheduling (tests, or deployments without Redis). */
export class InMemoryScheduler implements MonitoringScheduler {
  readonly scheduled = new Map<string, number>();

  async schedule(subscriptionId: string, intervalMinutes: number): Promise<void> {
    this.scheduled.set(subscriptionId, intervalMinutes);
  }

  async unschedule(subscriptionId: string): Promise<void> {
    this.scheduled.delete(subscriptionId);
  }

  async close(): Promise<void> {}
}
