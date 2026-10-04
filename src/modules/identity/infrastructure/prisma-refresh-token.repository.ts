import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  NewRefreshToken,
  RefreshTokenRepository,
  StoredRefreshToken,
} from '../application/ports/refresh-token.repository.js';

interface Deps {
  db: PrismaDb;
}

const MAX_USER_AGENT = 255;
const MAX_IP = 45;

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async create(token: NewRefreshToken): Promise<void> {
    await this.db.client.refreshToken.create({
      data: {
        id: token.id,
        userId: token.userId,
        familyId: token.familyId,
        tokenHash: token.tokenHash,
        tokenVersion: token.tokenVersion,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
        ip: token.client.ip?.slice(0, MAX_IP) ?? null,
        userAgent: token.client.userAgent?.slice(0, MAX_USER_AGENT) ?? null,
      },
    });
  }

  findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    return this.db.client.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        tokenVersion: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
      },
    });
  }

  async familyStartedAt(familyId: string): Promise<Date | null> {
    const { _min } = await this.db.client.refreshToken.aggregate({
      where: { familyId },
      _min: { createdAt: true },
    });
    return _min.createdAt;
  }

  async markReplaced(id: string, replacedById: string, at: Date): Promise<boolean> {
    const { count } = await this.db.client.refreshToken.updateMany({
      where: { id, revokedAt: null, replacedById: null },
      data: { revokedAt: at, replacedById },
    });
    return count === 1;
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.db.client.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.db.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
