import type { Logger } from '../lib/logger.ts';
import type { Db } from '../lib/prisma.ts';
import { hmacSha256 } from '../lib/crypto.ts';
import type { Prisma } from '../generated/prisma/client.ts';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  /** Never include secrets or recipient addresses here — counts and ids only. */
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export class AuditService {
  constructor(
    private readonly db: Db | null,
    private readonly secret: string,
    private readonly logger: Logger,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          // Hashed so audit rows can correlate abuse without storing raw IP addresses.
          ipHash: entry.ip ? hmacSha256(this.secret, entry.ip).slice(0, 32) : null,
        },
      });
    } catch (err) {
      this.logger.warn({ err, action: entry.action }, 'audit write failed');
    }
  }
}
