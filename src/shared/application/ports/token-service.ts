import type { Role } from '#shared/domain/permissions.js';

export interface AccessTokenClaims {
  readonly userId: string;
  readonly role: Role;
  readonly companyId: string | null;
  readonly tokenVersion: number;
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface TokenService {
  signAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
}
