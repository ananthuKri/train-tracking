import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Load the monorepo-root .env first, then an optional apps/api/.env override.
loadEnv({ path: [path.resolve(import.meta.dirname, '../../.env'), path.resolve(import.meta.dirname, '.env')], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` does not need a live database, so fall back to a placeholder URL.
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
