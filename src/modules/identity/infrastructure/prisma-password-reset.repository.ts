import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  PasswordResetRepository,
  StoredPasswordReset,
} from '../application/ports/password-reset.repository.js';

interface Deps {
  db: PrismaDb;
}

export class PrismaPasswordResetRepository implements PasswordResetRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async latestCreatedAt(userId: string): Promise<Date | null> {
    const row = await this.db.client.passwordResetToken.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  async replaceForUser(reset: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    ip: string | null;
  }): Promise<void> {
    await this.db.client.passwordResetToken.deleteMany({ where: { userId: reset.userId } });
    await this.db.client.passwordResetToken.create({ data: reset });
  }

  async findByHash(tokenHash: string): Promise<StoredPasswordReset | null> {
    return this.db.client.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
  }

  async markUsed(id: string, at: Date): Promise<boolean> {
    const { count } = await this.db.client.passwordResetToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: at },
    });
    return count === 1;
  }
}
