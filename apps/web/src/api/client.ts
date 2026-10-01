import {
  ApiErrorSchema,
  type AppConfig,
  type EmailReportRequest,
  type EmailReportResult,
  type ErrorCode,
  type LoginRequest,
  type MonitoringCreate,
  type MonitoringPatch,
  type MonitoringSubscription,
  type NormalizedRoute,
  type ProviderHealth,
  type ProviderId,
  type ProviderUsageSummary,
  type RegisterRequest,
  type ReportPreview,
  type ReportPreviewRequest,
  type SharedReport,
  type SnapshotSummary,
  type TrackRequest,
  type TrackResponse,
  type TrackResult,
  type TrackingHistoryItem,
  type UploadPreview,
  type User,
} from '@railtrack/shared';

/** Server error codes plus client-side transport failures. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR';

const API_BASE = `${(import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''}/api`;

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly details: unknown;

  constructor(init: { code: ClientErrorCode; status: number; message: string; retryAfterSeconds?: number | null; details?: unknown }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.details = init.details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Parse a Retry-After header (delta-seconds or HTTP date). */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

function fallbackCode(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'PROVIDER_UNAVAILABLE';
  if (status === 504) return 'TIMEOUT';
  if (status >= 400 && status < 500) return 'VALIDATION_ERROR';
  return 'INTERNAL_ERROR';
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(path: string, query?: Query | URLSearchParams): string {
  const params = query instanceof URLSearchParams ? query : new URLSearchParams();
  if (query && !(query instanceof URLSearchParams)) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query | URLSearchParams;
  body?: unknown;
  signal?: AbortSignal;
}

async function toApiError(res: Response): Promise<ApiError> {
  const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const parsed = ApiErrorSchema.safeParse(payload);
  if (parsed.success) {
    const details = parsed.data.error.details as { retryAfterSeconds?: unknown } | undefined;
    const detailRetry = typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : null;
    return new ApiError({
      code: parsed.data.error.code,
      status: res.status,
      message: parsed.data.error.message,
      retryAfterSeconds: retryAfter ?? detailRetry,
      details: parsed.data.error.details,
    });
  }
  return new ApiError({
    code: fallbackCode(res.status),
    status: res.status,
    message: res.statusText || `Request failed with HTTP ${res.status}`,
    retryAfterSeconds: retryAfter,
  });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, signal } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      credentials: 'include',
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'Could not reach the RailTrack Live server. Check your connection and try again.',
    });
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------------------------------------------------------------- endpoints

export const api = {
  config: (signal?: AbortSignal) => request<AppConfig>('/config', { signal }),

  track: (body: TrackRequest, signal?: AbortSignal) => request<TrackResponse>('/trains/track', { method: 'POST', body, signal }),

  upload: (file: File, journeyDate?: string, signal?: AbortSignal) => {
    const form = new FormData();
    form.append('file', file);
    if (journeyDate) form.append('journeyDate', journeyDate);
    return request<UploadPreview>('/trains/upload', { method: 'POST', body: form, signal });
  },

  train: (trainNumber: string, journeyDate: string, refresh = false, signal?: AbortSignal) =>
    request<TrackResult>(`/trains/${encodeURIComponent(trainNumber)}`, {
      query: { journeyDate, refresh: refresh ? 'true' : undefined },
      signal,
    }),

  route: (trainNumber: string, signal?: AbortSignal) =>
    request<NormalizedRoute>(`/trains/${encodeURIComponent(trainNumber)}/route`, { signal }),

  snapshots: (trainNumber: string, journeyDate: string, limit = 50, signal?: AbortSignal) =>
    request<{ items: SnapshotSummary[] }>(`/trains/${encodeURIComponent(trainNumber)}/snapshots`, {
      query: { journeyDate, limit },
      signal,
    }),

  providerHealth: (signal?: AbortSignal) =>
    request<{ activeProvider: ProviderId; providers: ProviderHealth[] }>('/health/providers', { signal }),

  providerUsage: (hours: number, signal?: AbortSignal) =>
    request<{ items: ProviderUsageSummary[] }>('/admin/provider-usage', { query: { hours }, signal }),

  reportPreview: (body: ReportPreviewRequest) => request<ReportPreview>('/reports/preview', { method: 'POST', body }),
  sendReport: (body: EmailReportRequest) => request<EmailReportResult>('/reports/email', { method: 'POST', body }),
  reports: (params: { limit?: number; kind?: 'REPORT' | 'ALERT' }, signal?: AbortSignal) =>
    request<{ items: EmailReportResult[] }>('/reports', { query: { limit: params.limit ?? 20, kind: params.kind }, signal }),

  shared: (token: string, signal?: AbortSignal) => request<SharedReport>(`/share/${encodeURIComponent(token)}`, { signal }),

  me: (signal?: AbortSignal) => request<{ user: User }>('/auth/me', { signal }),
  login: (body: LoginRequest) => request<{ user: User }>('/auth/login', { method: 'POST', body }),
  register: (body: RegisterRequest) => request<{ user: User }>('/auth/register', { method: 'POST', body }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  history: (params: { limit?: number; cursor?: string | null }, signal?: AbortSignal) =>
    request<{ items: TrackingHistoryItem[]; nextCursor: string | null }>('/tracking/history', {
      query: { limit: params.limit ?? 20, cursor: params.cursor ?? undefined },
      signal,
    }),

  monitoring: (signal?: AbortSignal) => request<{ items: MonitoringSubscription[] }>('/monitoring', { signal }),
  createMonitoring: (body: MonitoringCreate) => request<MonitoringSubscription>('/monitoring', { method: 'POST', body }),
  patchMonitoring: (id: string, body: MonitoringPatch) =>
    request<MonitoringSubscription>(`/monitoring/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  stopMonitoring: (id: string) => request<MonitoringSubscription>(`/monitoring/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** URL of the CSV export endpoint (used as a plain download link). */
export function exportCsvUrl(params: URLSearchParams): string {
  return buildUrl('/tracking/export.csv', params);
}

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
