# RailTrack Live

Track one or many Indian Railways trains, see each journey on a map, filter and export the results, email
custom reports with a CSV attachment, and set up server-side monitoring alerts.

* **Licensed APIs only.** Data comes from documented, key-authenticated provider APIs behind a provider
  abstraction. No scraping, no CAPTCHA/rate-limit/login-wall evasion, no private RailYatri or Where Is My Train
  endpoints. See [docs/PROVIDERS.md](docs/PROVIDERS.md) for the provider evaluation and licensing caveats.
* **Honest data labels.** Every train view, export and email names the data source and shows when the data
  was updated. Positions are labelled **reported** (the provider supplied a coordinate) or **estimated**
  (interpolated between stations — never presented as GPS). Demo mode is labelled **DEMO DATA** everywhere.
* **Safe failure.** If a provider is unavailable, rate-limited or not configured, the API returns
  "Live data temporarily unavailable" and, when it has one, the last verified result with its timestamp.

## Contents

- [Quick start (demo mode)](#quick-start-demo-mode)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Provider API keys](#provider-api-keys)
- [Email (SMTP) setup](#email-smtp-setup)
- [Monitoring worker](#monitoring-worker)
- [API](#api)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security notes](#security-notes)
- [Project layout](#project-layout)

## Quick start (demo mode)

Requirements: Node.js 22.12+, npm 10+, Docker (for PostgreSQL and Redis).

```bash
npm install
cp .env.example .env
```

Edit `.env` and set at least:

```dotenv
TRAIN_DATA_PROVIDER=mock
DATABASE_URL=postgresql://railtrack:railtrack@localhost:5432/railtrack
REDIS_URL=redis://localhost:6379
SESSION_SECRET=<32+ random characters>
REPORT_LINK_SECRET=<32+ random characters>
```

Then start the databases, apply migrations and run everything (API on :8000, worker, web on :5173):

```bash
npm run db:up
npm run db:deploy
npm run dev
```

Open http://localhost:5173. API docs: http://localhost:8000/api/docs.

### Demo data

`TRAIN_DATA_PROVIDER=mock` runs a deterministic simulator whose journeys progress in real time (so
monitoring alerts fire). Its timetables are generated, **not official schedules**, and every response has
`provider.isDemo = true`, which the UI, CSV and emails label as DEMO DATA.

| Train | Demo scenario |
|---|---|
| 12082, 12627, 16348, 12301, 12002 | Normal running with simulated delays (estimated positions) |
| 12951 | Provider-*reported* coordinates (simulated) |
| 22691 | Rescheduled departure (+2 h 30 min) |
| 12622 | Diverted; Kazipet and Warangal skipped |
| 12859 | Cancelled |
| 99999 | Simulated provider rate limit (HTTP 429) |
| 99998 | Simulated provider outage (HTTP 503) |
| any other 5-digit number | Train not found |

`MOCK_FAILURE_RATE=0.3` makes 30 % of demo calls fail so you can see the "last verified result" fallback.

### Without Docker

Any PostgreSQL 14+ works. Prisma's local development server is a quick alternative for trying the app:

```bash
cd apps/api
npx prisma dev --name railtrack --detach   # prints a postgres:// TCP URL — put it in DATABASE_URL
```

Without `REDIS_URL` the API uses an in-memory cache and monitoring is disabled (the UI says so). Without
`DATABASE_URL`, tracking still works but history, sign-in, email and monitoring are unavailable.

## Architecture

```
apps/web  (React + Vite + Tailwind + shadcn/ui + Leaflet)
   │  /api (cookie session)
apps/api  (Express 5 + Zod)  ── Prisma 7 ── PostgreSQL
   │   ├─ TrackingService: cache → coalesce → rate limiter → provider → snapshot / last-verified fallback
   │   ├─ ProviderRegistry → GuardedProvider (rate limit, usage log, health cache)
   │   │      ├─ RailRadarProvider   ├─ RailKitProvider
   │   │      ├─ IndianRailApiProvider └─ MockProvider (demo)
   │   ├─ EmailReportService (Nodemailer, per-recipient audit, share links)
   │   └─ MonitoringService ── BullMQ job schedulers ── Redis
apps/api worker  (BullMQ Worker: scheduled checks → alert rules → alert emails)
packages/shared  (Zod contract: NormalizedTrainStatus, request/response schemas, filters, IST dates, geo estimator)
```

* **Normalised model.** Adapters translate provider payloads into `NormalizedTrainStatus`
  (`packages/shared/src/schemas.ts`). The frontend, exports and emails depend only on that model, so the
  provider can be switched with `TRAIN_DATA_PROVIDER` without frontend changes.
* **Provider safety.** Each provider has documented-safe limits (concurrency, spacing, per-minute cap, cache
  TTLs, minimum monitoring interval). Retries use exponential backoff with jitter and only for transient
  failures (timeouts, network errors, 5xx, 429 with a short `Retry-After`). Quota exhaustion and auth
  errors are never retried. Forced refreshes still reuse results younger than 30 s.
* **Caching.** Live results are cached per provider TTL (30 s – 3 min); routes for 24 h in Redis and in the
  `TrainRouteStop` table; the last verified result is kept for 3 days (Redis) and in `TrainSnapshot`.
* **Time.** Instants are stored and sent as UTC ISO-8601; journey dates are IST calendar dates; everything
  is displayed in IST.
* **Positions.** If the provider returns a coordinate it is shown as *reported*. Otherwise
  `estimatePosition()` interpolates between the last reported and next station using actual/expected times
  (capped at 95 % of the segment so it never implies an unreported arrival) and explains its basis.

### Database

Prisma schema: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma); migration in
`apps/api/prisma/migrations`. Entities: `User`, `TrackingRequest`, `TrainSnapshot`, `TrainRouteStop`,
`MonitoringSubscription`, `EmailReport`, `EmailReportRecipient`, `ProviderUsageLog`, `AuditLog`.

```bash
npm run db:migrate   # create a new migration after editing schema.prisma (dev)
npm run db:deploy    # apply migrations (CI / production)
```

## Configuration

All settings are environment variables; see [`.env.example`](.env.example). The API reads `.env` from the
repository root (and optionally `apps/api/.env`). Only `.env.example` is committed — `.env` is git-ignored.

| Variable | Purpose |
|---|---|
| `TRAIN_DATA_PROVIDER` | `railradar` (default), `railkit`, `indianrailapi` or `mock` |
| `RAILRADAR_API_KEY`, `RAILKIT_API_KEY`, `INDIAN_RAIL_API_KEY` | Provider credentials (server-side only) |
| `DATABASE_URL`, `REDIS_URL` | PostgreSQL and Redis |
| `SMTP_*`, `APP_BASE_URL` | Email delivery and links in emails |
| `REPORT_LINK_SECRET` | HMAC key for share-link tokens (≥ 32 chars; required in production) |
| `SESSION_SECRET` | Signs session cookies (≥ 32 chars; required in production) |
| `ADMIN_EMAILS` | Accounts that get the admin role on sign-up (provider usage page) |
| `MAPBOX_TOKEN` | Optional *public* (`pk.`) Mapbox token; otherwise OpenStreetMap tiles |
| `TRUST_PROXY` | Number of proxies in front of the API (correct client IPs for rate limiting) |
| `PROVIDER_MAX_PER_MINUTE` | Requests/minute to the active provider (default is free-tier safe: RailRadar 10); set to your plan's burst limit |

There is deliberately **no silent fallback to demo data**: if the selected provider has no key, requests
return `PROVIDER_NOT_CONFIGURED` ("Live data temporarily unavailable") and the provider page shows
"not configured".

## Provider API keys

Keys are read only by the API, never sent to the browser, and never logged.

1. **RailRadar** — create an account at https://railradar.in/developers, choose a paid plan for commercial
   use, copy the key (`rr_live_…`) into `RAILRADAR_API_KEY`, set `TRAIN_DATA_PROVIDER=railradar`.
2. **RailKit** — direct REST access needs the *Advance* plan (https://railkit.in/pricing). Put the key in
   `RAILKIT_API_KEY` and set `TRAIN_DATA_PROVIDER=railkit`.
3. **IndianRailAPI** — request an "Active" account (https://indianrailapi.com), put the key in
   `INDIAN_RAIL_API_KEY`, set `TRAIN_DATA_PROVIDER=indianrailapi`. Ensure HTTPS works for your account; the
   key travels in the URL path.

Check the provider page (`/admin/providers` in the web app, or `GET /api/health/providers`) after changing
keys. Health probes are cached for 5 minutes because each probe counts against your quota; administrators
can force a fresh probe.

## Email (SMTP) setup

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL` (and optionally
`SMTP_FROM_NAME`). Examples:

* **Local testing with Mailpit** — `docker compose --profile mail up -d mailpit`, then `SMTP_HOST=localhost`,
  `SMTP_PORT=1025`, `SMTP_SECURE=false`, `SMTP_FROM_EMAIL=reports@railtrack.local`; read mail at
  http://localhost:8025.
* **Amazon SES / SendGrid / Postmark / Mailgun** — use the provider's SMTP host, port 587 with
  `SMTP_SECURE=false` (STARTTLS) or 465 with `SMTP_SECURE=true`, and SMTP credentials. Verify the sender
  domain (SPF/DKIM) so reports are not marked as spam.
* **Google Workspace / Gmail** — `smtp.gmail.com`, port 465, `SMTP_SECURE=true`, an app password.

When SMTP is not configured in development, emails are written as `.eml` files to `apps/api/.mail-outbox/`
and the UI says "outbox". In production, email features are disabled until SMTP is configured.

Each report is sent **separately to each recipient** (addresses are never exposed to one another) with a
responsive HTML body and a CSV attachment of the selected fields. Every send is stored in `EmailReport` /
`EmailReportRecipient` (recipient, fields, trains, timestamp, status, error). A public read-only link is
created only when the sender ticks "Include a share link"; the token is random, stored only as an HMAC,
expires after `SHARE_LINK_TTL_DAYS`, and exposes only the fields that were selected.

## Monitoring worker

Monitoring runs on the server, so it continues after the browser is closed:

* `POST /api/monitoring` creates a subscription and a BullMQ **job scheduler** (repeat every N minutes;
  minimum is the provider's safe interval, 10–15 min).
* `npm run dev` starts the worker; in production run `node apps/api/dist/worker.js` (or the `worker` service
  in Docker Compose). The worker re-creates schedulers for active subscriptions on start.
* Each check fetches the live status (respecting caches/limits), evaluates the alert rules and emails only
  when a rule fires: reached next station, delay above threshold (with 5-minute hysteresis), diverted /
  cancelled / rescheduled, arrived at destination. Each alert is sent once; stale fallback data never
  triggers alerts. Journeys that arrive or are cancelled complete automatically; after 12 consecutive
  failed checks a subscription moves to `ERROR` and can be resumed.

## API

OpenAPI 3.1 is generated from the shared Zod schemas: served at `/api/openapi.json`, browsable at
`/api/docs`, and written to [`docs/openapi.json`](docs/openapi.json) by `npm run openapi`.

| Method | Path | Auth |
|---|---|---|
| POST | `/api/trains/track` | optional |
| POST | `/api/trains/upload` | — |
| GET | `/api/trains/:trainNumber?journeyDate=YYYY-MM-DD` | — |
| GET | `/api/trains/:trainNumber/route` | — |
| GET | `/api/trains/:trainNumber/snapshots` | — |
| GET | `/api/tracking/history` | required |
| GET | `/api/tracking/export.csv` | — |
| POST | `/api/reports/preview` | — |
| POST | `/api/reports/email` | required |
| GET | `/api/reports` | required |
| GET | `/api/share/:token` | public link |
| GET/POST | `/api/monitoring` | required |
| PATCH/DELETE | `/api/monitoring/:id` | required (owner) |
| GET | `/api/health`, `/api/health/providers`, `/api/config` | — |
| GET | `/api/admin/provider-usage` | admin |
| POST/GET | `/api/auth/register`, `/login`, `/logout`, `/me` | — |

Errors always look like `{ "error": { "code": "RATE_LIMITED", "message": "…", "details": … } }`, with
`Retry-After` on 429.

## Testing

```bash
npm test                      # shared + API unit tests + web component tests
npm run typecheck
```

API integration tests run against a real, **disposable** PostgreSQL database (they truncate all tables):

```bash
createdb railtrack_test   # or use `npx prisma dev` / docker compose
DATABASE_URL=postgresql://railtrack:railtrack@localhost:5432/railtrack_test npm run db:deploy
TEST_DATABASE_URL=postgresql://railtrack:railtrack@localhost:5432/railtrack_test npm test -w @railtrack/api
```

Without `TEST_DATABASE_URL` the integration suite is skipped. End-to-end tests (Playwright) start the API
in demo mode and the web app automatically:

```bash
npx playwright install chromium   # once
npm run test:e2e
```

## Deployment

The `Dockerfile` builds one image containing the API, the worker and the built web app (served by the API
from the same origin).

```bash
docker compose --profile app up -d --build   # postgres, redis, api (migrates on start), worker
```

Production checklist:

1. Set `NODE_ENV=production`, strong `SESSION_SECRET` and `REPORT_LINK_SECRET`, `APP_BASE_URL` (public URL),
   provider key and SMTP settings via your platform's secret store — never bake them into images.
2. Run `npm run db:deploy` (the compose `api` service does this on start).
3. Run **one or more API** instances and **at least one worker**. Rate-limit counters and caches live in
   Redis, so API replicas share them. Provider limits are enforced per process — divide them by the number
   of API replicas if you scale out (see each adapter's `limits`).
4. Terminate TLS at a reverse proxy/load balancer and set `TRUST_PROXY` (usually `1`). Session cookies are
   `Secure` in production.
5. OpenStreetMap's public tiles are for light use only — for production traffic use a tile provider
   (e.g. `MAPBOX_TOKEN`) per the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
6. Health checks: `GET /api/health` (database and Redis status).

## Security notes

* All input is validated with Zod; train numbers must be five digits; journey dates are limited to the
  window providers support (7 days back, 3 ahead); uploads are limited to 2 MB / 500 rows and checked by file
  signature; spreadsheet formulas are neither evaluated nor exported (CSV cells are formula-neutralised).
* Rate limits: whole API, tracking, exports, sign-in, email (10 reports/hour/user) and monitoring changes.
* Passwords use scrypt; sessions are signed httpOnly `SameSite=Lax` cookies; email reports, history and
  monitoring require sign-in; monitoring and reports are scoped to their owner.
* Logs redact authorization headers, cookies, passwords, keys and recipient fields, record request paths
  without query strings, and provider URLs (which can contain keys) are never logged. The audit log stores
  hashed IPs and counts, not recipient addresses.
* Provider/SMTP secrets live only in environment variables. No admin UI edits secrets; if you add one,
  encrypt them at rest (e.g. envelope encryption with a KMS key) before storing.

## Project layout

```
apps/api/            Express API + BullMQ worker
  prisma/            schema.prisma, migrations
  src/providers/     TrainDataProvider adapters (RailRadar, RailKit, IndianRailAPI, Mock), registry
  src/services/      tracking, upload parsing, reports/email, monitoring, alert rules, auth, audit
  src/http/          routes and middleware
  src/data/          station coordinates and demo dataset
  test/              unit tests, integration tests, provider fixtures
apps/web/            React app (pages, components, map, e2e tests)
packages/shared/     Zod contract and pure helpers shared by API and web
samples/             trains-sample.csv/.xlsx/.xls and trains-with-errors.csv (regenerate: npm run samples)
docs/                OpenAPI document, provider evaluation
```
