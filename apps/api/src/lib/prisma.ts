import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { AppError } from './errors.ts';

export type Db = PrismaClient;
export { Prisma } from '../generated/prisma/client.ts';

export function createPrisma(databaseUrl: string): Db {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: 10,
      // The adapter sends timestamps without a zone, which PostgreSQL reads in the session time zone.
      // Pin sessions to UTC so instants are stored correctly even when the server runs in e.g. Asia/Calcutta.
      options: '-c TimeZone=UTC',
    }),
  });
}

/** Throw a clean 503 when a feature needs the database but none is configured. */
export function requireDb(db: Db | null): Db {
  if (!db) throw new AppError('DATABASE_UNAVAILABLE', 'This feature needs the database, which is not configured on this server.');
  return db;
}
