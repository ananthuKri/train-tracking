import { z } from 'zod';
import {
  ErrorCodeSchema,
  isoInstant,
  journeyDateSchema,
  NormalizedTrainStatusSchema,
  ProviderIdSchema,
  ProviderInfoSchema,
  TrackResultSchema,
  TrainStateSchema,
} from './schemas';
import { MAX_TRAINS_PER_REQUEST, TRAIN_NUMBER_PATTERN } from './trainNumber';
import { REPORT_FIELD_IDS } from './reportFields';

/** Request/response contracts for the HTTP API. Shared so the web client is type-checked against the server. */

export const trainNumberSchema = z
  .string()
  .trim()
  .regex(TRAIN_NUMBER_PATTERN, 'Train number must be exactly 5 digits');

export const emailSchema = z.email('Enter a valid email address').max(254).transform((v) => v.trim().toLowerCase());

export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'ApiError' });
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------- tracking

export const TrackItemInputSchema = z.object({
  trainNumber: z.string().max(32),
  journeyDate: journeyDateSchema.optional(),
});

export const TrackRequestSchema = z
  .object({
    /** "12082, 12627" or ["12082", "12627"]. */
    trainNumbers: z.union([z.string().max(2000), z.array(z.string().max(32)).max(200)]).optional(),
    /** Default journey date for every train (defaults to today in IST). */
    journeyDate: journeyDateSchema.optional(),
    /** Per-train dates, e.g. from an uploaded sheet. */
    items: z.array(TrackItemInputSchema).max(MAX_TRAINS_PER_REQUEST).optional(),
    source: z.enum(['manual', 'upload']).default('manual'),
    /** Skip the short live cache. Still subject to provider rate limits. */
    forceRefresh: z.boolean().default(false),
  })
  .refine((v) => v.trainNumbers !== undefined || (v.items?.length ?? 0) > 0, {
    message: 'Provide trainNumbers or items',
  })
  .meta({ id: 'TrackRequest' });
export type TrackRequest = z.input<typeof TrackRequestSchema>;

export const InvalidTrainInputSchema = z.object({ input: z.string(), reason: z.string() });

export const TrackResponseSchema = z
  .object({
    requestId: z.string().nullable(),
    journeyDate: journeyDateSchema,
    provider: ProviderInfoSchema,
    results: z.array(TrackResultSchema),
    invalid: z.array(InvalidTrainInputSchema),
    duplicates: z.array(z.string()),
    summary: z.object({
      requested: z.number().int(),
      valid: z.number().int(),
      ok: z.number().int(),
      failed: z.number().int(),
    }),
  })
  .meta({ id: 'TrackResponse' });
export type TrackResponse = z.infer<typeof TrackResponseSchema>;

