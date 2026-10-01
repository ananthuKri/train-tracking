import { z } from 'zod';

/**
 * The normalised train-data model. Provider adapters translate their own payloads into
 * these shapes; the frontend, exports and email reports only ever see this model.
 */

export const isoInstant = z.iso.datetime({ offset: true });
export const journeyDateSchema = z.iso.date();

export const PROVIDER_IDS = ['railyatri', 'whereismytrain', 'railradar', 'railkit', 'indianrailapi', 'mock'] as const;
export const ProviderIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * Journey-level state.
 *  - not_started: has not left its origin yet
 *  - departed:    in transit; the latest reported event is a departure from a station
 *  - running:     in transit; the latest reported event is an arrival/halt at (or pass of) an intermediate station
 *  - arrived:     reached its destination
 *  - cancelled:   fully cancelled for this journey date
 *  - diverted:    running on a diverted route (persists until arrival)
 *  - rescheduled: departure rescheduled and the train has not left yet
 *  - unavailable: no trustworthy live data from the provider
 */
export const TRAIN_STATES = [
  'not_started',
  'departed',
  'running',
  'arrived',
  'cancelled',
  'diverted',
  'rescheduled',
  'unavailable',
] as const;
export const TrainStateSchema = z.enum(TRAIN_STATES);
export type TrainState = z.infer<typeof TrainStateSchema>;

export const StationRefSchema = z
  .object({
    code: z.string().min(1),
    name: z.string(),
  })
  .meta({ id: 'StationRef' });
export type StationRef = z.infer<typeof StationRefSchema>;

export const STOP_STATUSES = ['departed', 'arrived', 'current', 'upcoming', 'skipped', 'cancelled', 'diverted'] as const;
export const StopStatusSchema = z.enum(STOP_STATUSES);
export type StopStatus = z.infer<typeof StopStatusSchema>;

export const NormalizedStopSchema = z
  .object({
    sequence: z.number().int().min(1),
    stationCode: z.string(),
    stationName: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    /** Distance from the origin station along the route. */
    distanceKm: z.number().nullable(),
    /** Journey day number (1 = journey date). */
    day: z.number().int().nullable(),
    platform: z.string().nullable(),
    /** false for stations the train passes without a scheduled halt. */
    isHalt: z.boolean(),
    scheduledArrival: isoInstant.nullable(),
    scheduledDeparture: isoInstant.nullable(),
    /** Reported actual times (only for events that already happened). */
    actualArrival: isoInstant.nullable(),
    actualDeparture: isoInstant.nullable(),
    /** Provider ETA/ETD for stations not reached yet. */
    expectedArrival: isoInstant.nullable(),
    expectedDeparture: isoInstant.nullable(),
    arrivalDelayMinutes: z.number().int().nullable(),
    departureDelayMinutes: z.number().int().nullable(),
    status: StopStatusSchema,
  })
  .meta({ id: 'NormalizedStop' });
export type NormalizedStop = z.infer<typeof NormalizedStopSchema>;

export const EXCEPTION_TYPES = [
  'cancellation',
  'partial_cancellation',
  'diversion',
  'reschedule',
  'skipped_stop',
  'short_termination',
  'short_origination',
  'other',
] as const;
export const TrainExceptionSchema = z
  .object({
    type: z.enum(EXCEPTION_TYPES),
    message: z.string(),
    stationCodes: z.array(z.string()),
    rescheduledByMinutes: z.number().int().nullable(),
  })
  .meta({ id: 'TrainException' });
export type TrainException = z.infer<typeof TrainExceptionSchema>;

export const POSITION_KINDS = ['reported', 'estimated'] as const;
export const PositionSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
    /**
     * reported  = coordinate supplied by the data provider.
     * estimated = interpolated by RailTrack Live between the last reported and next station. NOT GPS.
     */
    kind: z.enum(POSITION_KINDS),
    /** Plain-language explanation of where the coordinate came from. */
    basis: z.string(),
    segment: z
      .object({
        fromCode: z.string(),
        toCode: z.string(),
        fraction: z.number().min(0).max(1),
      })
      .nullable(),
    computedAt: isoInstant,
  })
  .meta({ id: 'TrainPosition' });
export type TrainPosition = z.infer<typeof PositionSchema>;

export const ProviderInfoSchema = z
  .object({
    id: ProviderIdSchema,
    name: z.string(),
    /** True for the built-in simulator. The UI must label such data "DEMO DATA". */
    isDemo: z.boolean(),
    attribution: z.string().nullable(),
  })
  .meta({ id: 'ProviderInfo' });
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

/**
 * live   = fetched from the provider for this response
 * cached = served from the short-lived cache (still within the provider-safe TTL)
 * stale  = provider currently failing; this is the last verified result, see `notice`
 */
export const FRESHNESS = ['live', 'cached', 'stale'] as const;
export const FreshnessSchema = z.enum(FRESHNESS);
export type Freshness = z.infer<typeof FreshnessSchema>;

export const LAST_EVENTS = ['arrived', 'departed', 'passed'] as const;

