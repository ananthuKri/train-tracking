import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config/env.ts';
import { AppError } from '../lib/errors.ts';
import { randomToken } from '../lib/crypto.ts';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string | Buffer; contentType: string }[];
}

export interface Mailer {
  /** smtp = real delivery; outbox = development fallback writing .eml files; disabled = refuse to send. */
  readonly mode: 'smtp' | 'outbox' | 'disabled';
  send(message: MailMessage): Promise<{ messageId: string | null }>;
}

class SmtpMailer implements Mailer {
  readonly mode = 'smtp' as const;
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
  ) {}

  async send(message: MailMessage) {
    const info = await this.transport.sendMail({ from: this.from, ...message });
    return { messageId: info.messageId ?? null };
  }
}

/** Development fallback: renders the full MIME message to apps/api/.mail-outbox/*.eml. */
class OutboxMailer implements Mailer {
  readonly mode = 'outbox' as const;
  private readonly transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

  constructor(
    private readonly dir: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage) {
    const info = await this.transport.sendMail({ from: this.from, ...message });
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomToken(4)}.eml`);
    await writeFile(file, info.message as Buffer);
    return { messageId: info.messageId ?? null };
  }
}

class DisabledMailer implements Mailer {
  readonly mode = 'disabled' as const;
  async send(): Promise<never> {
    throw new AppError('EMAIL_NOT_CONFIGURED', 'Email delivery is not configured on this server.');
  }
}

export function createMailer(config: AppConfig): Mailer {
  const fromAddress = config.SMTP_FROM_EMAIL ?? 'no-reply@railtrack.local';
  const from = `"${config.SMTP_FROM_NAME.replace(/"/g, '')}" <${fromAddress}>`;
  if (config.smtpConfigured) {
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS ?? '' } : undefined,
      // Never log message bodies or credentials.
      logger: false,
      debug: false,
    });
    return new SmtpMailer(transport, from);
  }
  if (config.isProduction) return new DisabledMailer();
  return new OutboxMailer(config.emailOutboxDir, from);
}

/** Collects messages in memory (tests). */
export class MemoryMailer implements Mailer {
  readonly mode = 'smtp' as const;
  readonly sent: MailMessage[] = [];
  failFor = new Set<string>();

  async send(message: MailMessage) {
    if (this.failFor.has(message.to)) throw new Error('Simulated SMTP rejection');
    this.sent.push(message);
    return { messageId: `<test-${this.sent.length}@railtrack.local>` };
  }
}
