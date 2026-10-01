import { Router } from 'express';
import { z } from 'zod';
import {
  MAX_TRAINS_PER_REQUEST,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_ROWS,
  MONITORING_DEFAULT_INTERVAL_MINUTES,
  MONITORING_MAX_INTERVAL_MINUTES,
  MONITORING_MIN_INTERVAL_MINUTES,
  type AppConfig as PublicConfig,
  type ProviderUsageSummary,
} from '@railtrack/shared';
import type { AppDeps } from '../../container.ts';
import { requireDb } from '../../lib/prisma.ts';
import { asyncHandler, parseBody, requireAdmin } from '../middleware/index.ts';

const OSM = {
  provider: 'osm' as const,
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

export function publicConfig(deps: AppDeps): PublicConfig {
  const token = deps.config.MAPBOX_TOKEN;
  // Only public (pk.*) Mapbox tokens are ever sent to browsers.
  const map =
    token && token.startsWith('pk.')
      ? {
          provider: 'mapbox' as const,
          tileUrl: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token)}`,
          attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 20,
        }
      : OSM;
  const active = deps.tracking.provider;
  const emailEnabled = Boolean(deps.db) && deps.mailer.mode !== 'disabled';
  return {
    activeProvider: active.info,
    demoMode: active.info.isDemo,
    map,
    limits: {
      maxTrainsPerRequest: MAX_TRAINS_PER_REQUEST,
      maxUploadRows: MAX_UPLOAD_ROWS,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      monitoring: {
        minIntervalMinutes: Math.max(MONITORING_MIN_INTERVAL_MINUTES, active.limits.minPollMinutes),
        maxIntervalMinutes: MONITORING_MAX_INTERVAL_MINUTES,
        defaultIntervalMinutes: Math.max(MONITORING_DEFAULT_INTERVAL_MINUTES, active.limits.minPollMinutes),
      },
    },
    features: { email: emailEnabled, monitoring: Boolean(deps.db && deps.scheduler), shareLinks: emailEnabled },
  };
}

export function systemRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json(publicConfig(deps));
  });

  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const [database, redis] = await Promise.all([
        deps.db
          ? deps.db.$queryRaw`SELECT 1`.then(
              () => 'up' as const,
              () => 'down' as const,
            )
          : Promise.resolve('not_configured' as const),
        deps.redis
          ? deps.redis.ping().then(
              () => 'up' as const,
              () => 'down' as const,
            )
          : Promise.resolve('not_configured' as const),
      ]);
      const ok = database !== 'down' && redis !== 'down';
      res.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'degraded',
        database,
        redis,
        cache: deps.cache.kind,
        email: deps.mailer.mode,
        provider: deps.tracking.provider.id,
        time: new Date().toISOString(),
      });
    }),
  );

  router.get(
    '/health/providers',
    asyncHandler(async (req, res) => {
      // Forcing a fresh probe spends provider quota, so only administrators may do it.
      const force = req.query.force === 'true' && req.session?.role === 'ADMIN';
      res.json({ activeProvider: deps.tracking.provider.id, providers: await deps.providers.health({ force }) });
    }),
  );

  router.get(
    '/admin/provider-usage',
    ...requireAdmin(deps.auth),
    asyncHandler(async (req, res) => {
      const db = requireDb(deps.db);
      const { hours } = parseBody(z.object({ hours: z.coerce.number().int().min(1).max(24 * 30).default(24) }), req.query);
      const since = new Date(Date.now() - hours * 3_600_000);
      const [grouped, latency, lastErrors] = await Promise.all([
        db.providerUsageLog.groupBy({ by: ['provider', 'outcome'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        db.providerUsageLog.groupBy({ by: ['provider'], where: { createdAt: { gte: since } }, _avg: { latencyMs: true } }),
        db.providerUsageLog.findMany({
          where: { createdAt: { gte: since }, outcome: { in: ['error', 'rate_limited'] } },
          orderBy: { createdAt: 'desc' },
          distinct: ['provider'],
          select: { provider: true, message: true, createdAt: true },
        }),
      ]);
      const providers = [...new Set([...grouped.map((g) => g.provider), ...deps.providers.list().map((p) => p.id)])];
      const items: ProviderUsageSummary[] = providers.map((provider) => {
        const count = (outcome?: string) =>
          grouped.filter((g) => g.provider === provider && (!outcome || g.outcome === outcome)).reduce((sum, g) => sum + g._count._all, 0);
        const avg = latency.find((l) => l.provider === provider)?._avg.latencyMs;
        const last = lastErrors.find((e) => e.provider === provider);
        return {
          provider,
          windowHours: hours,
          total: count(),
          success: count('success'),
          errors: count('error'),
          rateLimited: count('rate_limited'),
          avgLatencyMs: avg === null || avg === undefined ? null : Math.round(avg),
          lastError: last?.message ?? null,
          lastErrorAt: last?.createdAt.toISOString() ?? null,
        };
      });
      res.json({ items });
    }),
  );

  return router;
}
