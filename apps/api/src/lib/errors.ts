import type { ErrorCode } from '@railtrack/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_TRAIN_NUMBER: 400,
  TRAIN_NOT_FOUND: 404,
  NOT_RUNNING_ON_DATE: 404,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_AUTH_FAILED: 502,
  TIMEOUT: 504,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_NOT_CONFIGURED: 503,
  MONITORING_UNAVAILABLE: 503,
  DATABASE_UNAVAILABLE: 503,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  INTERNAL_ERROR: 500,
};

export function httpStatusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/** An error that is safe to show to API clients. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryAfterSeconds: number | null;

  constructor(code: ErrorCode, message: string, options: { details?: unknown; retryAfterSeconds?: number | null; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = httpStatusFor(code);
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

/** Failure talking to a train-data provider. `retryable` drives backoff and the last-verified fallback. */
export class ProviderError extends AppError {
  readonly provider: string;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(
    provider: string,
    code: ErrorCode,
    message: string,
    options: { httpStatus?: number | null; retryable?: boolean; retryAfterSeconds?: number | null; cause?: unknown } = {},
  ) {
    super(code, message, { retryAfterSeconds: options.retryAfterSeconds, cause: options.cause });
    this.name = 'ProviderError';
    this.provider = provider;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** Errors where serving the last verified snapshot is appropriate (transient provider trouble). */
export function isTransientProviderError(err: unknown): err is ProviderError {
  return (
    err instanceof ProviderError &&
    ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'PROVIDER_AUTH_FAILED', 'PROVIDER_NOT_CONFIGURED'].includes(err.code)
  );
}
