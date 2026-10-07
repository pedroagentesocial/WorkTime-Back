import type { ClientInfo } from '#shared/application/client-info.js';

export interface StoredRefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly tokenVersion: number;
  // Empresa activa de la sesion; null si no hay (se guarda para que renovar no la pierda)
  readonly companyId: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedById: string | null;
}

export interface NewRefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly tokenHash: string;
  readonly tokenVersion: number;
  readonly companyId: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly client: ClientInfo;
}

export interface RefreshTokenRepository {
  create(token: NewRefreshToken): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredRefreshToken | null>;
  familyStartedAt(familyId: string): Promise<Date | null>;
  markReplaced(id: string, replacedById: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}
