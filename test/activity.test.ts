import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import type { FakeClock } from './helpers/fake-clock.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import {
  createCompany,
  createEmployee,
  createUser,
  DEFAULT_PASSWORD,
  CLOCK_IN_LOCATION,
} from './helpers/fixtures.js';
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

const NOW = '2026-10-07T18:00:00Z';

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
}

async function setup() {
  const { app, clock } = createTestApp();
  setTime(clock, NOW);
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  await prisma.user.update({ where: { id: admin.id }, data: { firstName: 'Carlos' } });
  const ana = await createEmployee(prisma, company.id, { firstName: 'Ana' });
  const beto = await createEmployee(prisma, company.id, { firstName: 'Beto' });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asAna = bearer((await login(app, ana.user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, company, admin, ana: ana.employee, beto: beto.employee, asAdmin, asAna };
}

const get = (app: Express, auth: Record<string, string>, path: string) =>
  request(app).get(api(path)).set(auth);
const post = (app: Express, auth: Record<string, string>, path: string, body: object = {}) =>
  request(app).post(api(path)).set(auth).send(body);

interface Item {
  type: string;
  actor: { firstName: string } | null;
  employee: { firstName: string } | null;
  details: Record<string, unknown>;
}

async function doEverything(app: Express, asAdmin: Record<string, string>, employeeId: string) {
  await post(app, asAdmin, `/company/employees/${employeeId}/clock-in`);
  await post(app, asAdmin, `/company/employees/${employeeId}/clock-out`);
  const manual = await post(app, asAdmin, `/company/employees/${employeeId}/time-entries`, {
    clockInAt: '2026-10-06T08:00:00-06:00',
    clockOutAt: '2026-10-06T12:00:00-06:00',
    reason: 'Olvidó marcar la jornada',
  });
  await request(app)
    .patch(api(`/company/time-entries/${manual.body.data.id}`))
    .set(asAdmin)
    .send({ clockOutAt: '2026-10-06T13:00:00-06:00', reason: 'Salió más tarde' });
  await post(app, asAdmin, `/company/time-entries/${manual.body.data.id}/void`, {
    reason: 'Se creó por duplicado',
  });
  return manual.body.data.id as string;
}

describe('GET /company/activity', () => {
  it('muestra quién hizo qué, a quién y por qué, lo más reciente primero', async () => {
    const { app, ana, asAdmin } = await setup();
    const entryId = await doEverything(app, asAdmin, ana.id);

    const res = await get(app, asAdmin, '/company/activity');
    expect(res.status).toBe(200);
    const items = res.body.data as Item[];
    expect(items.map((i) => i.type)).toEqual([
      'time_entry.voided_by_admin',
      'time_entry.corrected_by_admin',
      'time_entry.created_by_admin',
      'time_entry.clocked_out_by_admin',
      'time_entry.clocked_in_by_admin',
    ]);
    expect(res.body.meta.total).toBe(5);
    for (const item of items) {
      expect(item.actor?.firstName).toBe('Carlos');
      expect(item.employee?.firstName).toBe('Ana');
    }
    expect(items[0]?.details).toMatchObject({
      timeEntryId: entryId,
      reason: 'Se creó por duplicado',
    });
    expect(items[1]?.details).toMatchObject({
      reason: 'Salió más tarde',
      previousClockOutAt: '2026-10-06T18:00:00.000Z',
      clockOutAt: '2026-10-06T19:00:00.000Z',
    });
    expect(items[2]?.details).toMatchObject({ reason: 'Olvidó marcar la jornada' });
  });

  it('filtra por empleado, por tipo y por rango, y pagina', async () => {
    const { app, ana, beto, asAdmin } = await setup();
    await doEverything(app, asAdmin, ana.id);
    await post(app, asAdmin, `/company/employees/${beto.id}/clock-in`);

    const forBeto = await get(app, asAdmin, `/company/activity?employeeId=${beto.id}`);
    expect(forBeto.body.data).toHaveLength(1);
    expect((forBeto.body.data as Item[])[0]?.employee?.firstName).toBe('Beto');

    const voids = await get(app, asAdmin, '/company/activity?type=time_entry.voided_by_admin');
    expect(voids.body.data).toHaveLength(1);

    const page = await get(app, asAdmin, '/company/activity?limit=2&page=3');
    expect(page.body.meta).toMatchObject({ page: 3, total: 6, totalPages: 3 });
    expect(page.body.data).toHaveLength(2);

    const old = await get(app, asAdmin, '/company/activity?to=2000-01-01T00:00:00Z');
    expect(old.body.data).toEqual([]);
    const since = await get(app, asAdmin, '/company/activity?from=2000-01-01T00:00:00Z');
    expect(since.body.meta.total).toBe(6);
  });

  it('valida los filtros', async () => {
    const { app, asAdmin } = await setup();
    const inverted = await get(
      app,
      asAdmin,
      '/company/activity?from=2026-10-08T00:00:00Z&to=2026-10-01T00:00:00Z',
    );
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe('INVALID_DATE_RANGE');
    expect((await get(app, asAdmin, '/company/activity?type=login')).status).toBe(400);
    expect((await get(app, asAdmin, '/company/activity?employeeId=abc')).status).toBe(400);
    expect((await get(app, asAdmin, `/company/activity?employeeId=${uuidv7()}`)).status).toBe(404);
  });

  it('no muestra inicios de sesión ni acciones del propio empleado', async () => {
    const { app, asAdmin, asAna } = await setup();
    await post(app, asAna, '/me/clock-in', CLOCK_IN_LOCATION);

    const res = await get(app, asAdmin, '/company/activity');
    expect(res.body.data).toEqual([]);
    expect(
      await prisma.securityEvent.count({ where: { type: 'login.succeeded' } }),
    ).toBeGreaterThan(0);
  });

  it('solo ve la actividad de su empresa', async () => {
    const { app, company, asAdmin } = await setup();
    const otherCompany = await createCompany(prisma, { name: 'Otra' });
    const otherAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: otherCompany.id,
    });
    const { employee: foreign } = await createEmployee(prisma, otherCompany.id);
    const asOtherAdmin = bearer((await login(app, otherAdmin.email, DEFAULT_PASSWORD)).accessToken);
    await post(app, asOtherAdmin, `/company/employees/${foreign.id}/clock-in`);

    expect((await get(app, asAdmin, '/company/activity')).body.data).toEqual([]);
    expect((await get(app, asOtherAdmin, '/company/activity')).body.meta.total).toBe(1);
    expect((await get(app, asAdmin, `/company/activity?employeeId=${foreign.id}`)).status).toBe(
      404,
    );
    expect(company.id).not.toBe(otherCompany.id);
  });

  it('solo expone los datos conocidos del evento', async () => {
    const { app, company, admin, ana, asAdmin } = await setup();
    await prisma.securityEvent.create({
      data: {
        id: uuidv7(),
        type: 'time_entry.voided_by_admin',
        userId: admin.id,
        companyId: company.id,
        ip: '10.0.0.1',
        userAgent: 'secreto',
        metadata: { employeeId: ana.id, reason: 'Motivo visible', password: 'no-mostrar', ip: 'x' },
      },
    });

    const res = await get(app, asAdmin, '/company/activity');
    const item = (res.body.data as Item[])[0];
    expect(item?.details).toEqual({ reason: 'Motivo visible' });
    expect(JSON.stringify(res.body)).not.toMatch(/no-mostrar|secreto|10\.0\.0\.1/);
  });

  it('el empleado no tiene acceso', async () => {
    const { app, asAna } = await setup();
    expect((await get(app, asAna, '/company/activity')).status).toBe(403);
  });
});
