import { pino, type Logger } from 'pino';

/**
 * Structured logger. Secrets and personal data are redacted by path; code must also avoid
 * putting API keys, SMTP credentials or recipient addresses into log messages.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.apiKey',
  '*.token',
  '*.smtpPass',
  '*.recipients',
  '*.recipient',
  '*.email',
  '*.to',
];

export function createLogger(options: { level?: string; pretty?: boolean } = {}): Logger {
  return pino({
    level: options.level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'railtrack-api' },
    transport: options.pretty ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' } } : undefined,
  });
}

export type { Logger };
