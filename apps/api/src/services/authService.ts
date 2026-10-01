import jwt from 'jsonwebtoken';
import type { User } from '@railtrack/shared';
import type { AppConfig } from '../config/env.ts';
import { AppError } from '../lib/errors.ts';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../lib/crypto.ts';
import { requireDb, type Db } from '../lib/prisma.ts';
import { Prisma } from '../lib/prisma.ts';
import type { AuditService } from './auditService.ts';

export const SESSION_COOKIE = 'rt_session';
export const SESSION_TTL_SECONDS = 7 * 86_400;

export interface SessionClaims {
  userId: string;
  role: 'USER' | 'ADMIN';
}

export class AuthService {
  constructor(
    private readonly deps: {
      db: Db | null;
      config: AppConfig;
      audit: AuditService;
    },
  ) {}

  async register(input: { email: string; password: string; name?: string }, ip: string | null): Promise<User> {
    const db = requireDb(this.deps.db);
    const role = this.deps.config.adminEmails.has(input.email) ? 'ADMIN' : 'USER';
    try {
      const user = await db.user.create({
        data: { email: input.email, passwordHash: await hashPassword(input.password), name: input.name || null, role },
      });
      await this.deps.audit.record({ userId: user.id, action: 'auth.register', ip });
      return toUser(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('CONFLICT', 'An account with this email already exists. Sign in instead.');
      }
      throw err;
    }
  }

  async login(input: { email: string; password: string }, ip: string | null): Promise<User> {
    const db = requireDb(this.deps.db);
    const user = await db.user.findUnique({ where: { email: input.email } });
    // Always run the hash comparison so response time does not reveal whether the account exists.
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid) {
      await this.deps.audit.record({ userId: user?.id ?? null, action: 'auth.login_failed', ip });
      throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect.');
    }
    await this.deps.audit.record({ userId: user.id, action: 'auth.login', ip });
    return toUser(user);
  }

  async getUser(userId: string): Promise<User | null> {
    if (!this.deps.db) return null;
    const user = await this.deps.db.user.findUnique({ where: { id: userId } });
    return user ? toUser(user) : null;
  }

  issueToken(user: User): string {
    return jwt.sign({ role: user.role }, this.deps.config.sessionSecret, {
      subject: user.id,
      expiresIn: SESSION_TTL_SECONDS,
      issuer: 'railtrack-live',
      algorithm: 'HS256',
    });
  }

  verifyToken(token: string): SessionClaims | null {
    try {
      const payload = jwt.verify(token, this.deps.config.sessionSecret, { issuer: 'railtrack-live', algorithms: ['HS256'] });
      if (typeof payload === 'string' || !payload.sub) return null;
      return { userId: payload.sub, role: payload.role === 'ADMIN' ? 'ADMIN' : 'USER' };
    } catch {
      return null;
    }
  }
}

function toUser(user: { id: string; email: string; name: string | null; role: 'USER' | 'ADMIN' }): User {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
