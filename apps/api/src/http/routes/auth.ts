import { Router, type CookieOptions } from 'express';
import { LoginRequestSchema, RegisterRequestSchema } from '@railtrack/shared';
import type { AppDeps } from '../../container.ts';
import { AppError } from '../../lib/errors.ts';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '../../services/authService.ts';
import { asyncHandler, clientIp, parseBody, type RateLimitFactory } from '../middleware/index.ts';

export function authRouter(deps: AppDeps, limit: RateLimitFactory): Router {
  const router = Router();
  const authLimiter = limit('auth', { windowMs: 15 * 60_000, limit: 20, message: 'Too many sign-in attempts. Try again in 15 minutes.' });
  const cookie: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.config.isProduction,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };

  router.post(
    '/auth/register',
    authLimiter,
    asyncHandler(async (req, res) => {
      const body = parseBody(RegisterRequestSchema, req.body);
      const user = await deps.auth.register(body, clientIp(req));
      res.cookie(SESSION_COOKIE, deps.auth.issueToken(user), cookie).status(201).json({ user });
    }),
  );

  router.post(
    '/auth/login',
    authLimiter,
    asyncHandler(async (req, res) => {
      const body = parseBody(LoginRequestSchema, req.body);
      const user = await deps.auth.login(body, clientIp(req));
      res.cookie(SESSION_COOKIE, deps.auth.issueToken(user), cookie).json({ user });
    }),
  );

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { ...cookie, maxAge: undefined }).status(204).end();
  });

  router.get(
    '/auth/me',
    asyncHandler(async (req, res) => {
      const user = req.session ? await deps.auth.getUser(req.session.userId) : null;
      if (!user) throw new AppError('UNAUTHENTICATED', 'Not signed in.');
      res.json({ user });
    }),
  );

  return router;
}
