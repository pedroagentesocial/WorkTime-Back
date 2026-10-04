import { loadEnv } from '#config/env.js';
import {
  createPrismaClient,
  type PrismaClient,
} from '#shared/infrastructure/prisma/prisma-client.js';
import { toTestDatabaseUrl } from '../setup/test-database.js';

export function testDatabaseUrl(): string {
  return toTestDatabaseUrl(loadEnv().databaseUrl);
}

export function createTestPrisma(): PrismaClient {
  return createPrismaClient({ databaseUrl: testDatabaseUrl() });
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;

  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
  // eslint-disable-next-line no-restricted-properties
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
