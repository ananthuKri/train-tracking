import { Router } from 'express';
import { z } from 'zod';
import { EmailReportRequestSchema, ReportPreviewRequestSchema } from '@railtrack/shared';
import type { AppDeps } from '../../container.ts';
import { asyncHandler, clientIp, parseBody, requireAuth, type RateLimitFactory } from '../middleware/index.ts';
import { resolveJourneyDate } from './trains.ts';

export function reportsRouter(deps: AppDeps, limit: RateLimitFactory): Router {
  const router = Router();
  const emailLimiter = limit('email', {
    windowMs: 60 * 60_000,
    limit: 10,
    perUser: true,
    message: 'Email limit reached (10 reports per hour). Please try again later.',
  });
  const previewLimiter = limit('preview', { windowMs: 60 * 60_000, limit: 60, perUser: true });

  router.post(
    '/reports/preview',
    previewLimiter,
    asyncHandler(async (req, res) => {
      const body = parseBody(ReportPreviewRequestSchema, req.body);
      body.trains.forEach((t) => resolveJourneyDate(t.journeyDate));
      res.json(await deps.reports.preview(body));
    }),
  );

  router.post(
    '/reports/email',
    requireAuth(deps.auth),
    emailLimiter,
    asyncHandler(async (req, res) => {
      const body = parseBody(EmailReportRequestSchema, req.body);
      body.trains.forEach((t) => resolveJourneyDate(t.journeyDate));
      const result = await deps.reports.send(req.user!.id, body.recipients, body, clientIp(req));
      res.status(201).json(result);
    }),
  );

  router.get(
    '/reports',
    requireAuth(deps.auth),
    asyncHandler(async (req, res) => {
      const query = parseBody(
        z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), kind: z.enum(['REPORT', 'ALERT']).optional() }),
        req.query,
      );
      res.json({ items: await deps.reports.list(req.user!.id, query) });
    }),
  );

  router.get(
    '/share/:token',
    limit('share', { windowMs: 60_000, limit: 60 }),
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store').json(await deps.reports.getShared(String(req.params.token)));
    }),
  );

  return router;
}
