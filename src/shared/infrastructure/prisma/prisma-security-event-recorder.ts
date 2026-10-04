import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { Logger } from '#shared/application/ports/logger.js';
import type {
  SecurityEventInput,
  SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { Prisma } from '#generated/prisma/client.js';
import type { PrismaDb } from './prisma-db.js';

interface Deps {
  db: PrismaDb;
  idGenerator: IdGenerator;
  logger: Logger;
}

const MAX_USER_AGENT = 255;
const MAX_IP = 45;

export class PrismaSecurityEventRecorder implements SecurityEventRecorder {
  private readonly db: PrismaDb;
  private readonly idGenerator: IdGenerator;
  private readonly logger: Logger;

  constructor({ db, idGenerator, logger }: Deps) {
    this.db = db;
    this.idGenerator = idGenerator;
    this.logger = logger.child({ component: 'security-events' });
  }

  async recordOrThrow(event: SecurityEventInput): Promise<void> {
    await this.db.client.securityEvent.create({
      data: {
        id: this.idGenerator.generate(),
        type: event.type,
        userId: event.userId ?? null,
        companyId: event.companyId ?? null,
        ip: event.client?.ip?.slice(0, MAX_IP) ?? null,
        userAgent: event.client?.userAgent?.slice(0, MAX_USER_AGENT) ?? null,
        ...(event.metadata && { metadata: event.metadata as Prisma.InputJsonObject }),
      },
    });
  }

  async record(event: SecurityEventInput): Promise<void> {
    try {
      await this.recordOrThrow(event);
    } catch (error) {
      this.logger.error({ err: error, type: event.type }, 'No se pudo registrar el evento');
    }
  }
}
