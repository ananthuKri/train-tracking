import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { todayInIst, type EmailReportResult, type MonitoringSubscription, type TrackResponse } from '@railtrack/shared';
import { buildApp } from '../../src/app.ts';
import { flush, resetDb, TEST_DATABASE_URL, testDb, testDeps, type TestContext } from '../helpers.ts';

/**
 * End-to-end API tests against a real PostgreSQL database in demo-provider mode.
 * Run with TEST_DATABASE_URL pointing at a disposable database (see README › Testing).
 */
describe.skipIf(!TEST_DATABASE_URL)('API integration', () => {
  let ctx: TestContext;
  let app: ReturnType<typeof buildApp>;
  const today = todayInIst();

  beforeEach(async () => {
    await resetDb(testDb());
    // Fresh cache, mailer and scheduler per test; the database client is shared.
    ctx = testDeps({ db: testDb() });
    app = buildApp(ctx.deps);
  });

  afterAll(async () => {
    await testDb().$disconnect();
  });

  async function signUp(email = 'user@example.com') {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/register').send({ email, password: 'a-long-password-1', name: 'Test User' });
    expect(res.status).toBe(201);
    return agent;
  }

  describe('system', () => {
    it('reports health and demo-mode configuration', async () => {
      const health = await request(app).get('/api/health');
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({ status: 'ok', database: 'up', provider: 'mock' });

      const config = await request(app).get('/api/config');
      expect(config.body.demoMode).toBe(true);
      expect(config.body.activeProvider.isDemo).toBe(true);
      expect(config.body.map.provider).toBe('osm');
      expect(config.body.features).toEqual({ email: true, monitoring: true, shareLinks: true });
    });

    it('serves OpenAPI and provider health', async () => {
      const doc = await request(app).get('/api/openapi.json');
      expect(doc.body.openapi).toBe('3.1.0');
      expect(Object.keys(doc.body.paths)).toEqual(expect.arrayContaining(['/api/trains/track', '/api/monitoring/{id}', '/api/tracking/export.csv']));

      const health = await request(app).get('/api/health/providers');
      expect(health.body.activeProvider).toBe('mock');
      const byId = Object.fromEntries(health.body.providers.map((p: { provider: string }) => [p.provider, p]));
      expect(byId.mock).toMatchObject({ active: true, status: 'up', isDemo: true });
      expect(byId.railradar).toMatchObject({ active: false, status: 'not_configured', configured: false });
    });

    it('returns structured 404s for unknown API routes', async () => {
      const res = await request(app).get('/api/nope');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('tracking', () => {
    it('tracks multiple trains, de-duplicates and reports invalid input', async () => {
      const res = await request(app).post('/api/trains/track').send({ trainNumbers: '12082, 12627, 16348, 12082, 1234, abcde' });
      expect(res.status).toBe(200);
      const body = res.body as TrackResponse;
      expect(body.results.map((r) => r.trainNumber)).toEqual(['12082', '12627', '16348']);
      expect(body.duplicates).toEqual(['12082']);
      expect(body.invalid.map((i) => i.input)).toEqual(['1234', 'abcde']);
      expect(body.summary).toMatchObject({ requested: 5, valid: 3, ok: 3, failed: 0 });
      expect(body.results.every((r) => r.status?.provider.isDemo)).toBe(true);
      expect(body.requestId).toBeTruthy();

      const snapshots = await testDb().trainSnapshot.count();
      expect(snapshots).toBe(3);
    });

    it('rejects requests with no valid trains and out-of-range dates', async () => {
      const none = await request(app).post('/api/trains/track').send({ trainNumbers: 'abc' });
      expect(none.status).toBe(400);
      expect(none.body.error.code).toBe('VALIDATION_ERROR');
      const old = await request(app).post('/api/trains/track').send({ trainNumbers: '12082', journeyDate: '2020-01-01' });
      expect(old.status).toBe(400);
    });

    it('returns per-train errors without failing the batch', async () => {
      const res = await request(app).post('/api/trains/track').send({ trainNumbers: ['12082', '99999', '11111'] });
      const errors = Object.fromEntries((res.body as TrackResponse).results.map((r) => [r.trainNumber, r.error?.code ?? null]));
      expect(errors).toEqual({ '12082': null, '99999': 'RATE_LIMITED', '11111': 'TRAIN_NOT_FOUND' });
    });

    it('serves a single train, maps provider errors to HTTP status codes, and returns the route', async () => {
      const ok = await request(app).get(`/api/trains/12082?journeyDate=${today}`);
      expect(ok.status).toBe(200);
      expect(ok.body.status.trainNumber).toBe('12082');

      expect((await request(app).get('/api/trains/1234')).status).toBe(400);
      expect((await request(app).get('/api/trains/11111')).status).toBe(404);
      const limited = await request(app).get('/api/trains/99999');
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toBe('60');
      expect((await request(app).get('/api/trains/99998')).status).toBe(503);

      const route = await request(app).get('/api/trains/12082/route');
      expect(route.status).toBe(200);
      expect(route.body.stops.length).toBeGreaterThan(5);
      expect(await testDb().trainRouteStop.count({ where: { trainNumber: '12082' } })).toBe(route.body.stops.length);

      const snaps = await request(app).get(`/api/trains/12082/snapshots?journeyDate=${today}`);
      expect(snaps.body.items.length).toBeGreaterThanOrEqual(1);
      expect(snaps.body.items[0]).toMatchObject({ provider: 'mock', isDemo: true });
    });

    it('records provider usage', async () => {
      await request(app).post('/api/trains/track').send({ trainNumbers: '12082, 11111' });
      await flush();
      const rows = await testDb().providerUsageLog.findMany();
      expect(rows.map((r) => r.outcome).sort()).toEqual(['not_found', 'success']);
    });

    it('previews CSV uploads with row-level validation', async () => {
      const csv = `train_number,journey_date,email\n12082,${today},ops@example.com\n12A45,,\n12627,,\n`;
      const res = await request(app).post('/api/trains/upload').attach('file', Buffer.from(csv), 'trains.csv');
      expect(res.status).toBe(200);
      expect(res.body.summary).toMatchObject({ total: 3, valid: 2, invalid: 1 });
      expect(res.body.rows[1].errors[0]).toMatch(/digits/);

      const bad = await request(app).post('/api/trains/upload').attach('file', Buffer.from('MZ'), 'virus.exe');
      expect(bad.status).toBe(415);
      const big = await request(app).post('/api/trains/upload').attach('file', Buffer.alloc(3 * 1024 * 1024, 'a'), 'big.csv');
      expect(big.status).toBe(413);
    });

    it('exports filtered results as CSV', async () => {
      const res = await request(app).get('/api/tracking/export.csv?trains=12082,12859,11111&fields=identity,delays&statuses=cancelled');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="railtrack-export-/);
      const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
      expect(lines[0]).toBe('Train Number,Train Name,Journey Date,Status,Delay (min),Data Status');
      expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['12859']);
    });
  });

  describe('auth', () => {
    it('registers, signs in, reads the session and signs out', async () => {
      const agent = await signUp();
      expect((await agent.get('/api/auth/me')).body.user.email).toBe('user@example.com');
      expect((await agent.post('/api/auth/logout')).status).toBe(204);

      const login = await request(app).post('/api/auth/login').send({ email: 'USER@example.com', password: 'a-long-password-1' });
      expect(login.status).toBe(200);
      expect(login.headers['set-cookie']?.[0]).toMatch(/rt_session=.*HttpOnly/i);
    });

    it('rejects duplicates and wrong passwords without leaking details', async () => {
      await signUp();
      const dup = await request(app).post('/api/auth/register').send({ email: 'user@example.com', password: 'another-password-2' });
      expect(dup.status).toBe(409);
      const wrong = await request(app).post('/api/auth/login').send({ email: 'user@example.com', password: 'nope-nope-nope' });
      const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope' });
      expect(wrong.status).toBe(401);
      expect(unknown.body).toEqual(wrong.body);
      const weak = await request(app).post('/api/auth/register').send({ email: 'new@example.com', password: 'short' });
      expect(weak.status).toBe(400);
    });

    it('keeps tracking history per user', async () => {
      const agent = await signUp();
      await agent.post('/api/trains/track').send({ trainNumbers: '12082, 12627' });
      await request(app).post('/api/trains/track').send({ trainNumbers: '16348' });
      const history = await agent.get('/api/tracking/history');
      expect(history.status).toBe(200);
      expect(history.body.items).toHaveLength(1);
      expect(history.body.items[0].items.map((i: { trainNumber: string }) => i.trainNumber)).toEqual(['12082', '12627']);
      expect((await request(app).get('/api/tracking/history')).status).toBe(401);
    });
  });

  describe('email reports', () => {
    const trains = [
      { trainNumber: '12082', journeyDate: todayInIst() },
      { trainNumber: '12627', journeyDate: todayInIst() },
    ];

    it('requires sign-in to send', async () => {
      const res = await request(app).post('/api/reports/email').send({ recipients: ['a@example.com'], trains });
      expect(res.status).toBe(401);
    });

    it('previews without sending', async () => {
      const res = await request(app).post('/api/reports/preview').send({ trains, fields: ['identity', 'delays'] });
      expect(res.status).toBe(200);
      expect(res.body.html).toContain('DEMO DATA');
      expect(res.body.csv).toContain('Delay (min)');
      expect(ctx.mailer.sent).toHaveLength(0);
    });

    it('sends one email per recipient with a CSV attachment and keeps an audit record', async () => {
      const agent = await signUp();
      const res = await agent
        .post('/api/reports/email')
        .send({ recipients: ['a@example.com', 'B@example.com', 'a@example.com'], trains, fields: ['identity', 'delays', 'platform'] });
      expect(res.status).toBe(201);
      const result = res.body as EmailReportResult;
      expect(result.status).toBe('SENT');
      expect(result.recipients.map((r) => r.email)).toEqual(['a@example.com', 'b@example.com']);
      expect(result.shareUrl).toBeNull();

      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['a@example.com', 'b@example.com']);
      const attachment = ctx.mailer.sent[0]!.attachments![0]!;
      expect(attachment.filename).toMatch(/\.csv$/);
      expect(String(attachment.content)).toContain('Platform');
      expect(String(attachment.content)).not.toContain('Exceptions');

      const audit = await testDb().auditLog.findFirst({ where: { action: 'report.email' } });
      expect(audit?.metadata).toMatchObject({ recipientCount: 2, sent: 2 });
      expect(JSON.stringify(audit?.metadata)).not.toContain('@example.com');

      const list = await agent.get('/api/reports');
      expect(list.body.items).toHaveLength(1);
    });

    it('sends to the signed-in user with the "Status Tracker" subject when no recipients are given', async () => {
      const agent = await signUp('me@example.com');
      const res = await agent.post('/api/reports/email').send({ trains });
      expect(res.status).toBe(201);
      expect(res.body.recipients).toEqual([{ email: 'me@example.com', status: 'SENT', error: null }]);
      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['me@example.com']);
      expect(ctx.mailer.sent[0]!.subject).toBe('[DEMO] Status Tracker');
      expect(ctx.mailer.sent[0]!.text).toContain('Train details (2):');
    });

    it('records partial failures per recipient', async () => {
      const agent = await signUp();
      ctx.mailer.failFor.add('bad@example.com');
      const res = await agent.post('/api/reports/email').send({ recipients: ['ok@example.com', 'bad@example.com'], trains });
      expect(res.body.status).toBe('PARTIAL');
      expect(res.body.recipients.find((r: { email: string }) => r.email === 'bad@example.com').status).toBe('FAILED');
    });

    it('creates a redacted, expiring share link only when asked', async () => {
      const agent = await signUp();
      const res = await agent.post('/api/reports/email').send({ recipients: ['a@example.com'], trains, fields: ['identity', 'mapLink'], includeShareLink: true });
      expect(res.body.shareUrl).toMatch(/^http:\/\/localhost:5173\/shared\/[\w-]{40,}$/);
      const token = res.body.shareUrl.split('/').pop();

      const shared = await request(app).get(`/api/share/${token}`);
      expect(shared.status).toBe(200);
      expect(shared.body.fields).toEqual(['identity', 'mapLink']);
      expect(shared.body.trains[0].delayMinutes).toBeNull();
      expect(shared.body.trains[0].stops.length).toBeGreaterThan(0);

      const row = await testDb().emailReport.findFirst();
      expect(row?.shareTokenHash).not.toContain(token);
      expect((await request(app).get('/api/share/not-a-real-token-but-long-enough')).status).toBe(404);
    });
  });

  describe('monitoring', () => {
    it('requires sign-in', async () => {
      expect((await request(app).get('/api/monitoring')).status).toBe(401);
    });

    it('creates, pauses, resumes and stops a subscription with server-side scheduling', async () => {
      const agent = await signUp();
      const created = await agent.post('/api/monitoring').send({
        trainNumber: '12627',
        intervalMinutes: 15,
        rules: { nextStation: true, delayAboveMinutes: 30, exceptions: true, arrival: true },
        recipients: ['ops@example.com'],
      });
      expect(created.status).toBe(201);
      const sub = created.body as MonitoringSubscription;
      expect(sub).toMatchObject({ status: 'ACTIVE', intervalMinutes: 15, journeyDate: today, trainName: 'Karnataka Express' });
      expect(ctx.scheduler.scheduled.get(sub.id)).toBe(15);

      const paused = await agent.patch(`/api/monitoring/${sub.id}`).send({ action: 'pause' });
      expect(paused.body.status).toBe('PAUSED');
      expect(ctx.scheduler.scheduled.has(sub.id)).toBe(false);

      const resumed = await agent.patch(`/api/monitoring/${sub.id}`).send({ action: 'resume', intervalMinutes: 20 });
      expect(resumed.body).toMatchObject({ status: 'ACTIVE', intervalMinutes: 20 });
      expect(ctx.scheduler.scheduled.get(sub.id)).toBe(20);

      const stopped = await agent.delete(`/api/monitoring/${sub.id}`);
      expect(stopped.body.status).toBe('STOPPED');
      expect(ctx.scheduler.scheduled.has(sub.id)).toBe(false);
      expect((await agent.patch(`/api/monitoring/${sub.id}`).send({ action: 'resume' })).status).toBe(409);
    });

    it('validates interval, train and ownership', async () => {
      const agent = await signUp();
      const base = { rules: { exceptions: true }, recipients: ['ops@example.com'] };
      expect((await agent.post('/api/monitoring').send({ ...base, trainNumber: '12627', intervalMinutes: 5 })).status).toBe(400);
      expect((await agent.post('/api/monitoring').send({ ...base, trainNumber: '11111' })).status).toBe(404);
      const created = await agent.post('/api/monitoring').send({ ...base, trainNumber: '12627' });
      const other = await signUp('other@example.com');
      expect((await other.delete(`/api/monitoring/${created.body.id}`)).status).toBe(404);
    });

    it('runs a check that emails only when an alert rule triggers', async () => {
      const agent = await signUp();
      const created = await agent.post('/api/monitoring').send({
        trainNumber: '12859',
        rules: { exceptions: true, arrival: false, nextStation: false },
        recipients: ['ops@example.com'],
      });
      const id = created.body.id as string;
      const first = await ctx.deps.monitoring.runCheck(id);
      // 12859 is cancelled in the demo data: one alert, then the subscription completes.
      expect(first).toEqual({ outcome: 'completed', alerts: 1 });
      expect(ctx.mailer.sent).toHaveLength(1);
      expect(ctx.mailer.sent[0]!.subject).toMatch(/^\[DEMO\] Alert: 12859/);
      const row = await testDb().monitoringSubscription.findUnique({ where: { id } });
      expect(row).toMatchObject({ status: 'COMPLETED', alertCount: 1 });
      expect(await testDb().emailReport.count({ where: { kind: 'ALERT', monitoringSubscriptionId: id } })).toBe(1);

      expect(await ctx.deps.monitoring.runCheck(id)).toEqual({ outcome: 'skipped', alerts: 0 });
      expect(ctx.mailer.sent).toHaveLength(1);
    });
  });

  describe('admin', () => {
    it('restricts provider usage statistics to administrators', async () => {
      const user = await signUp();
      expect((await user.get('/api/admin/provider-usage')).status).toBe(403);
      const admin = await signUp('admin@example.com');
      await admin.post('/api/trains/track').send({ trainNumbers: '12082' });
      await flush();
      const res = await admin.get('/api/admin/provider-usage?hours=1');
      expect(res.status).toBe(200);
      expect(res.body.items.find((i: { provider: string }) => i.provider === 'mock')).toMatchObject({ total: 1, success: 1 });
    });
  });
});
