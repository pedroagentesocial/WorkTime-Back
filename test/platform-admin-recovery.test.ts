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

describe('Rescate del admin global por consola', () => {
  it('da una temporal nueva, lo desbloquea, lo reactiva y cierra sus sesiones', async () => {
    const { app, container } = createTestApp();
    const admin = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    const oldSession = await login(app, admin.email, DEFAULT_PASSWORD);
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        status: 'inactive',
        failedLoginAttempts: 3,
        lockLevel: 4,
        lockedUntil: new Date('2099-01-01'),
      },
    });

    const result = await container.cradle.recoverPlatformAdmin.execute();
    expect(result.admin).toEqual({ id: admin.id, email: admin.email });
    expect(result.temporaryPassword).toHaveLength(16);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row).toMatchObject({
      status: 'active',
      failedLoginAttempts: 0,
      lockLevel: 0,
      lockedUntil: null,
      mustChangePassword: true,
    });
    expect(row.temporaryPasswordExpiresAt).toEqual(result.temporaryPasswordExpiresAt);

    await request(app).get(api('/auth/me')).set(bearer(oldSession.accessToken)).expect(401);
    await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: oldSession.refreshToken })
      .expect(401);
    await request(app)
      .post(api('/auth/login'))
      .send({ email: admin.email, password: DEFAULT_PASSWORD })
      .expect(401);

    const fresh = await login(app, admin.email, result.temporaryPassword);
    expect(fresh.user.mustChangePassword).toBe(true);
  });

  it('deja el evento en la auditoría', async () => {
    const { container } = createTestApp();
    const admin = await createUser(prisma, { role: Role.PLATFORM_ADMIN });

    await container.cradle.recoverPlatformAdmin.execute();

    const events = await prisma.securityEvent.findMany({
      where: { type: 'platform_admin.recovered' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: admin.id, metadata: { channel: 'cli' } });
  });

  it('no toca a ningún otro usuario', async () => {
    const { container } = createTestApp();
    await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    const company = await createCompany(prisma);
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    });
    const multiAdmin = await createUser(prisma, { role: Role.MULTI_COMPANY_ADMIN });
    const before = await prisma.user.findMany({
      where: { id: { in: [companyAdmin.id, multiAdmin.id] } },
      orderBy: { id: 'asc' },
    });

    await container.cradle.recoverPlatformAdmin.execute();

    const after = await prisma.user.findMany({
      where: { id: { in: [companyAdmin.id, multiAdmin.id] } },
      orderBy: { id: 'asc' },
    });
    expect(after).toEqual(before);
  });

  it('sin admin global → PLATFORM_ADMIN_NOT_FOUND y no crea nada', async () => {
    const { container } = createTestApp();
    await expect(container.cradle.recoverPlatformAdmin.execute()).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_NOT_FOUND',
    });
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.securityEvent.count()).toBe(0);
  });

  it('con dos admins globales no toca ninguno → PLATFORM_ADMIN_AMBIGUOUS', async () => {
    const { container } = createTestApp();
    await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    const before = await prisma.user.findMany({ orderBy: { id: 'asc' } });

    await expect(container.cradle.recoverPlatformAdmin.execute()).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_AMBIGUOUS',
    });
    expect(await prisma.user.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });
});
