import { SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { Env } from '#config/env.js';
import { SECURITY } from '#config/security.js';
import { Role } from '#shared/domain/permissions.js';
import { UnauthorizedError } from '#shared/domain/errors.js';
import { JoseTokenService } from './jose-token-service.js';

const SECRET = 'x'.repeat(64);
const env = { jwt: { secret: SECRET, accessTtlMs: 15 * 60_000 } } as Env;

function serviceAt(date: Date, secret = SECRET) {
  return new JoseTokenService({
    env: { ...env, jwt: { ...env.jwt, secret } },
    clock: { now: () => date },
  });
}

const claims = {
  userId: '0199a1b2-0000-7000-8000-000000000001',
  role: Role.COMPANY_ADMIN,
  companyId: '0199a1b2-0000-7000-8000-0000000000aa',
  tokenVersion: 3,
};

async function expectUnauthorized(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(UnauthorizedError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('JoseTokenService', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('firma y verifica un token conservando los claims', async () => {
    const service = serviceAt(now);
    const { token, expiresAt } = await service.signAccessToken(claims);

    expect(expiresAt.toISOString()).toBe('2026-06-01T12:15:00.000Z');
    await expect(service.verifyAccessToken(token)).resolves.toEqual(claims);
  });

  it('acepta companyId null (admin global)', async () => {
    const service = serviceAt(now);
    const platform = { ...claims, role: Role.PLATFORM_ADMIN, companyId: null };
    const { token } = await service.signAccessToken(platform);
    await expect(service.verifyAccessToken(token)).resolves.toEqual(platform);
  });

  it('rechaza un token expirado con TOKEN_EXPIRED', async () => {
    const { token } = await serviceAt(now).signAccessToken(claims);
    const later = serviceAt(new Date(now.getTime() + 16 * 60_000));
    await expectUnauthorized(later.verifyAccessToken(token), 'TOKEN_EXPIRED');
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const { token } = await serviceAt(now, 'y'.repeat(64)).signAccessToken(claims);
    await expectUnauthorized(serviceAt(now).verifyAccessToken(token), 'INVALID_TOKEN');
  });

  it('rechaza un token sin firma (alg: none)', async () => {
    const unsigned = new UnsecuredJWT({ role: claims.role, cid: claims.companyId, ver: 3 })
      .setSubject(claims.userId)
      .setIssuer(SECURITY.jwt.issuer)
      .setAudience(SECURITY.jwt.audience)
      .setIssuedAt()
      .setExpirationTime('10m')
      .encode();
    await expectUnauthorized(serviceAt(new Date()).verifyAccessToken(unsigned), 'INVALID_TOKEN');
  });

  it('rechaza un token manipulado', async () => {
    const service = serviceAt(now);
    const { token } = await service.signAccessToken(claims);
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: claims.userId, role: Role.PLATFORM_ADMIN, cid: null, ver: 3 }),
    ).toString('base64url');
    await expectUnauthorized(
      service.verifyAccessToken(`${header}.${forgedPayload}.${signature}`),
      'INVALID_TOKEN',
    );
  });

  it('rechaza un token con otra audiencia o emisor', async () => {
    const secret = new TextEncoder().encode(SECRET);
    const foreign = await new SignJWT({ role: claims.role, cid: claims.companyId, ver: 3 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer('otro-sistema')
      .setAudience(SECURITY.jwt.audience)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(secret);
    await expectUnauthorized(serviceAt(new Date()).verifyAccessToken(foreign), 'INVALID_TOKEN');
  });

  it('rechaza un token con un rol desconocido', async () => {
    const secret = new TextEncoder().encode(SECRET);
    const weird = await new SignJWT({ role: 'superuser', cid: null, ver: 1 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer(SECURITY.jwt.issuer)
      .setAudience(SECURITY.jwt.audience)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(secret);
    await expectUnauthorized(serviceAt(new Date()).verifyAccessToken(weird), 'INVALID_TOKEN');
  });

  it('rechaza basura', async () => {
    await expectUnauthorized(serviceAt(now).verifyAccessToken('no-es-un-jwt'), 'INVALID_TOKEN');
  });
});