export const TrainQuerySchema = z.object({
  journeyDate: journeyDateSchema.optional(),
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const SnapshotSummarySchema = z
  .object({
    id: z.string(),
    fetchedAt: isoInstant,
    providerUpdatedAt: isoInstant.nullable(),
    provider: ProviderIdSchema,
    isDemo: z.boolean(),
    state: TrainStateSchema,
    delayMinutes: z.number().int().nullable(),
    lastStationCode: z.string().nullable(),
    nextStationCode: z.string().nullable(),
    progressPercent: z.number().nullable(),
    positionKind: z.enum(['reported', 'estimated']).nullable(),
  })
  .meta({ id: 'SnapshotSummary' });
export type SnapshotSummary = z.infer<typeof SnapshotSummarySchema>;

export const TrackingHistoryItemSchema = z
  .object({
    id: z.string(),
    createdAt: isoInstant,
    source: z.enum(['MANUAL', 'UPLOAD', 'MONITORING', 'API']),
    provider: z.string(),
    items: z.array(
      z.object({
        trainNumber: z.string(),
        journeyDate: z.string(),
        ok: z.boolean(),
        errorCode: z.string().nullable(),
      }),
    ),
    summary: z.object({ valid: z.number().int(), invalid: z.number().int(), ok: z.number().int(), failed: z.number().int() }),
  })
  .meta({ id: 'TrackingHistoryItem' });
export type TrackingHistoryItem = z.infer<typeof TrackingHistoryItemSchema>;

// ---------------------------------------------------------------- upload

export const UploadPreviewRowSchema = z
  .object({
    /** Row number as shown in a spreadsheet app (header = row 1). */
    rowNumber: z.number().int(),
    rawTrainNumber: z.string(),
    trainNumber: z.string().nullable(),
    rawJourneyDate: z.string(),
    journeyDate: z.string().nullable(),
    rawEmail: z.string(),
    email: z.string().nullable(),
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .meta({ id: 'UploadPreviewRow' });
export type UploadPreviewRow = z.infer<typeof UploadPreviewRowSchema>;

export const UploadPreviewSchema = z
  .object({
    fileName: z.string(),
    fileType: z.enum(['csv', 'xlsx', 'xls']),
    sheetName: z.string().nullable(),
    detectedColumns: z.object({
      trainNumber: z.string().nullable(),
      journeyDate: z.string().nullable(),
      email: z.string().nullable(),
    }),
    defaultJourneyDate: journeyDateSchema,
    rows: z.array(UploadPreviewRowSchema),
    summary: z.object({
      total: z.number().int(),
      valid: z.number().int(),
      invalid: z.number().int(),
      duplicates: z.number().int(),
      truncated: z.boolean(),
    }),
  })
  .meta({ id: 'UploadPreview' });
export type UploadPreview = z.infer<typeof UploadPreviewSchema>;

// ---------------------------------------------------------------- reports

export const ReportFieldSchema = z.enum(REPORT_FIELD_IDS);

export const ReportTrainRefSchema = z.object({
  trainNumber: trainNumberSchema,
  journeyDate: journeyDateSchema,
});
export type ReportTrainRef = z.infer<typeof ReportTrainRefSchema>;

export const EmailReportRequestSchema = z
  .object({
    recipients: z.array(emailSchema).min(1, 'Add at least one recipient').max(20),
    /** Omit (or send every field) for the default "full report". */
    fields: z.array(ReportFieldSchema).min(1).optional(),
    trains: z.array(ReportTrainRefSchema).min(1).max(MAX_TRAINS_PER_REQUEST),
    /** A public, expiring, read-only link is only created when this is explicitly true. */
    includeShareLink: z.boolean().default(false),
    subject: z.string().trim().max(150).optional(),
    message: z.string().trim().max(1000).optional(),
  })
  .meta({ id: 'EmailReportRequest' });
export type EmailReportRequest = z.input<typeof EmailReportRequestSchema>;

export const ReportPreviewRequestSchema = EmailReportRequestSchema.omit({ recipients: true }).meta({
  id: 'ReportPreviewRequest',
});
export type ReportPreviewRequest = z.input<typeof ReportPreviewRequestSchema>;

export const ReportPreviewSchema = z
  .object({ subject: z.string(), html: z.string(), csv: z.string(), csvFileName: z.string() })
  .meta({ id: 'ReportPreview' });
export type ReportPreview = z.infer<typeof ReportPreviewSchema>;

export const EMAIL_STATUSES = ['QUEUED', 'SENT', 'PARTIAL', 'FAILED'] as const;
export const EmailReportResultSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['REPORT', 'ALERT']),
    status: z.enum(EMAIL_STATUSES),
    subject: z.string(),
    fields: z.array(ReportFieldSchema),
    trains: z.array(ReportTrainRefSchema),
    recipients: z.array(
      z.object({
        email: z.string(),
        status: z.enum(['QUEUED', 'SENT', 'FAILED']),
        error: z.string().nullable(),
      }),
    ),
    shareUrl: z.string().nullable(),
    shareExpiresAt: isoInstant.nullable(),
    error: z.string().nullable(),
    delivery: z.enum(['smtp', 'outbox']),
    createdAt: isoInstant,
  })
  .meta({ id: 'EmailReportResult' });
export type EmailReportResult = z.infer<typeof EmailReportResultSchema>;

export const SharedReportSchema = z
  .object({
    id: z.string(),
    createdAt: isoInstant,
    expiresAt: isoInstant,
    fields: z.array(ReportFieldSchema),
    trains: z.array(NormalizedTrainStatusSchema),
  })
  .meta({ id: 'SharedReport' });
export type SharedReport = z.infer<typeof SharedReportSchema>;

// ---------------------------------------------------------------- monitoring

export const MONITORING_MIN_INTERVAL_MINUTES = 10;
export const MONITORING_MAX_INTERVAL_MINUTES = 120;
export const MONITORING_DEFAULT_INTERVAL_MINUTES = 15;

export const AlertRulesSchema = z
  .object({
    /** Email when the train reaches (arrives at or passes) its next station. */
    nextStation: z.boolean().default(false),
    /** Email when delay rises above this many minutes (null = off). */
    delayAboveMinutes: z.number().int().min(1).max(1440).nullable().default(null),
    /** Email on diversion, cancellation or reschedule. */
    exceptions: z.boolean().default(true),
    /** Email when the train arrives at its destination. */
    arrival: z.boolean().default(true),
  })
  .refine((r) => r.nextStation || r.exceptions || r.arrival || r.delayAboveMinutes !== null, {
    message: 'Enable at least one alert rule',
  })
  .meta({ id: 'AlertRules' });
export type AlertRules = z.infer<typeof AlertRulesSchema>;

const intervalSchema = z
  .number()
  .int()
  .min(MONITORING_MIN_INTERVAL_MINUTES)
  .max(MONITORING_MAX_INTERVAL_MINUTES);

export const MonitoringCreateSchema = z
  .object({
    trainNumber: trainNumberSchema,
    journeyDate: journeyDateSchema.optional(),
    intervalMinutes: intervalSchema.default(MONITORING_DEFAULT_INTERVAL_MINUTES),
    rules: AlertRulesSchema,
    recipients: z.array(emailSchema).min(1).max(10),
  })
  .meta({ id: 'MonitoringCreate' });
export type MonitoringCreate = z.input<typeof MonitoringCreateSchema>;

export const MonitoringPatchSchema = z
  .object({
    action: z.enum(['pause', 'resume']).optional(),
    intervalMinutes: intervalSchema.optional(),
    rules: AlertRulesSchema.optional(),
    recipients: z.array(emailSchema).min(1).max(10).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' })
  .meta({ id: 'MonitoringPatch' });
export type MonitoringPatch = z.input<typeof MonitoringPatchSchema>;

export const MONITORING_STATUSES = ['ACTIVE', 'PAUSED', 'STOPPED', 'COMPLETED', 'ERROR'] as const;
export const MonitoringSubscriptionSchema = z
  .object({
    id: z.string(),
    trainNumber: z.string(),
    journeyDate: z.string(),
    trainName: z.string().nullable(),
    intervalMinutes: z.number().int(),
    rules: AlertRulesSchema,
    recipients: z.array(z.string()),
    status: z.enum(MONITORING_STATUSES),
    lastCheckedAt: isoInstant.nullable(),
    lastAlertAt: isoInstant.nullable(),
    nextCheckAt: isoInstant.nullable(),
    alertCount: z.number().int(),
    lastError: z.string().nullable(),
    lastKnown: z
      .object({
        state: TrainStateSchema,
        delayMinutes: z.number().int().nullable(),
        lastStationCode: z.string().nullable(),
        nextStationCode: z.string().nullable(),
        isDemo: z.boolean(),
      })
      .nullable(),
    createdAt: isoInstant,
  })
  .meta({ id: 'MonitoringSubscription' });
export type MonitoringSubscription = z.infer<typeof MonitoringSubscriptionSchema>;

// ---------------------------------------------------------------- auth

export const RegisterRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(10, 'Use at least 10 characters').max(200),
    name: z.string().trim().max(100).optional(),
  })
  .meta({ id: 'RegisterRequest' });
export type RegisterRequest = z.input<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(200) })
  .meta({ id: 'LoginRequest' });
