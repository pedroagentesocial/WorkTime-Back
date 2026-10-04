import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type { DataRetentionRepository } from '../application/ports/data-retention.repository.js';

interface Deps {
  db: PrismaDb;
}

export class PrismaDataRetentionRepository implements DataRetentionRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async deleteSessionsStartedBefore(startedBefore: Date, batchSize: number): Promise<number> {
    return this.db.client.$executeRaw`
      DELETE FROM refresh_tokens
      WHERE family_id IN (
        SELECT family_id FROM refresh_tokens
        GROUP BY family_id
        HAVING MIN(created_at) < ${startedBefore}::timestamptz
        LIMIT ${batchSize}
      )`;
  }

  async deleteSecurityEventsBefore(
    createdBefore: Date,
    keepTypes: readonly string[],
    batchSize: number,
  ): Promise<number> {
    return this.db.client.$executeRaw`
      DELETE FROM security_events
      WHERE id IN (
        SELECT id FROM security_events
        WHERE created_at < ${createdBefore}::timestamptz
          AND NOT (type = ANY(${[...keepTypes]}::text[]))
        ORDER BY created_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )`;
  }
}
