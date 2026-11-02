import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { JOBS } from '#config/jobs.js';
import { modules } from '#modules/index.js';
import { PurgeOldDataUseCase } from '#modules/maintenance/application/purge-old-data.use-case.js';
import { PrismaDataRetentionRepository } from '#modules/maintenance/infrastructure/prisma-data-retention.repository.js';
import { ATTENDANCE_ACTIVITY_TYPES } from '#modules/timekeeping/application/ports/attendance-activity.reader.js';
import { KEPT_FOREVER_EVENT_TYPES } from '#modules/maintenance/application/purge-old-data.use-case.js';
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

const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-07T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

function setup() {
  const { app, clock, container } = createTestApp();
  clock.advance(NOW.getTime() - clock.now().getTime());
  return { app, clock, container };
}

async function addToken(userId: string, familyId: string, createdAt: Date) {
  await prisma.refreshToken.create({
    data: {
      id: uuidv7(),
      userId,
      familyId,
      tokenHash: randomBytes(32).toString('hex'),
      tokenVersion: 0,
      expiresAt: new Date(createdAt.getTime() + 7 * DAY_MS),
      createdAt,
    },
  });
}

async function addEvent(type: string, createdAt: Date) {
  await prisma.securityEvent.create({ data: { id: uuidv7(), type, createdAt } });
}

describe('limpieza de sesiones vencidas', () => {
  it('borra las sesiones más viejas que su duración máxima más el margen y conserva el resto', async () => {
    const { container } = setup();
    const user = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    const dead = uuidv7();
    const deadWithRecentToken = uuidv7();
    const edge = uuidv7();
    const alive = uuidv7();
    await addToken(user.id, dead, daysAgo(60));
    await addToken(user.id, deadWithRecentToken, daysAgo(40));
    await addToken(user.id, deadWithRecentToken, daysAgo(5));
    await addToken(user.id, edge, daysAgo(36));
    await addToken(user.id, alive, daysAgo(20));

    const result = await container.cradle.purgeOldData.execute();

    expect(result.refreshTokens).toBe(3);
    const left = await prisma.refreshToken.findMany({ select: { familyId: true } });
    expect(new Set(left.map((t) => t.familyId))).toEqual(new Set([edge, alive]));
  });

  it('una sesión activa sigue funcionando después de la limpieza', async () => {
    const { app, container } = setup();
    const company = await createCompany(prisma);
    const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
    const session = await login(app, admin.email, DEFAULT_PASSWORD);
    await addToken(admin.id, uuidv7(), daysAgo(90));

    await container.cradle.purgeOldData.execute();

    const refreshed = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(
      (await request(app).get(api('/auth/me')).set(bearer(refreshed.body.data.accessToken))).status,
    ).toBe(200);
  });
});

describe('limpieza de eventos de seguridad', () => {
  it('borra los viejos salvo la auditoría de las horas', async () => {
    const { container } = setup();
    await addEvent('login.succeeded', daysAgo(400));
    await addEvent('login.failed', daysAgo(366));
    await addEvent('time_entry.voided_by_admin', daysAgo(800));
    await addEvent('pay_period.closed', daysAgo(800));
    await addEvent('login.succeeded', daysAgo(364));
    await addEvent('login.succeeded', daysAgo(1));

    const result = await container.cradle.purgeOldData.execute();

    expect(result.securityEvents).toBe(2);
    const left = await prisma.securityEvent.findMany({ select: { type: true, createdAt: true } });
    expect(left).toHaveLength(4);
    expect(left.filter((e) => e.type === 'login.succeeded')).toHaveLength(2);
    expect(left.map((e) => e.type)).toEqual(
      expect.arrayContaining(['time_entry.voided_by_admin', 'pay_period.closed']),
    );
  });

  it('se conserva la actividad que ve el admin y todo lo que cambia el pago', () => {
    expect([...KEPT_FOREVER_EVENT_TYPES].sort()).toEqual(
      [
        ...ATTENDANCE_ACTIVITY_TYPES,
        'employee.pay_rate_changed',
        'employee.pay_rate_removed',
        'employee.deactivated',
        'employee.reactivated',
        'employee.updated',
        'company.settings_updated',
      ].sort(),
    );
  });
});

describe('ejecución', () => {
  it('es idempotente: una segunda pasada no encuentra nada', async () => {
    const { container } = setup();
    const user = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    await addToken(user.id, uuidv7(), daysAgo(90));
    await addEvent('login.succeeded', daysAgo(500));

    expect(await container.cradle.purgeOldData.execute()).toEqual({
      refreshTokens: 1,
      securityEvents: 1,
    });
    expect(await container.cradle.purgeOldData.execute()).toEqual({
      refreshTokens: 0,
      securityEvents: 0,
    });
  });

  it('borra por lotes y respeta el tope de lotes por ejecución', async () => {
    const { clock } = setup();
    const user = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    for (let i = 0; i < 5; i += 1) await addToken(user.id, uuidv7(), daysAgo(90));
    for (let i = 0; i < 5; i += 1) await addEvent('login.succeeded', daysAgo(500));

    const limited = new PurgeOldDataUseCase({
      dataRetentionRepository: new PrismaDataRetentionRepository({
        db: createTestApp().container.cradle.db,
      }),
      retentionPolicy: {
        sessionMaxAgeDays: 30,
        refreshTokenGraceDays: 7,
        securityEventDays: 365,
        batchSize: 2,
        maxBatchesPerRun: 2,
      },
      clock,
    });

    expect(await limited.execute()).toEqual({ refreshTokens: 4, securityEvents: 4 });
    expect(await limited.execute()).toEqual({ refreshTokens: 1, securityEvents: 1 });
    expect(await prisma.refreshToken.count()).toBe(0);
    expect(await prisma.securityEvent.count()).toBe(0);
  });

  it('está registrada como tarea periódica', () => {
    const { container } = setup();
    const jobs = modules.flatMap((module) => [...(module.jobs?.(container) ?? [])]);
    const purge = jobs.find((job) => job.name === 'purge-old-data');
    expect(purge?.intervalMs).toBe(JOBS.purgeOldDataMs);
  });
});
