import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { REPO_ROOT } from './config/env.ts';
import type { AppDeps } from './container.ts';
import { attachSession, createRateLimitFactory, errorHandler, notFoundHandler } from './http/middleware/index.ts';
import { authRouter } from './http/routes/auth.ts';
import { monitoringRouter } from './http/routes/monitoring.ts';
import { reportsRouter } from './http/routes/reports.ts';
import { systemRouter } from './http/routes/system.ts';
import { trackingRouter } from './http/routes/tracking.ts';
import { trainsRouter } from './http/routes/trains.ts';
import { buildOpenApiDocument } from './openapi.ts';

export interface BuildAppOptions {
  /** Disable rate limiting (tests). */
  disableRateLimits?: boolean;
  /** Serve the built web app (apps/web/dist) from the same origin. Defaults to production only. */
  serveWeb?: boolean;
}

export function buildApp(deps: AppDeps, options: BuildAppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  if (deps.config.TRUST_PROXY !== undefined) app.set('trust proxy', deps.config.TRUST_PROXY);

  if (!deps.config.isTest) {
    app.use(
      pinoHttp({
        logger: deps.logger,
        // Log paths only — query strings may contain user-entered data.
        serializers: {
          req: (req: { method: string; url: string; id: unknown }) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        autoLogging: { ignore: (req) => req.url === '/api/health' },
      }),
    );
  }

  const openapi = buildOpenApiDocument();
  app.get('/api/openapi.json', (_req, res) => {
    res.json(openapi);
  });
  // Swagger UI ships inline scripts, so it is mounted before helmet's strict CSP.
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'RailTrack Live API' }));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org', 'https://tile.openstreetmap.org', 'https://api.mapbox.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          scriptSrc: ["'self'"],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors({ origin: [deps.config.FRONTEND_URL, deps.config.APP_BASE_URL], credentials: true }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(attachSession(deps.auth));

  const limit = createRateLimitFactory(deps.redis, options.disableRateLimits ?? deps.config.isTest);
  app.use('/api', limit('api', { windowMs: 15 * 60_000, limit: 600 }));
  app.use('/api', systemRouter(deps));
  app.use('/api', authRouter(deps, limit));
  app.use('/api', trainsRouter(deps, limit));
  app.use('/api', trackingRouter(deps, limit));
  app.use('/api', reportsRouter(deps, limit));
  app.use('/api', monitoringRouter(deps, limit));
  app.use('/api', notFoundHandler);

  const webDist = path.join(REPO_ROOT, 'apps/web/dist');
  if ((options.serveWeb ?? deps.config.isProduction) && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    // SPA fallback for client-side routes.
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler(deps.logger));
  return app;
}
