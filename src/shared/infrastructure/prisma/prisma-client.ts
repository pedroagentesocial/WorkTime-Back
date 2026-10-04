import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '#config/env.js';
import type { Logger } from '#shared/application/ports/logger.js';
import { PrismaClient } from '#generated/prisma/client.js';

export type { PrismaClient };

export function createPrismaClient(env: Pick<Env, 'databaseUrl'>, logger?: Logger): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.databaseUrl });
  const prisma = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  if (logger) {
    const log = logger.child({ component: 'prisma' });
    prisma.$on('warn', (event) => {
      log.warn({ target: event.target }, event.message);
    });
    prisma.$on('error', (event) => {
      log.error({ target: event.target }, event.message);
    });
  }

  return prisma;
}
