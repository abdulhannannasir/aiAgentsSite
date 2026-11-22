import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type Db = PrismaClient;
export { Prisma } from '../generated/prisma/client.js';

/** One Prisma client per process, talking to Postgres through the pg driver adapter. */
export function createDb(url: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
