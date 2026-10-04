import { errors, jwtVerify, SignJWT } from 'jose';
import type { Env } from '#config/env.js';
import { SECURITY } from '#config/security.js';
import { Role } from '#shared/domain/permissions.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type {
  AccessTokenClaims,
  IssuedAccessToken,
  TokenService,
} from '#shared/application/ports/token-service.js';
import { UnauthorizedError } from '#shared/domain/errors.js';

const ROLES = new Set<string>(Object.values(Role));

interface Deps {
  env: Env;
  clock: Clock;
}

export class JoseTokenService implements TokenService {
  private readonly secret: Uint8Array;
  private readonly ttlMs: number;
  private readonly clock: Clock;

  constructor({ env, clock }: Deps) {
    this.secret = new TextEncoder().encode(env.jwt.secret);
    this.ttlMs = env.jwt.accessTtlMs;
    this.clock = clock;
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    const token = await new SignJWT({
      role: claims.role,
      cid: claims.companyId,
      ver: claims.tokenVersion,
    })
      .setProtectedHeader({ alg: SECURITY.jwt.algorithm, typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(SECURITY.jwt.issuer)
      .setAudience(SECURITY.jwt.audience)
      .setIssuedAt(toEpochSeconds(now))
      .setExpirationTime(toEpochSeconds(expiresAt))
      .sign(this.secret);

    return { token, expiresAt };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, this.secret, {
        algorithms: [SECURITY.jwt.algorithm],
        issuer: SECURITY.jwt.issuer,
        audience: SECURITY.jwt.audience,
        currentDate: this.clock.now(),
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new UnauthorizedError('TOKEN_EXPIRED', 'La sesión expiró; renueva el token');
      }
      throw invalidToken();
    }

    const { sub, role, cid, ver } = payload;
    if (
      typeof sub !== 'string' ||
      typeof role !== 'string' ||
      !ROLES.has(role) ||
      !(typeof cid === 'string' || cid === null) ||
      typeof ver !== 'number' ||
      !Number.isInteger(ver)
    ) {
      throw invalidToken();
    }

    return { userId: sub, role: role as Role, companyId: cid, tokenVersion: ver };
  }
}

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function invalidToken(): UnauthorizedError {
  return new UnauthorizedError('INVALID_TOKEN', 'Token inválido');
}
