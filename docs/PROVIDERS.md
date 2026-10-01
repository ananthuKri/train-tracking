# Train-data provider evaluation

RailTrack Live never scrapes websites. Every byte of train data comes from a documented, key-authenticated
HTTP API through the `TrainDataProvider` interface (`apps/api/src/providers/types.ts`). This page records
what was verified about each candidate provider on **2026-10-01** from their public documentation only
(no accounts were created and no live calls were made).

> **Important licensing note.** None of the three providers is an official Indian Railways, CRIS or NTES
> service, and each one says so in its own terms. "Licensed" here means *you hold a commercial licence from
> the provider under its terms of service* — not that the data is officially licensed by Indian Railways.
> If you need officially licensed data, contact CRIS (Centre for Railway Information Systems) directly and add
> an adapter for that feed. Review each provider's current terms before going to production.

## Summary

| | RailRadar | RailKit | IndianRailAPI |
|---|---|---|---|
| Adapter | `RailRadarProvider` | `RailKitProvider` (v1 only) | `IndianRailApiProvider` |
| Base URL | `https://api.railradar.in/v1` | `https://api.railkit.in` | `http(s)://indianrailapi.com/api/v2` |
| Auth | `Authorization: Bearer <key>` | `x-api-key: <key>` | key **in the URL path** |
| Live status | `GET /trains/{n}/live?date=YYYY-MM-DD` | `GET /api/v1/trains/{n}/live/{DD-MM-YYYY}` | `GET /livetrainstatus/apikey/{k}/trainnumber/{n}/date/{yyyymmdd}/` |
| Route | `GET /trains/{n}` | `GET /api/v1/trains/{n}/info` | `GET /TrainSchedule/apikey/{k}/TrainNumber/{n}/` |
| Coordinates | stations (`lat`/`lng`), segment progress | station coordinates in route | none for live position |
| Errors | `{success:false,error:{code,message}}` + HTTP status | `{success:false,error:"…"}` + HTTP status | `ResponseCode` string inside HTTP 200 |
| Limits (documented) | Sandbox 1k/month, 10/min (non-commercial); paid 30–120/min | Advance plan 600/10 min, ~10k/month; REST only on Advance | "max 1 request/second/IP" |
| Commercial licence | Paid plans | Paid plans; no redistribution | Paid "Active" account |
| Recommendation | **Primary** | Secondary | Last resort |

Configured safe limits (per API process) live next to each adapter in `limits` and are enforced by the
outbound `RateLimiter` plus a short live cache (`liveCacheSeconds`) and a long route cache.

## RailRadar — recommended primary

* Richest typed payload: per-station scheduled/actual times, delays, platforms, coordinates, exceptions
  (`DIVERTED`, partial cancellation, reschedule) and `currentLocation.segmentProgress`.
* RailRadar exposes *segment progress*, not a GPS fix. RailTrack Live therefore labels the derived marker as
  **estimated** ("using RailRadar's reported segment progress — not a GPS position"). Only an explicit
  coordinate in `currentLocation` is shown as **reported**.
* No documented health endpoint; the health probe calls the (cacheable) schedule endpoint for 12951.
* The free Sandbox plan is non-commercial. Use a paid plan for production.

## RailKit — secondary (v1 only)

* v1 live status is NTES-backed; times look like `16:05 28-Aug` and a trailing `*` marks an expected time.
* **v2 is sourced from "Where Is My Train" data and is intentionally not used** (project rule: no
  RailYatri/Where Is My Train data in production).
* RailKit is a single-maintainer project whose upstream is itself NTES; weigh the continuity risk.
* HTTP 429 means the *monthly* quota is exhausted — the adapter never retries it.
* Terms forbid redistribution and derived datasets; caching is allowed only to improve performance.

## IndianRailAPI — last resort

* The API key is part of the URL path. The adapter never logs URLs and never includes them in errors.
  The docs show plain HTTP only; RailTrack Live defaults to HTTPS (`INDIAN_RAIL_API_BASE_URL` to override).
  **Do not send the key over plain HTTP in production.**
* All values are strings (`"14 M"`, `"04:27PM"`, `"-"`), the `Day` field is unreliable (day roll-over is
  inferred from times), live responses omit the train name (filled from the cached route when available),
  and there is no live position. Error responses are undocumented beyond `ResponseCode`.

## Adding a provider

1. Implement `TrainDataProvider` (extend `HttpProvider` for HTTP APIs) and return `NormalizedTrainStatus` via
   `finalizeStatus()` — it fills coordinates from `apps/api/src/data/stations.ts`, derives neighbours,
   progress and an *estimated* position when the provider gives none, and validates the shape.
2. Set conservative `limits`, classify errors into the shared `ErrorCode`s and mark only transient ones as
   `retryable`.
3. Register it in `createProviderRegistry()` and add the id to `PROVIDER_IDS` in `packages/shared`.
4. Add fixture-based tests like `apps/api/test/unit/providers.test.ts`.
