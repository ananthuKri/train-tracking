import { Router } from 'express';
import { MonitoringCreateSchema, MonitoringPatchSchema } from '@railtrack/shared';
import type { AppDeps } from '../../container.ts';
import { asyncHandler, clientIp, parseBody, requireAuth, type RateLimitFactory } from '../middleware/index.ts';
import { resolveJourneyDate } from './trains.ts';

export function monitoringRouter(deps: AppDeps, limit: RateLimitFactory): Router {
  const router = Router();
  const writeLimiter = limit('monitoring', { windowMs: 60 * 60_000, limit: 60, perUser: true });
  router.use('/monitoring', requireAuth(deps.auth));

  router.get(
    '/monitoring',
    asyncHandler(async (req, res) => {
      res.json({ items: await deps.monitoring.list(req.user!.id) });
    }),
  );

  router.post(
    '/monitoring',
    writeLimiter,
    asyncHandler(async (req, res) => {
      const body = parseBody(MonitoringCreateSchema, req.body);
      const journeyDate = resolveJourneyDate(body.journeyDate);
      const created = await deps.monitoring.create(req.user!.id, { ...body, journeyDate }, clientIp(req));
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/monitoring/:id',
    writeLimiter,
    asyncHandler(async (req, res) => {
      const body = parseBody(MonitoringPatchSchema, req.body);
      res.json(await deps.monitoring.update(req.user!.id, String(req.params.id), body, clientIp(req)));
    }),
  );

  router.delete(
    '/monitoring/:id',
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await deps.monitoring.stop(req.user!.id, String(req.params.id), clientIp(req)));
    }),
  );

  return router;
}
