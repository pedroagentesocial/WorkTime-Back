import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { createCompany, createUser, DEFAULT_PASSWORD } from './helpers/fixtures.js';
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

describe('Recuperar el acceso del admin global desde la terminal', () => {
  it('da una contraseña temporal, cierra las sesiones y obliga a cambiarla', async () => {
    const { app, container } = createTestApp();
    const admin = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    const before = await login(app, admin.email, DEFAULT_PASSWORD);

    const result = await container.cradle.recoverPlatformAdmin.execute();
    expect(result.admin).toMatchObject({ id: admin.id, email: admin.email });
    expect(result.temporaryPassword).toHaveLength(16);

    // La sesion anterior deja de servir, tanto el access como el refresh
    await request(app).get(api('/auth/me')).set(bearer(before.accessToken)).expect(401);
    await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: before.refreshToken })
      .expect(401);

    await request(app)
      .post(api('/auth/login'))
      .send({ email: admin.email, password: DEFAULT_PASSWORD })
      .expect(401);
    const after = await login(app, admin.email, result.temporaryPassword);
    const me = await request(app).get(api('/auth/me')).set(bearer(after.accessToken)).expect(200);
    expect(me.body.data).toMatchObject({ role: 'platform_admin', mustChangePassword: true });
  });

  it('desbloquea y reactiva la cuenta y deja constancia en la auditoría', async () => {
    const { app, container } = createTestApp();
    const admin = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        status: 'inactive',
        failedLoginAttempts: 7,
        lockLevel: 3,
        lockedUntil: new Date(Date.now() + 3_600_000),
      },
    });

    const result = await container.cradle.recoverPlatformAdmin.execute();
    await login(app, admin.email, result.temporaryPassword);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row).toMatchObject({ status: 'active', lockLevel: 0, mustChangePassword: true });
    expect(row.temporaryPasswordExpiresAt).toEqual(result.temporaryPasswordExpiresAt);
    const events = await prisma.securityEvent.findMany({
      where: { type: 'platform_admin.recovered' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: admin.id, metadata: { source: 'cli' } });
  });

  it('no toca a nadie más que al admin global', async () => {
    const { container } = createTestApp();
    await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    const company = await createCompany(prisma);
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    });
    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: companyAdmin.id } });

    await container.cradle.recoverPlatformAdmin.execute();

    expect(await prisma.user.findUniqueOrThrow({ where: { id: companyAdmin.id } })).toEqual(
      untouched,
    );
  });

  it('sin admin global no crea uno: pide usar el seed', async () => {
    const { container } = createTestApp();
    await expect(container.cradle.recoverPlatformAdmin.execute()).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_NOT_FOUND',
    });
    expect(await prisma.user.count()).toBe(0);
  });
});
