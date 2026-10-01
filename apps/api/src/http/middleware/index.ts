import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit, type Store } from 'express-rate-limit';
import { MulterError } from 'multer';
import { RedisStore } from 'rate-limit-redis';
import { ZodError, type z } from 'zod';
import type { ApiErrorBody, User } from '@railtrack/shared';
import { AppError } from '../../lib/errors.ts';
import type { Logger } from '../../lib/logger.ts';
import type { Redis } from '../../lib/redis.ts';
import { SESSION_COOKIE, type AuthService } from '../../services/authService.ts';

declare module 'express-serve-static-core' {
  interface Request {
    /** Session claims from the signed cookie (not yet checked against the database). */
    session?: { userId: string; role: 'USER' | 'ADMIN' };
    /** Database-verified user, set by requireAuth. */
    user?: User;
  }
}

export function parseBody<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function validationError(error: ZodError): AppError {
  return new AppError('VALIDATION_ERROR', error.issues[0]?.message ?? 'Invalid request', {
    details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

/** Express 5 forwards rejected promises to the error handler; this keeps handler typing tidy. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function attachSession(auth: AuthService): RequestHandler {
  return (req, _res, next) => {
    const header = req.get('authorization');
    const token = (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (token) {
      const claims = auth.verifyToken(token);
      if (claims) req.session = claims;
    }
    next();
  };
}

export function requireAuth(auth: AuthService): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    if (!req.session) throw new AppError('UNAUTHENTICATED', 'Sign in to use this feature.');
    const user = await auth.getUser(req.session.userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Your session has expired. Sign in again.');
    req.user = user;
    next();
  });
}

export function requireAdmin(auth: AuthService): RequestHandler[] {
  return [
    requireAuth(auth),
    (req, _res, next) => {
      if (req.user?.role !== 'ADMIN') throw new AppError('FORBIDDEN', 'Administrators only.');
      next();
    },
  ];
}

export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}

export interface RateLimitFactory {
  (name: string, options: { windowMs: number; limit: number; perUser?: boolean; message?: string }): RequestHandler;
}

/** Rate limiters share Redis when available so limits hold across API replicas. */
export function createRateLimitFactory(redis: Redis | null, disabled = false): RateLimitFactory {
  return (name, options) => {
    if (disabled) return (_req, _res, next) => next();
    const store: Store | undefined = redis
      ? new RedisStore({
          prefix: `railtrack:rl:${name}:`,
          sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as never,
        })
      : undefined;
    return rateLimit({
      windowMs: options.windowMs,
      limit: options.limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      store,
      // If Redis is unreachable, let requests through rather than failing every call.
      passOnStoreError: true,
      keyGenerator: (req) => (options.perUser && req.session ? `u:${req.session.userId}` : ipKeyGenerator(req.ip ?? 'unknown')),
      handler: (_req, res, _next, used) => {
        const retryAfter = Math.ceil(used.windowMs / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        const body: ApiErrorBody = {
          error: {
            code: 'RATE_LIMITED',
            message: options.message ?? 'Too many requests. Please slow down and try again shortly.',
            details: { retryAfterSeconds: retryAfter },
          },
        };
        res.status(429).json(body);
      },
    });
  };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('NOT_FOUND', `No API route for ${req.method} ${req.path}`));
}

export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    let appError: AppError;
    if (err instanceof AppError) appError = err;
    else if (err instanceof ZodError) appError = validationError(err);
    else if (err instanceof MulterError) {
      appError =
        err.code === 'LIMIT_FILE_SIZE'
          ? new AppError('PAYLOAD_TOO_LARGE', 'The file is too large (maximum 2 MB).')
          : new AppError('VALIDATION_ERROR', `Upload rejected: ${err.message}`);
    } else if (isBodyParserError(err)) {
      appError = err.type === 'entity.too.large' ? new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.') : new AppError('VALIDATION_ERROR', 'Request body is not valid JSON.');
    } else {
      logger.error({ err, method: req.method, path: req.path }, 'unhandled error');
      appError = new AppError('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
    }
    if (appError.status >= 500 && appError.code !== 'INTERNAL_ERROR') {
      logger.warn({ code: appError.code, path: req.path }, appError.message);
    }
    if (appError.retryAfterSeconds !== null) res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    const body: ApiErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details ?? (appError.retryAfterSeconds !== null ? { retryAfterSeconds: appError.retryAfterSeconds } : undefined),
      },
    };
    res.status(appError.status).json(body);
  };
}

function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return typeof err === 'object' && err !== null && 'type' in err && typeof (err as { type: unknown }).type === 'string' && 'status' in err;
}
