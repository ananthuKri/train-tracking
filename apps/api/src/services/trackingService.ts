import {
  formatIst,
  type NormalizedRoute,
  type NormalizedTrainStatus,
  type ProviderId,
  type SnapshotSummary,
  type TrackResult,
  type TrainState,
} from '@railtrack/shared';
import type { Cache } from '../lib/cache.ts';
import { AppError, isTransientProviderError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import type { Db } from '../lib/prisma.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

/** How long the last verified result stays available as a fallback (beyond the live cache). */
const LAST_GOOD_TTL_SECONDS = 3 * 86_400;
const MIN_FORCE_REFRESH_SECONDS = 30;

export interface TrackItem {
  trainNumber: string;
  journeyDate: string;
}

export interface TrackManyOptions {
  forceRefresh?: boolean;
  userId?: string | null;
  source: 'MANUAL' | 'UPLOAD' | 'MONITORING' | 'API';
  invalidCount?: number;
}

export class TrackingService {
  private readonly inflight = new Map<string, Promise<TrackResult>>();

  constructor(
    private readonly deps: {
      providers: ProviderRegistry;
      cache: Cache;
      db: Db | null;
      logger: Logger;
      now?: () => Date;
    },
  ) {}

  get provider() {
    return this.deps.providers.active;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Live status for one train with short caching, request coalescing and last-verified fallback. */
  async getLiveStatus(trainNumber: string, journeyDate: string, options: { forceRefresh?: boolean; trackingRequestId?: string | null } = {}): Promise<TrackResult> {
    const provider = this.provider;
    const key = `live:${provider.id}:${trainNumber}:${journeyDate}`;

    const cached = await this.deps.cache.get<NormalizedTrainStatus>(key);
    // A forced refresh still reuses a result younger than MIN_FORCE_REFRESH_SECONDS to protect provider quotas.
    const ageSeconds = cached ? (this.now().getTime() - new Date(cached.fetchedAt).getTime()) / 1000 : Infinity;
    if (cached && (!options.forceRefresh || ageSeconds < MIN_FORCE_REFRESH_SECONDS)) {
      return { trainNumber, journeyDate, ok: true, status: { ...cached, freshness: 'cached' }, error: null };
    }

    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.fetchLive(trainNumber, journeyDate, key, options.trackingRequestId ?? null).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchLive(trainNumber: string, journeyDate: string, key: string, trackingRequestId: string | null): Promise<TrackResult> {
    const provider = this.provider;
    try {
      let status = await provider.getLiveStatus(trainNumber, journeyDate);
      status = await this.fillTrainName(status);
      await Promise.all([
        this.deps.cache.set(key, status, provider.limits.liveCacheSeconds),
        this.deps.cache.set(lastGoodKey(provider.id, trainNumber, journeyDate), status, LAST_GOOD_TTL_SECONDS),
        this.persistSnapshot(status, trackingRequestId),
      ]);
      return { trainNumber, journeyDate, ok: true, status, error: null };
    } catch (err) {
      const error =
        err instanceof AppError
          ? { code: err.code, message: err.message, retryAfterSeconds: err.retryAfterSeconds }
          : { code: 'INTERNAL_ERROR' as const, message: 'Unexpected error while fetching live status', retryAfterSeconds: null };
      if (!(err instanceof AppError)) this.deps.logger.error({ err, trainNumber }, 'live status failed');

      if (isTransientProviderError(err)) {
        const lastGood = await this.lastVerified(provider.id, trainNumber, journeyDate);
        if (lastGood) {
          const asOf = formatIst(lastGood.providerUpdatedAt ?? lastGood.fetchedAt);
          return {
            trainNumber,
            journeyDate,
            ok: true,
            status: {
              ...lastGood,
              freshness: 'stale',
              notice: `Live data temporarily unavailable — showing the last verified result from ${asOf} IST.`,
            },
            error,
          };
        }
      }
      return { trainNumber, journeyDate, ok: false, status: null, error };
    }
  }

  /** Track several trains concurrently (bounded by the provider limiter) and record the request. */
  async trackMany(items: TrackItem[], options: TrackManyOptions): Promise<{ requestId: string | null; results: TrackResult[] }> {
    const requestId = await this.createRequest(options);
    const results = await this.fetchMany(items, { forceRefresh: options.forceRefresh, trackingRequestId: requestId });
    await this.completeRequest(requestId, results, options.invalidCount ?? 0);
    return { requestId, results };
  }

  /** Fetch several trains with bounded concurrency; results keep input order. */
  async fetchMany(items: TrackItem[], options: { forceRefresh?: boolean; trackingRequestId?: string | null } = {}): Promise<TrackResult[]> {
    const concurrency = Math.max(1, this.provider.limits.maxConcurrent * 2);
    const results: TrackResult[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index]!;
        results[index] = await this.getLiveStatus(item.trainNumber, item.journeyDate, options);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private async createRequest(options: TrackManyOptions): Promise<string | null> {
    if (!this.deps.db) return null;
    try {
      const row = await this.deps.db.trackingRequest.create({
        data: {
          userId: options.userId ?? null,
          source: options.source,
          provider: this.provider.id,
          items: [],
          validCount: 0,
          invalidCount: options.invalidCount ?? 0,
          successCount: 0,
          failureCount: 0,
        },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      this.deps.logger.warn({ err }, 'could not record tracking request');
      return null;
    }
  }

  private async completeRequest(requestId: string | null, results: TrackResult[], invalidCount: number): Promise<void> {
    if (!requestId || !this.deps.db) return;
    try {
      await this.deps.db.trackingRequest.update({
        where: { id: requestId },
        data: {
          items: results.map((r) => ({ trainNumber: r.trainNumber, journeyDate: r.journeyDate, ok: r.ok, errorCode: r.error?.code ?? null })),
          validCount: results.length,
          invalidCount,
          successCount: results.filter((r) => r.ok).length,
          failureCount: results.filter((r) => !r.ok).length,
        },
      });
    } catch (err) {
      this.deps.logger.warn({ err }, 'could not update tracking request');
    }
  }

  private async persistSnapshot(status: NormalizedTrainStatus, trackingRequestId: string | null): Promise<void> {
    if (!this.deps.db) return;
    try {
      await this.deps.db.trainSnapshot.create({
        data: {
          trackingRequestId,
          trainNumber: status.trainNumber,
          journeyDate: status.journeyDate,
          provider: status.provider.id,
          isDemo: status.provider.isDemo,
          trainName: status.trainName,
          state: status.state,
          delayMinutes: status.delayMinutes,
          lastStationCode: status.lastReportedStation?.code ?? null,
          nextStationCode: status.nextStation?.code ?? null,
          progressPercent: status.progressPercent,
          positionKind: status.position?.kind ?? null,
          lat: status.position?.lat ?? null,
          lng: status.position?.lng ?? null,
          providerUpdatedAt: status.providerUpdatedAt ? new Date(status.providerUpdatedAt) : null,
          fetchedAt: new Date(status.fetchedAt),
          payload: status as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // Persistence is best-effort: tracking must keep working if the database is briefly unavailable.
      this.deps.logger.warn({ err, trainNumber: status.trainNumber }, 'could not persist snapshot');
    }
  }

  private async lastVerified(provider: ProviderId, trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus | null> {
    const cached = await this.deps.cache.get<NormalizedTrainStatus>(lastGoodKey(provider, trainNumber, journeyDate));
    if (cached) return cached;
    if (!this.deps.db) return null;
    try {
      const row = await this.deps.db.trainSnapshot.findFirst({
        where: { trainNumber, journeyDate, provider },
        orderBy: { fetchedAt: 'desc' },
        select: { payload: true },
      });
      return row ? (row.payload as unknown as NormalizedTrainStatus) : null;
    } catch (err) {
      this.deps.logger.warn({ err }, 'could not read last verified snapshot');
      return null;
    }
  }

  /** Some providers omit the train name in live responses; use the stored route name when known. */
  private async fillTrainName(status: NormalizedTrainStatus): Promise<NormalizedTrainStatus> {
    if (status.trainName !== `Train ${status.trainNumber}`) return status;
    const cachedRoute = await this.deps.cache.get<NormalizedRoute>(routeKey(status.provider.id, status.trainNumber));
    let name = cachedRoute?.trainName;
    if (!name && this.deps.db) {
      const stop = await this.deps.db.trainRouteStop
        .findFirst({ where: { trainNumber: status.trainNumber }, select: { trainName: true } })
        .catch(() => null);
      name = stop?.trainName;
    }
    return name && name !== status.trainName ? { ...status, trainName: name } : status;
  }

  /** Static route with Redis cache → database cache → provider, honouring the provider's route TTL. */
  async getRoute(trainNumber: string): Promise<NormalizedRoute> {
    const provider = this.provider;
    const key = routeKey(provider.id, trainNumber);
    const cached = await this.deps.cache.get<NormalizedRoute>(key);
    if (cached) return cached;

    const fromDb = await this.routeFromDb(provider.id, trainNumber, provider.limits.routeCacheSeconds);
    if (fromDb) {
      await this.deps.cache.set(key, fromDb, provider.limits.routeCacheSeconds);
      return fromDb;
    }

    const route = await provider.getTrainRoute(trainNumber);
    await this.deps.cache.set(key, route, provider.limits.routeCacheSeconds);
    await this.saveRoute(route);
    return route;
  }

  private async routeFromDb(provider: ProviderId, trainNumber: string, maxAgeSeconds: number): Promise<NormalizedRoute | null> {
    if (!this.deps.db) return null;
    try {
      const rows = await this.deps.db.trainRouteStop.findMany({ where: { trainNumber, provider }, orderBy: { sequence: 'asc' } });
      if (rows.length < 2) return null;
      const oldest = Math.min(...rows.map((r) => r.updatedAt.getTime()));
      if (this.now().getTime() - oldest > maxAgeSeconds * 1000) return null;
      const first = rows[0]!;
      const last = rows[rows.length - 1]!;
      return {
        trainNumber,
        trainName: first.trainName,
        source: { code: first.stationCode, name: first.stationName },
        destination: { code: last.stationCode, name: last.stationName },
        stops: rows.map((r) => ({
          sequence: r.sequence,
          stationCode: r.stationCode,
          stationName: r.stationName,
          lat: r.lat,
          lng: r.lng,
          distanceKm: r.distanceKm,
          day: r.day,
          scheduledArrival: r.scheduledArrival,
          scheduledDeparture: r.scheduledDeparture,
          haltMinutes: r.haltMinutes,
          isHalt: r.isHalt,
          platform: r.platform,
        })),
        runningDays: null,
        totalDistanceKm: last.distanceKm,
        provider: this.provider.info,
        fetchedAt: new Date(oldest).toISOString(),
      };
    } catch (err) {
      this.deps.logger.warn({ err }, 'could not read cached route');
      return null;
    }
  }

  private async saveRoute(route: NormalizedRoute): Promise<void> {
    if (!this.deps.db) return;
    try {
      await this.deps.db.$transaction([
        this.deps.db.trainRouteStop.deleteMany({ where: { trainNumber: route.trainNumber, provider: route.provider.id } }),
        this.deps.db.trainRouteStop.createMany({
          data: route.stops.map((s) => ({
            trainNumber: route.trainNumber,
            provider: route.provider.id,
            trainName: route.trainName,
            sequence: s.sequence,
            stationCode: s.stationCode,
            stationName: s.stationName,
            lat: s.lat,
            lng: s.lng,
            distanceKm: s.distanceKm,
            day: s.day,
            scheduledArrival: s.scheduledArrival,
            scheduledDeparture: s.scheduledDeparture,
            haltMinutes: s.haltMinutes,
            isHalt: s.isHalt,
            platform: s.platform,
          })),
          skipDuplicates: true,
        }),
      ]);
    } catch (err) {
      this.deps.logger.warn({ err }, 'could not store route');
    }
  }

  async snapshots(trainNumber: string, journeyDate: string, limit = 50): Promise<SnapshotSummary[]> {
    if (!this.deps.db) return [];
    const rows = await this.deps.db.trainSnapshot.findMany({
      where: { trainNumber, journeyDate },
      orderBy: { fetchedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        fetchedAt: true,
        providerUpdatedAt: true,
        provider: true,
        isDemo: true,
        state: true,
        delayMinutes: true,
        lastStationCode: true,
        nextStationCode: true,
        progressPercent: true,
        positionKind: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      fetchedAt: r.fetchedAt.toISOString(),
      providerUpdatedAt: r.providerUpdatedAt?.toISOString() ?? null,
      provider: r.provider as ProviderId,
      isDemo: r.isDemo,
      state: r.state as TrainState,
      delayMinutes: r.delayMinutes,
      lastStationCode: r.lastStationCode,
      nextStationCode: r.nextStationCode,
      progressPercent: r.progressPercent,
      positionKind: (r.positionKind as 'reported' | 'estimated' | null) ?? null,
    }));
  }
}

const lastGoodKey = (provider: string, trainNumber: string, journeyDate: string) => `lastgood:${provider}:${trainNumber}:${journeyDate}`;
const routeKey = (provider: string, trainNumber: string) => `route:${provider}:${trainNumber}`;
