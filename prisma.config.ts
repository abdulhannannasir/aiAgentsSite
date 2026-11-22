import { defineConfig } from 'prisma/config';

// Prisma CLI configuration (prisma generate / migrate). The app itself connects through the pg driver adapter
// with DATABASE_URL (server/src/db/client.ts). `generate` works without a database; `migrate` needs DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' }
});
