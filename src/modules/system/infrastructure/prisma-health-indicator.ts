import type { PrismaClient } from '#shared/infrastructure/prisma/prisma-client.js';
import type { HealthIndicator } from '../application/ports/health-indicator.js';

interface Deps {
  prisma: PrismaClient;
}

export class PrismaHealthIndicator implements HealthIndicator {
  readonly name = 'database';
  private readonly prisma: PrismaClient;

  constructor({ prisma }: Deps) {
    this.prisma = prisma;
  }

  async isHealthy(): Promise<boolean> {
    await this.prisma.$queryRaw`SELECT 1`;
    return true;
  }
}
