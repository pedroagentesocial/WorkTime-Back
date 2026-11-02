import type { AccessLinkStore } from '#shared/application/ports/access-link-store.js';
import type { PrismaDb } from './prisma-db.js';

interface Deps {
  db: PrismaDb;
}

// Misma tabla que la recuperacion de contrasena: el enlace se confirma por la misma ruta
export class PrismaAccessLinkStore implements AccessLinkStore {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async replaceForUser(link: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    ip: string | null;
  }): Promise<void> {
    await this.db.client.passwordResetToken.deleteMany({ where: { userId: link.userId } });
    await this.db.client.passwordResetToken.create({ data: link });
  }
}