export type LoginRequest = z.input<typeof LoginRequestSchema>;

export const UserSchema = z
  .object({ id: z.string(), email: z.string(), name: z.string().nullable(), role: z.enum(['USER', 'ADMIN']) })
  .meta({ id: 'User' });
export type User = z.infer<typeof UserSchema>;

// ---------------------------------------------------------------- config / admin

export const AppConfigSchema = z
  .object({
    activeProvider: ProviderInfoSchema,
    demoMode: z.boolean(),
    map: z.object({
      provider: z.enum(['osm', 'mapbox']),
      tileUrl: z.string(),
      attribution: z.string(),
      maxZoom: z.number().int(),
    }),
    limits: z.object({
      maxTrainsPerRequest: z.number().int(),
      maxUploadRows: z.number().int(),
      maxUploadBytes: z.number().int(),
      monitoring: z.object({
        minIntervalMinutes: z.number().int(),
        maxIntervalMinutes: z.number().int(),
        defaultIntervalMinutes: z.number().int(),
      }),
    }),
    features: z.object({ email: z.boolean(), monitoring: z.boolean(), shareLinks: z.boolean() }),
  })
  .meta({ id: 'AppConfig' });
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const ProviderUsageSummarySchema = z
  .object({
    provider: z.string(),
    windowHours: z.number().int(),
    total: z.number().int(),
    success: z.number().int(),
    errors: z.number().int(),
    rateLimited: z.number().int(),
    avgLatencyMs: z.number().nullable(),
    lastError: z.string().nullable(),
    lastErrorAt: isoInstant.nullable(),
  })
  .meta({ id: 'ProviderUsageSummary' });
export type ProviderUsageSummary = z.infer<typeof ProviderUsageSummarySchema>;
