import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  PlatformAdminRepository,
  PlatformAdminView,
} from '../application/ports/platform-admin.repository.js';

interface Deps {
  db: PrismaDb;
}

const IS_PLATFORM_ADMIN = { role: 'platform_admin' } as const;

export class PrismaPlatformAdminRepository implements PlatformAdminRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async listAll(): Promise<PlatformAdminView[]> {
    return this.db.client.user.findMany({
      where: IS_PLATFORM_ADMIN,
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async recover(id: string, password: { passwordHash: string; expiresAt: Date }): Promise<void> {
    await this.db.client.user.update({
      where: { id, ...IS_PLATFORM_ADMIN },
      data: {
        passwordHash: password.passwordHash,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: password.expiresAt,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lockLevel: 0,
        tokenVersion: { increment: 1 },
      },
    });
  }
}
