import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { testDeps } from '../helpers.ts';

describe('HTTP layer without a database', () => {
  const { deps } = testDeps({ db: null });
  const app = buildApp(deps);

  it('tracks trains without persistence', async () => {
    const res = await request(app).post('/api/trains/track').send({ trainNumbers: '12082' });
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeNull();
    expect(res.body.results[0].ok).toBe(true);
  });

  it('answers features that need the database with a clear 503', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@example.com', password: 'whatever-long' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
    const config = await request(app).get('/api/config');
    expect(config.body.features).toEqual({ email: false, monitoring: false, shareLinks: false });
  });

  it('rejects malformed JSON and unknown fields types with VALIDATION_ERROR', async () => {
    const bad = await request(app).post('/api/trains/track').set('content-type', 'application/json').send('{"trainNumbers":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const wrongType = await request(app).post('/api/trains/track').send({ trainNumbers: 12082 });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.details[0].path).toBe('trainNumbers');
  });

  it('sets security headers and never exposes secrets in config', async () => {
    const res = await request(app).get('/api/config');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/secret|password|api_?key/i);
  });
});

describe('rate limiting', () => {
  it('returns 429 with the standard error body and Retry-After once the tracking limit is hit', async () => {
    const { deps } = testDeps({ db: null });
    const app = buildApp(deps, { disableRateLimits: false });
    let last: request.Response | undefined;
    for (let i = 0; i < 31; i++) last = await request(app).get('/api/trains/12082');
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not share limits between unrelated endpoints', async () => {
    const { deps } = testDeps({ db: null });
    const app = buildApp(deps, { disableRateLimits: false });
    for (let i = 0; i < 31; i++) await request(app).get('/api/trains/12082');
    expect((await request(app).get('/api/config')).status).toBe(200);
  });
});
