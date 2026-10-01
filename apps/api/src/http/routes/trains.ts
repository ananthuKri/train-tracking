import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  checkJourneyDate,
  explainInvalidTrainNumber,
  isValidTrainNumber,
  journeyDateSchema,
  MAX_TRAINS_PER_REQUEST,
  MAX_UPLOAD_BYTES,
  normaliseTrainToken,
  parseTrainNumbers,
  todayInIst,
  TrackRequestSchema,
  TrainQuerySchema,
  type InvalidTrainInput,
  type TrackResponse,
} from '@railtrack/shared';
import type { AppDeps } from '../../container.ts';
import { AppError } from '../../lib/errors.ts';
import { buildUploadPreview } from '../../services/uploadService.ts';
import { asyncHandler, parseBody, type RateLimitFactory } from '../middleware/index.ts';

export function resolveJourneyDate(value: string | undefined): string {
  const date = value ?? todayInIst();
  const check = checkJourneyDate(date);
  if (!check.ok) throw new AppError('VALIDATION_ERROR', check.reason!);
  return date;
}

export function parseTrainParam(value: string | undefined): string {
  const token = normaliseTrainToken(value ?? '');
  if (!isValidTrainNumber(token)) throw new AppError('INVALID_TRAIN_NUMBER', explainInvalidTrainNumber(token));
  return token;
}

export function trainsRouter(deps: AppDeps, limit: RateLimitFactory): Router {
  const router = Router();
  const trackLimiter = limit('track', { windowMs: 60_000, limit: 30, message: 'Too many tracking requests. Please wait a minute.' });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
  });

  router.post(
    '/trains/track',
    trackLimiter,
    asyncHandler(async (req, res) => {
      const body = parseBody(TrackRequestSchema, req.body);
      const defaultDate = resolveJourneyDate(body.journeyDate);
      const invalid: InvalidTrainInput[] = [];
      const duplicates = new Set<string>();
      const items: { trainNumber: string; journeyDate: string }[] = [];
      const seen = new Set<string>();
      const add = (trainNumber: string, journeyDate: string) => {
        const key = `${trainNumber}|${journeyDate}`;
        if (seen.has(key)) duplicates.add(trainNumber);
        else {
          seen.add(key);
          items.push({ trainNumber, journeyDate });
        }
      };

      if (body.trainNumbers !== undefined) {
        const parsed = parseTrainNumbers(body.trainNumbers);
        invalid.push(...parsed.invalid);
        parsed.duplicates.forEach((d) => duplicates.add(d));
        parsed.valid.forEach((n) => add(n, defaultDate));
      }
      for (const item of body.items ?? []) {
        const token = normaliseTrainToken(item.trainNumber);
        if (!isValidTrainNumber(token)) {
          invalid.push({ input: item.trainNumber, reason: explainInvalidTrainNumber(token) });
          continue;
        }
        const date = item.journeyDate ?? defaultDate;
        const check = checkJourneyDate(date);
        if (!check.ok) {
          invalid.push({ input: `${token} (${date})`, reason: check.reason! });
          continue;
        }
        add(token, date);
      }

      if (items.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'No valid train numbers to track.', { details: { invalid, duplicates: [...duplicates] } });
      }
      if (items.length > MAX_TRAINS_PER_REQUEST) {
        throw new AppError('VALIDATION_ERROR', `Track at most ${MAX_TRAINS_PER_REQUEST} trains per request (got ${items.length}).`);
      }

      const { requestId, results } = await deps.tracking.trackMany(items, {
        forceRefresh: body.forceRefresh,
        userId: req.session?.userId ?? null,
        source: body.source === 'upload' ? 'UPLOAD' : 'MANUAL',
        invalidCount: invalid.length,
      });
      const response: TrackResponse = {
        requestId,
        journeyDate: defaultDate,
        provider: deps.tracking.provider.info,
        results,
        invalid,
        duplicates: [...duplicates],
        summary: {
          requested: items.length + invalid.length,
          valid: items.length,
          ok: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
      };
      res.json(response);
    }),
  );

  router.post(
    '/trains/upload',
    trackLimiter,
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new AppError('VALIDATION_ERROR', 'Attach a .csv, .xlsx or .xls file in the "file" field.');
      const defaultDate = resolveJourneyDate(
        typeof req.body?.journeyDate === 'string' && req.body.journeyDate ? parseBody(journeyDateSchema, req.body.journeyDate) : undefined,
      );
      res.json(buildUploadPreview(req.file.originalname, req.file.buffer, defaultDate));
    }),
  );

  router.get(
    '/trains/:trainNumber',
    trackLimiter,
    asyncHandler(async (req, res) => {
      const trainNumber = parseTrainParam(String(req.params.trainNumber));
      const query = parseBody(TrainQuerySchema, req.query);
      const journeyDate = resolveJourneyDate(query.journeyDate);
      const result = await deps.tracking.getLiveStatus(trainNumber, journeyDate, { forceRefresh: query.refresh });
      if (!result.ok) {
        throw new AppError(result.error!.code, result.error!.message, { retryAfterSeconds: result.error!.retryAfterSeconds });
      }
      res.json(result);
    }),
  );

  router.get(
    '/trains/:trainNumber/route',
    asyncHandler(async (req, res) => {
      const trainNumber = parseTrainParam(String(req.params.trainNumber));
      res.json(await deps.tracking.getRoute(trainNumber));
    }),
  );

  router.get(
    '/trains/:trainNumber/snapshots',
    asyncHandler(async (req, res) => {
      const trainNumber = parseTrainParam(String(req.params.trainNumber));
      const query = parseBody(
        z.object({ journeyDate: journeyDateSchema.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
        req.query,
      );
      res.json({ items: await deps.tracking.snapshots(trainNumber, query.journeyDate ?? todayInIst(), query.limit) });
    }),
  );

  return router;
}