export const NormalizedTrainStatusSchema = z
  .object({
    trainNumber: z.string(),
    trainName: z.string(),
    journeyDate: journeyDateSchema,
    source: StationRefSchema,
    destination: StationRefSchema,
    scheduledDeparture: isoInstant.nullable(),
    scheduledArrival: isoInstant.nullable(),
    actualDeparture: isoInstant.nullable(),
    actualArrival: isoInstant.nullable(),
    expectedArrival: isoInstant.nullable(),
    state: TrainStateSchema,
    /** Provider's own human-readable status line, if any. */
    stateDetail: z.string().nullable(),
    /** Current / last reported station. */
    lastReportedStation: StationRefSchema.nullable(),
    lastReportedEvent: z.enum(LAST_EVENTS).nullable(),
    lastReportedAt: isoInstant.nullable(),
    previousStation: StationRefSchema.nullable(),
    nextStation: StationRefSchema.nullable(),
    nextStationEta: isoInstant.nullable(),
    /** Positive = late, negative = early, null = unknown. */
    delayMinutes: z.number().int().nullable(),
    platform: z.string().nullable(),
    distanceTravelledKm: z.number().nullable(),
    distanceRemainingKm: z.number().nullable(),
    totalDistanceKm: z.number().nullable(),
    progressPercent: z.number().min(0).max(100).nullable(),
    position: PositionSchema.nullable(),
    stops: z.array(NormalizedStopSchema),
    exceptions: z.array(TrainExceptionSchema),
    provider: ProviderInfoSchema,
    /** When the provider says the data was last updated (if it says). */
    providerUpdatedAt: isoInstant.nullable(),
    /** When RailTrack Live fetched this from the provider. */
    fetchedAt: isoInstant,
    freshness: FreshnessSchema,
    /** Plain-language caveat shown next to the data, e.g. when serving the last verified result. */
    notice: z.string().nullable(),
  })
  .meta({ id: 'NormalizedTrainStatus' });
export type NormalizedTrainStatus = z.infer<typeof NormalizedTrainStatusSchema>;

export const RouteStopSchema = z
  .object({
    sequence: z.number().int().min(1),
    stationCode: z.string(),
    stationName: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    distanceKm: z.number().nullable(),
    day: z.number().int().nullable(),
    /** IST wall-clock "HH:mm". */
    scheduledArrival: z.string().nullable(),
    scheduledDeparture: z.string().nullable(),
    haltMinutes: z.number().int().nullable(),
    isHalt: z.boolean(),
    platform: z.string().nullable(),
  })
  .meta({ id: 'RouteStop' });
export type RouteStop = z.infer<typeof RouteStopSchema>;

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export const NormalizedRouteSchema = z
  .object({
    trainNumber: z.string(),
    trainName: z.string(),
    source: StationRefSchema,
    destination: StationRefSchema,
    stops: z.array(RouteStopSchema),
    runningDays: z.array(z.enum(WEEKDAYS)).nullable(),
    totalDistanceKm: z.number().nullable(),
    provider: ProviderInfoSchema,
    fetchedAt: isoInstant,
  })
  .meta({ id: 'NormalizedRoute' });
export type NormalizedRoute = z.infer<typeof NormalizedRouteSchema>;

export const PROVIDER_HEALTH_STATUSES = ['up', 'degraded', 'down', 'not_configured'] as const;
export const ProviderHealthSchema = z
  .object({
    provider: ProviderIdSchema,
    name: z.string(),
    active: z.boolean(),
    configured: z.boolean(),
    isDemo: z.boolean(),
    status: z.enum(PROVIDER_HEALTH_STATUSES),
    latencyMs: z.number().nullable(),
    checkedAt: isoInstant,
    message: z.string().nullable(),
    docsUrl: z.string().nullable(),
    limits: z.object({
      maxConcurrent: z.number().int(),
      minIntervalMs: z.number().int(),
      liveCacheSeconds: z.number().int(),
      routeCacheSeconds: z.number().int(),
      minPollMinutes: z.number().int(),
    }),
  })
  .meta({ id: 'ProviderHealth' });
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_TRAIN_NUMBER',
  'TRAIN_NOT_FOUND',
  'NOT_RUNNING_ON_DATE',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_AUTH_FAILED',
  'TIMEOUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'EMAIL_NOT_CONFIGURED',
  'MONITORING_UNAVAILABLE',
  'DATABASE_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_FILE',
  'INTERNAL_ERROR',
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const TrackErrorSchema = z
  .object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryAfterSeconds: z.number().int().nullable(),
  })
  .meta({ id: 'TrackError' });
export type TrackError = z.infer<typeof TrackErrorSchema>;

export const TrackResultSchema = z
  .object({
    trainNumber: z.string(),
    journeyDate: journeyDateSchema,
    /** True when `status` holds usable data (live, cached or last verified). */
    ok: z.boolean(),
    status: NormalizedTrainStatusSchema.nullable(),
    /** Set when the provider failed — even if a last verified `status` is still returned. */
    error: TrackErrorSchema.nullable(),
  })
  .meta({ id: 'TrackResult' });
export type TrackResult = z.infer<typeof TrackResultSchema>;
