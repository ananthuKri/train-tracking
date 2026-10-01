import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { PROVIDER_IDS } from '@railtrack/shared';

/** Locate apps/api whether running from src/ (tsx) or from the bundled dist/ output. */
function findApiRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === '@railtrack/api') return dir;
    } catch {
      // keep walking up
    }
    dir = path.dirname(dir);
  }
  return path.resolve(start, '../..');
}

export const API_ROOT = findApiRoot(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.resolve(API_ROOT, '../..');

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const bool = (fallback: boolean) =>
  z.preprocess(emptyToUndefined, z.enum(['true', 'false', '1', '0']).optional()).transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),

  DATABASE_URL: optionalString,
  REDIS_URL: optionalString,

  TRAIN_DATA_PROVIDER: z.enum(PROVIDER_IDS).default('railradar'),
  RAILRADAR_API_KEY: optionalString,
  RAILRADAR_BASE_URL: z.string().url().default('https://api.railradar.in/v1'),
  RAILKIT_API_KEY: optionalString,
  RAILKIT_BASE_URL: z.string().url().default('https://api.railkit.in'),
  INDIAN_RAIL_API_KEY: optionalString,
  INDIAN_RAIL_API_BASE_URL: z.string().url().default('https://indianrailapi.com/api/v2'),
  MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  MAPBOX_TOKEN: optionalString,

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM_NAME: z.string().default('RailTrack Live'),
  SMTP_FROM_EMAIL: optionalString,
  EMAIL_OUTBOX_DIR: optionalString,

  SESSION_SECRET: optionalString,
  REPORT_LINK_SECRET: optionalString,
  SHARE_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  ADMIN_EMAILS: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig extends Env {
  isProduction: boolean;
  isTest: boolean;
  sessionSecret: string;
  reportLinkSecret: string;
  adminEmails: Set<string>;
  smtpConfigured: boolean;
  emailOutboxDir: string;
  /** Problems worth surfacing at startup (never contains secret values). */
  warnings: string[];
}

let dotenvLoaded = false;
export function loadDotenvFiles(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  loadDotenv({ path: [path.join(REPO_ROOT, '.env'), path.join(API_ROOT, '.env')], quiet: true });
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  const warnings: string[] = [];

  const secret = (name: 'SESSION_SECRET' | 'REPORT_LINK_SECRET'): string => {
    const value = env[name];
    if (value && value.length >= 32) return value;
    if (isProduction) throw new Error(`${name} must be set to at least 32 characters in production`);
    warnings.push(`${name} is not set (or shorter than 32 chars); using a random value for this process only.`);
    return randomBytes(32).toString('hex');
  };

  const smtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_FROM_EMAIL);
  if (!smtpConfigured) {
    warnings.push(
      isProduction
        ? 'SMTP is not configured; email reports and alerts are disabled.'
        : 'SMTP is not configured; emails will be written to the local outbox directory instead of being sent.',
    );
  }
  if (!env.DATABASE_URL) warnings.push('DATABASE_URL is not set; history, auth, reports and monitoring are unavailable.');
  if (!env.REDIS_URL) warnings.push('REDIS_URL is not set; using in-memory cache and monitoring is disabled.');
  if (env.TRAIN_DATA_PROVIDER === 'mock') warnings.push('TRAIN_DATA_PROVIDER=mock — all train data is simulated DEMO DATA.');
  if (isProduction && env.TRAIN_DATA_PROVIDER === 'mock') warnings.push('Running the demo simulator in production.');

  return {
    ...env,
    isProduction,
    isTest: env.NODE_ENV === 'test',
    sessionSecret: secret('SESSION_SECRET'),
    reportLinkSecret: secret('REPORT_LINK_SECRET'),
    adminEmails: new Set(
      (env.ADMIN_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
    smtpConfigured,
    emailOutboxDir: env.EMAIL_OUTBOX_DIR ?? path.join(API_ROOT, '.mail-outbox'),
    warnings,
  };
}
