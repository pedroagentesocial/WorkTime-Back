import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  PlatformAdminRepository,
  PlatformAdminSummary,
} from '../application/ports/platform-admin.repository.js';

interface Deps {
  db: PrismaDb;
}

export class PrismaPlatformAdminRepository implements PlatformAdminRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async recoverAccess(password: {
    passwordHash: string;
    expiresAt: Date;
  }): Promise<PlatformAdminSummary | null> {
    const admin = await this.db.client.user.findFirst({
      where: { role: 'platform_admin' },
      select: { id: true },
    });
    if (!admin) return null;

    return this.db.client.user.update({
      where: { id: admin.id },
      data: {
        status: 'active',
        passwordHash: password.passwordHash,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: password.expiresAt,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lockLevel: 0,
        tokenVersion: { increment: 1 },
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
  }
}
