import { z } from 'zod';
import * as shared from '@railtrack/shared';

/**
 * OpenAPI 3.1 document. Component schemas are generated from the shared Zod contract
 * (every schema registered with `.meta({ id })`), so docs cannot drift from validation.
 */

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });
const json = (schema: object, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [String(c), json(ref('ApiError'), ERROR_DESCRIPTIONS[c] ?? 'Error')]));
const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Validation error',
  401: 'Not signed in',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported file',
  429: 'Rate limited (see Retry-After)',
  502: 'Provider rejected credentials',
  503: 'Provider / dependency unavailable',
  504: 'Provider timeout',
};

const COMPONENT = '#/components/schemas/';

type JsonSchemaMap = Record<string, Record<string, unknown>>;

/**
 * Build component schemas for both directions. Request schemas with defaults/transforms differ between
 * their input and output shapes; those get an extra `<Id>Input` component used by request bodies.
 */
function buildComponents(): { schemas: JsonSchemaMap; inputIds: Set<string> } {
  const convert = (io: 'input' | 'output', suffix: string) => {
    const result = z.toJSONSchema(z.globalRegistry, { io, unrepresentable: 'any', uri: (id) => `${COMPONENT}${id}${suffix}` }) as {
      schemas: JsonSchemaMap;
    };
    return Object.fromEntries(
      Object.entries(result.schemas).map(([id, s]) => {
        const { $schema: _s, $id: _sid, id: _id, ...rest } = s;
        return [id, rest];
      }),
    ) as JsonSchemaMap;
  };
  const output = convert('output', '');
  const input = convert('input', 'Input');
  // Output schemas add `additionalProperties: false`; that alone is not a meaningful difference.
  const comparable = (s: unknown) =>
    JSON.stringify(s, (key, value: unknown) => (key === 'additionalProperties' ? undefined : value)).replace(/Input"/g, '"');
  const inputIds = new Set(Object.keys(input).filter((id) => comparable(input[id]) !== comparable(output[id])));
  const schemas: JsonSchemaMap = { ...output };
  for (const id of inputIds) {
    // Point nested refs at the input variant only where one exists.
    const text = JSON.stringify(input[id]).replace(/#\/components\/schemas\/(\w+?)Input"/g, (_m, ref: string) =>
      inputIds.has(ref) ? `${COMPONENT}${ref}Input"` : `${COMPONENT}${ref}"`,
    );
    schemas[`${id}Input`] = JSON.parse(text) as Record<string, unknown>;
  }
  return { schemas, inputIds };
}

const components = buildComponents();

const body = (schema: z.ZodType) => {
  const id = z.globalRegistry.get(schema)?.id;
  if (!id) throw new Error('Request schemas must be registered with .meta({ id })');
  return { required: true, content: { 'application/json': { schema: ref(components.inputIds.has(id) ? `${id}Input` : id) } } };
};
const trainParam = { name: 'trainNumber', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{5}$' }, example: '12082' };
const dateQuery = { name: 'journeyDate', in: 'query', required: false, schema: { type: 'string', format: 'date' }, description: 'Journey start date (IST). Defaults to today.' };
const cookieAuth = [{ sessionCookie: [] }];

export function buildOpenApiDocument(serverUrl = '/'): Record<string, unknown> {
  const schemas = components.schemas;
  return {
    openapi: '3.1.0',
    info: {
      title: 'RailTrack Live API',
      version: '1.0.0',
      description:
        'Track Indian Railways trains through licensed third-party providers. All instants are UTC ISO-8601; journey dates are IST calendar dates. ' +
        'Responses always carry the data provider, freshness and whether positions are reported or estimated. Demo-mode responses have provider.isDemo = true.',
    },
    servers: [{ url: serverUrl }],
    components: {
      schemas,
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'rt_session', description: 'httpOnly session cookie set by /api/auth/login' },
      },
    },
    tags: [
      { name: 'Trains' },
      { name: 'Tracking' },
      { name: 'Reports' },
      { name: 'Monitoring' },
      { name: 'Auth' },
      { name: 'System' },
    ],
    paths: {
      '/api/trains/track': {
        post: {
          tags: ['Trains'],
          summary: 'Track one or many trains (max 50)',
          description: 'Validates and de-duplicates train numbers, then fetches each train with provider-safe concurrency. Per-train failures are reported in results[].error.',
          requestBody: body(shared.TrackRequestSchema),
          responses: { 200: json(ref('TrackResponse')), ...errors(400, 429) },
        },
      },
      '/api/trains/upload': {
        post: {
          tags: ['Trains'],
          summary: 'Preview a CSV/XLSX/XLS upload (does not track)',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: { type: 'string', format: 'binary', description: 'Columns: train_number|train_no|trainNumber, optional journey_date, optional email' },
                    journeyDate: { type: 'string', format: 'date', description: 'Default date for rows without one' },
                  },
                },
              },
            },
          },
          responses: { 200: json(ref('UploadPreview')), ...errors(400, 413, 415, 429) },
        },
      },
      '/api/trains/{trainNumber}': {
        get: {
          tags: ['Trains'],
          summary: 'Live status of one train',
          parameters: [trainParam, dateQuery, { name: 'refresh', in: 'query', schema: { type: 'boolean' }, description: 'Bypass the short live cache (min 30 s)' }],
          responses: { 200: json(ref('TrackResult')), ...errors(400, 404, 429, 502, 503, 504) },
        },
      },
      '/api/trains/{trainNumber}/route': {
        get: { tags: ['Trains'], summary: 'Static route / timetable (cached)', parameters: [trainParam], responses: { 200: json(ref('NormalizedRoute')), ...errors(400, 404, 429, 503) } },
      },
      '/api/trains/{trainNumber}/snapshots': {
        get: {
          tags: ['Trains'],
          summary: 'History of verified fetches for a journey',
          parameters: [trainParam, dateQuery, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } }],
          responses: { 200: json({ type: 'object', properties: { items: { type: 'array', items: ref('SnapshotSummary') } } }) },
        },
      },
      '/api/tracking/history': {
        get: {
          tags: ['Tracking'],
          summary: "Signed-in user's tracking requests",
          security: cookieAuth,
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: json({ type: 'object', properties: { items: { type: 'array', items: ref('TrackingHistoryItem') }, nextCursor: { type: ['string', 'null'] } } }),
            ...errors(401),
          },
        },
      },
      '/api/tracking/export.csv': {
        get: {
          tags: ['Tracking'],
          summary: 'Export trains (filtered and sorted) as CSV',
          parameters: [
            { name: 'trains', in: 'query', schema: { type: 'string' }, example: '12082:2026-10-01,12627', description: 'Comma-separated trainNumber[:journeyDate]' },
            { name: 'requestId', in: 'query', schema: { type: 'string' } },
            { name: 'fields', in: 'query', schema: { type: 'string' }, description: `Comma-separated: ${shared.REPORT_FIELD_IDS.join(', ')}` },
            { name: 'statuses', in: 'query', schema: { type: 'string' }, description: `Comma-separated: ${shared.TRAIN_STATES.join(', ')}` },
            { name: 'minDelay', in: 'query', schema: { type: 'integer' } },
            { name: 'maxDelay', in: 'query', schema: { type: 'integer' } },
            { name: 'station', in: 'query', schema: { type: 'string' } },
            { name: 'source', in: 'query', schema: { type: 'string' } },
            { name: 'destination', in: 'query', schema: { type: 'string' } },
            { name: 'updatedWithinMinutes', in: 'query', schema: { type: 'integer' } },
            { name: 'providers', in: 'query', schema: { type: 'string' } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: [...shared.SORT_KEYS] } },
          ],
          responses: { 200: { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } }, ...errors(400, 429) },
        },
      },
      '/api/reports/preview': {
        post: { tags: ['Reports'], summary: 'Render the report email + CSV without sending', requestBody: body(shared.ReportPreviewRequestSchema), responses: { 200: json(ref('ReportPreview')), ...errors(400, 429) } },
      },
      '/api/reports/email': {
        post: {
          tags: ['Reports'],
          summary: 'Email a report (HTML + CSV attachment) to recipients',
          description: 'One message per recipient. A public share link is created only when includeShareLink is true. Every send is recorded for audit.',
          security: cookieAuth,
          requestBody: body(shared.EmailReportRequestSchema),
          responses: { 201: json(ref('EmailReportResult'), 'Created'), ...errors(400, 401, 429, 503) },
        },
      },
      '/api/reports': {
        get: {
          tags: ['Reports'],
          summary: 'Email audit history',
          security: cookieAuth,
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['REPORT', 'ALERT'] } },
          ],
          responses: { 200: json({ type: 'object', properties: { items: { type: 'array', items: ref('EmailReportResult') } } }), ...errors(401) },
        },
      },
      '/api/share/{token}': {
        get: {
          tags: ['Reports'],
          summary: 'Public read-only shared report',
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: json(ref('SharedReport')), ...errors(404) },
        },
      },
      '/api/monitoring': {
        get: {
          tags: ['Monitoring'],
          summary: 'List monitoring subscriptions',
          security: cookieAuth,
          responses: { 200: json({ type: 'object', properties: { items: { type: 'array', items: ref('MonitoringSubscription') } } }), ...errors(401) },
        },
        post: {
          tags: ['Monitoring'],
          summary: 'Start monitoring a train (server-side scheduled checks)',
          security: cookieAuth,
          requestBody: body(shared.MonitoringCreateSchema),
          responses: { 201: json(ref('MonitoringSubscription'), 'Created'), ...errors(400, 401, 404, 409, 503) },
        },
      },
      '/api/monitoring/{id}': {
        patch: {
          tags: ['Monitoring'],
          summary: 'Pause, resume or edit a subscription',
          security: cookieAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: body(shared.MonitoringPatchSchema),
          responses: { 200: json(ref('MonitoringSubscription')), ...errors(400, 401, 404, 409, 503) },
        },
        delete: {
          tags: ['Monitoring'],
          summary: 'Stop a subscription',
          security: cookieAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: json(ref('MonitoringSubscription')), ...errors(401, 404) },
        },
      },
      '/api/health/providers': {
        get: {
          tags: ['System'],
          summary: 'Provider health (cached 5 min; admins may pass force=true)',
          parameters: [{ name: 'force', in: 'query', schema: { type: 'boolean' } }],
          responses: { 200: json({ type: 'object', properties: { activeProvider: { type: 'string' }, providers: { type: 'array', items: ref('ProviderHealth') } } }) },
        },
      },
      '/api/health': { get: { tags: ['System'], summary: 'Liveness and dependency status', responses: { 200: { description: 'Healthy' }, 503: { description: 'Degraded' } } } },
      '/api/config': { get: { tags: ['System'], summary: 'Public client configuration', responses: { 200: json(ref('AppConfig')) } } },
      '/api/admin/provider-usage': {
        get: {
          tags: ['System'],
          summary: 'Provider call statistics (admins)',
          security: cookieAuth,
          parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer' } }],
          responses: { 200: json({ type: 'object', properties: { items: { type: 'array', items: ref('ProviderUsageSummary') } } }), ...errors(401, 403) },
        },
      },
      '/api/auth/register': {
        post: { tags: ['Auth'], summary: 'Create an account', requestBody: body(shared.RegisterRequestSchema), responses: { 201: json({ type: 'object', properties: { user: ref('User') } }), ...errors(400, 409, 429) } },
      },
      '/api/auth/login': {
        post: { tags: ['Auth'], summary: 'Sign in (sets httpOnly cookie)', requestBody: body(shared.LoginRequestSchema), responses: { 200: json({ type: 'object', properties: { user: ref('User') } }), ...errors(400, 401, 429) } },
      },
      '/api/auth/logout': { post: { tags: ['Auth'], summary: 'Sign out', responses: { 204: { description: 'Signed out' } } } },
      '/api/auth/me': { get: { tags: ['Auth'], summary: 'Current user', security: cookieAuth, responses: { 200: json({ type: 'object', properties: { user: ref('User') } }), ...errors(401) } } },
    },
  };
}
