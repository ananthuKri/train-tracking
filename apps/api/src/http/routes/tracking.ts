import { Router } from 'express';
import { z } from 'zod';
import {
  buildReportTable,
  CSV_BOM,
  filterResults,
  isValidTrainNumber,
  MAX_TRAINS_PER_REQUEST,
  REPORT_FIELD_IDS,
  sortResults,
  toCsv,
  todayInIst,
  TrainFiltersQuerySchema,
  type CsvCell,
  type ReportFieldId,
  type TrackingHistoryItem,
  type TrackResult,
} from '@railtrack/shared';
import type { AppDeps } from '../../container.ts';
import { AppError } from '../../lib/errors.ts';
import { requireDb } from '../../lib/prisma.ts';
import { trainPageUrl } from '../../services/reportBuilder.ts';
import { asyncHandler, parseBody, requireAuth, type RateLimitFactory } from '../middleware/index.ts';
import { resolveJourneyDate } from './trains.ts';

const ExportQuerySchema = TrainFiltersQuerySchema.extend({
  /** "12082:2026-10-01,12627" — date defaults to today (IST). */
  trains: z.string().max(2000).optional(),
  requestId: z.string().max(40).optional(),
  fields: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((f) => f.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(REPORT_FIELD_IDS)).optional()),
});

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(40).optional(),
});

export function trackingRouter(deps: AppDeps, limit: RateLimitFactory): Router {
  const router = Router();
  const exportLimiter = limit('export', { windowMs: 60_000, limit: 20 });

  router.get(
    '/tracking/history',
    requireAuth(deps.auth),
    asyncHandler(async (req, res) => {
      const db = requireDb(deps.db);
      const query = parseBody(HistoryQuerySchema, req.query);
      const rows = await db.trackingRequest.findMany({
        where: { userId: req.user!.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      const items: TrackingHistoryItem[] = page.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        source: r.source,
        provider: r.provider,
        items: (r.items as TrackingHistoryItem['items']) ?? [],
        summary: { valid: r.validCount, invalid: r.invalidCount, ok: r.successCount, failed: r.failureCount },
      }));
      res.json({ items, nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null });
    }),
  );

  router.get(
    '/tracking/export.csv',
    exportLimiter,
    asyncHandler(async (req, res) => {
      const query = parseBody(ExportQuerySchema, req.query);
      const items = await resolveExportItems(deps, query.trains, query.requestId, req.session?.userId ?? null);
      const results = await deps.tracking.fetchMany(items);
      const { sort, trains: _t, requestId: _r, fields, ...filters } = query;
      const selected = sortResults(filterResults(results, filters), sort ?? 'latest_update');
      const csv = exportCsv(selected, fields ?? [...REPORT_FIELD_IDS], deps.config.APP_BASE_URL);
      res
        .status(200)
        .set({
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="railtrack-export-${todayInIst()}.csv"`,
          'Cache-Control': 'no-store',
        })
        .send(csv);
    }),
  );

  return router;
}

async function resolveExportItems(deps: AppDeps, trains: string | undefined, requestId: string | undefined, userId: string | null) {
  if (requestId) {
    const db = requireDb(deps.db);
    const request = await db.trackingRequest.findUnique({ where: { id: requestId } });
    if (!request || (request.userId && request.userId !== userId)) throw new AppError('NOT_FOUND', 'Tracking request not found');
    return ((request.items as { trainNumber: string; journeyDate: string }[]) ?? []).map((i) => ({ trainNumber: i.trainNumber, journeyDate: i.journeyDate }));
  }
  if (!trains) throw new AppError('VALIDATION_ERROR', 'Provide trains (e.g. trains=12082:2026-10-01,12627) or requestId');
  const items = trains
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token) => {
      const [trainNumber = '', date] = token.split(':');
      if (!isValidTrainNumber(trainNumber)) throw new AppError('INVALID_TRAIN_NUMBER', `Invalid train number "${trainNumber}"`);
      return { trainNumber, journeyDate: resolveJourneyDate(date || undefined) };
    });
  const unique = [...new Map(items.map((i) => [`${i.trainNumber}|${i.journeyDate}`, i])).values()];
  if (unique.length > MAX_TRAINS_PER_REQUEST) throw new AppError('VALIDATION_ERROR', `Export at most ${MAX_TRAINS_PER_REQUEST} trains at once`);
  return unique;
}

/** One row per train; failed trains are kept with a "Data Status" explaining why fields are empty. */
export function exportCsv(results: TrackResult[], fields: ReportFieldId[], appBaseUrl: string): string {
  const ok = results.filter((r) => r.status);
  const table = buildReportTable(
    ok.map((r) => r.status!),
    fields,
    { mapLink: (s) => trainPageUrl(appBaseUrl, s) },
  );
  const headers = [...table.headers, 'Data Status'];
  const rows: CsvCell[][] = table.rows.map((row, i) => {
    const r = ok[i]!;
    const status = r.status!.provider.isDemo ? 'DEMO DATA' : r.status!.freshness === 'stale' ? 'Last verified (live data unavailable)' : 'OK';
    return [...row, status];
  });
  for (const r of results.filter((x) => !x.status)) {
    rows.push([r.trainNumber, ...new Array(table.headers.length - 1).fill(''), `Unavailable: ${r.error?.message ?? 'no data'}`]);
  }
  return CSV_BOM + toCsv(headers, rows);
}
