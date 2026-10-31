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

async function setup(options: { requireDailyReport?: boolean } = {}) {
  const { app, clock } = createTestApp();
  setTime(clock, NOW);
  const company = await createCompany(prisma, {
    requireDailyReport: options.requireDailyReport ?? true,
  });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const employee = async (firstName = 'Ana') => {
    const { user, employee } = await createEmployee(prisma, company.id, { firstName });
    const as = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
    return { user, employee, as };
  };
  return { app, clock, company, asAdmin, employee };
}

async function addEntry(
  companyId: string,
  employeeId: string,
  date: string,
  from = '08:00',
  to: string | null = '12:00',
) {
  await prisma.timeEntry.create({
    data: {
      id: uuidv7(),
      companyId,
      employeeId,
      clockInAt: new Date(`${date}T${from}:00-06:00`),
      clockOutAt: to ? new Date(`${date}T${to}:00-06:00`) : null,
      timezone: 'America/Denver',
      workDate: new Date(`${date}T00:00:00.000Z`),
      source: 'web',
    },
  });
}

const get = (app: Express, auth: Record<string, string>, path: string) =>
  request(app).get(api(path)).set(auth);
const post = (app: Express, auth: Record<string, string>, path: string, body: object = {}) =>
  request(app).post(api(path)).set(auth).send(body);

describe('GET /me/daily-reports/pending', () => {
  it('lista los días anteriores con marcajes y sin reporte, sin contar hoy', async () => {
    const { app, company, employee } = await setup();
    const { employee: ana, as } = await employee();
    await addEntry(company.id, ana.id, '2026-10-05');
    await addEntry(company.id, ana.id, '2026-10-06');
    await addEntry(company.id, ana.id, '2026-10-07');
    const written = await request(app)
      .put(api('/me/daily-reports/2026-10-06'))
      .set(as)
      .send({ content: 'Hice varias tareas ayer' });
    expect(written.status).toBe(200);

    const res = await get(app, as, '/me/daily-reports/pending');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ required: true, days: ['2026-10-05'] });
  });

  it('un día con una entrada abierta todavía no está pendiente', async () => {
    const { app, company, employee } = await setup();
    const { employee: ana, as } = await employee();
    await addEntry(company.id, ana.id, '2026-10-06', '20:00', null);

    const res = await get(app, as, '/me/daily-reports/pending');
    expect(res.body.data.days).toEqual([]);
  });

  it('solo cuenta los últimos 14 días', async () => {
    const { app, company, employee } = await setup();
    const { employee: ana, as } = await employee();
    await addEntry(company.id, ana.id, '2026-09-22');
    await addEntry(company.id, ana.id, '2026-09-23');

    const res = await get(app, as, '/me/daily-reports/pending');
    expect(res.body.data.days).toEqual(['2026-09-23']);
  });

  it('sin reporte obligatorio nunca hay pendientes', async () => {
    const { app, company, employee } = await setup({ requireDailyReport: false });
    const { employee: ana, as } = await employee();
    await addEntry(company.id, ana.id, '2026-10-05');

    const res = await get(app, as, '/me/daily-reports/pending');
    expect(res.body.data).toEqual({ required: false, days: [] });
  });

  it('no cuenta los días anteriores a que la empresa exigiera el reporte', async () => {
    const { app, company, employee } = await setup();
    await prisma.company.update({
      where: { id: company.id },
      data: { dailyReportRequiredSince: new Date('2026-10-06T00:00:00.000Z') },
    });
    const { employee: ana, as } = await employee();
    await addEntry(company.id, ana.id, '2026-10-05');
    await addEntry(company.id, ana.id, '2026-10-06');

    const res = await get(app, as, '/me/daily-reports/pending');
    expect(res.body.data.days).toEqual(['2026-10-06']);
  });
});

describe('bloqueo de la entrada por reportes pendientes', () => {
  it('no deja marcar entrada hasta escribir el reporte, y luego sí', async () => {
    const { app, company, employee } = await setup();
    const { employee: ana, as } = await employee();
    await addEntry(company.id, ana.id, '2026-10-05');

    const status = await get(app, as, '/me/clock-status');
    expect(status.body.data).toMatchObject({ pendingReports: ['2026-10-05'], canClockIn: false });

    const blocked = await post(app, as, '/me/clock-in', CLOCK_IN_LOCATION);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DAILY_REPORT_PENDING');
    expect(blocked.body.error.details).toEqual({ dates: ['2026-10-05'] });
    expect(await prisma.timeEntry.count({ where: { clockOutAt: null } })).toBe(0);

    const written = await request(app)
      .put(api('/me/daily-reports/2026-10-05'))
      .set(as)
      .send({ content: 'Trabajé en el inventario' });
    expect(written.status).toBe(200);

    expect((await get(app, as, '/me/clock-status')).body.data).toMatchObject({
      pendingReports: [],
      canClockIn: true,
    });
    expect((await post(app, as, '/me/clock-in', CLOCK_IN_LOCATION)).status).toBe(201);
  });

  it('el admin sí puede marcarle entrada a un empleado con pendientes', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const { employee: ana } = await employee();
    await addEntry(company.id, ana.id, '2026-10-05');

    const res = await post(app, asAdmin, `/company/employees/${ana.id}/clock-in`);
    expect(res.status).toBe(201);
  });

  it('con el reporte opcional no bloquea', async () => {
    const { app, company, employee } = await setup({ requireDailyReport: false });
    const { employee: ana, as } = await employee();
    await addEntry(company.id, ana.id, '2026-10-05');

    expect((await post(app, as, '/me/clock-in', CLOCK_IN_LOCATION)).status).toBe(201);
  });

  it('canClockIn es falso con una entrada abierta', async () => {
    const { app, employee } = await setup();
    const { as } = await employee();
    await post(app, as, '/me/clock-in', CLOCK_IN_LOCATION);

    const status = await get(app, as, '/me/clock-status');
    expect(status.body.data).toMatchObject({ clockedIn: true, canClockIn: false });
  });
});

describe('al encender el reporte obligatorio', () => {
  it('solo cuentan los días nuevos: el historial no bloquea a nadie', async () => {
    const { app, company, employee, asAdmin } = await setup({ requireDailyReport: false });
    const { employee: ana, as } = await employee();
    await addEntry(company.id, ana.id, '2026-10-05');

    const patch = await request(app)
      .patch(api('/company'))
      .set(asAdmin)
      .send({ requireDailyReport: true });
    expect(patch.status).toBe(200);

    const stored = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(stored.dailyReportRequiredSince.toISOString().slice(0, 10)).toBe('2026-10-07');
    expect((await get(app, as, '/me/daily-reports/pending')).body.data.days).toEqual([]);
    expect((await post(app, as, '/me/clock-in', CLOCK_IN_LOCATION)).status).toBe(201);
  });

  it('volver a enviar true no reinicia la fecha', async () => {
    const { app, company, asAdmin } = await setup();
    await prisma.company.update({
      where: { id: company.id },
      data: { dailyReportRequiredSince: new Date('2026-10-01T00:00:00.000Z') },
    });

    await request(app).patch(api('/company')).set(asAdmin).send({ requireDailyReport: true });
    const stored = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(stored.dailyReportRequiredSince.toISOString().slice(0, 10)).toBe('2026-10-01');
  });
});

describe('GET /company/daily-reports/pending', () => {
  it('dice quién debe qué días y solo muestra a quien tiene pendientes', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const { employee: ana } = await employee('Ana');
    const { employee: beto } = await employee('Beto');
    await employee('Carla');
    await addEntry(company.id, ana.id, '2026-10-05');
    await addEntry(company.id, ana.id, '2026-10-06');
    await addEntry(company.id, beto.id, '2026-10-06');

    const res = await get(app, asAdmin, '/company/daily-reports/pending');
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ required: true, total: 2 });
    const rows = res.body.data as { employee: { firstName: string }; days: string[] }[];
    expect(rows.map((row) => [row.employee.firstName, row.days])).toEqual([
      ['Ana', ['2026-10-05', '2026-10-06']],
      ['Beto', ['2026-10-06']],
    ]);
  });

  it('pagina, filtra por empleado y valida el empleado', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const { employee: ana } = await employee('Ana');
    const { employee: beto } = await employee('Beto');
    await addEntry(company.id, ana.id, '2026-10-05');
    await addEntry(company.id, beto.id, '2026-10-05');

    const page = await get(app, asAdmin, '/company/daily-reports/pending?limit=1&page=2');
    expect(page.body.meta).toMatchObject({ page: 2, total: 2, totalPages: 2 });
    expect(page.body.data).toHaveLength(1);

    const one = await get(app, asAdmin, `/company/daily-reports/pending?employeeId=${beto.id}`);
    expect(one.body.data).toHaveLength(1);

    const missing = await get(
      app,
      asAdmin,
      `/company/daily-reports/pending?employeeId=${uuidv7()}`,
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('no incluye desactivados ni empleados de otra empresa', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const { employee: inactive, user } = await employee('Inactivo');
    await addEntry(company.id, inactive.id, '2026-10-05');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'inactive' } });

    const other = await createCompany(prisma, { name: 'Otra', requireDailyReport: true });
    const { employee: foreign } = await createEmployee(prisma, other.id);
    await addEntry(other.id, foreign.id, '2026-10-05');

    const res = await get(app, asAdmin, '/company/daily-reports/pending');
    expect(res.body.data).toEqual([]);

    const foreignFilter = await get(
      app,
      asAdmin,
      `/company/daily-reports/pending?employeeId=${foreign.id}`,
    );
    expect(foreignFilter.status).toBe(404);
  });

  it('con el reporte opcional responde vacío y required false', async () => {
    const { app, company, employee, asAdmin } = await setup({ requireDailyReport: false });
    const { employee: ana } = await employee();
    await addEntry(company.id, ana.id, '2026-10-05');

    const res = await get(app, asAdmin, '/company/daily-reports/pending');
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.required).toBe(false);
  });
});

describe('GET /company/attendance/summary', () => {
  it('resume IN/OUT, horas de hoy, límites alcanzados y reportes pendientes', async () => {
    const { app, company, employee, asAdmin } = await setup();
    await prisma.company.update({ where: { id: company.id }, data: { dailyLimitMinutes: 480 } });
    const { employee: ana } = await employee('Ana');
    const { employee: beto } = await employee('Beto');
    const { employee: carla } = await employee('Carla');
    await addEntry(company.id, ana.id, '2026-10-07', '04:00', '12:00');
    await addEntry(company.id, beto.id, '2026-10-07', '10:00', null);
    await addEntry(company.id, carla.id, '2026-10-05');

    const res = await get(app, asAdmin, '/company/attendance/summary');
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.employees).toEqual({ active: 3, in: 1, out: 2 });
    expect(data.worked).toEqual({ seconds: 10 * 3600, hours: 10 });
    expect(data.atLimit.count).toBe(1);
    expect(data.atLimit.employees[0]).toMatchObject({
      firstName: 'Ana',
      limitMinutes: 480,
      workedSeconds: 8 * 3600,
    });
    expect(data.pendingReports).toEqual({ required: true, employees: 1, days: 1 });
  });

  it('sin actividad todo está en cero y no cuenta desactivados ni otra empresa', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const { user, employee: inactive } = await employee('Inactivo');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'inactive' } });
    await addEntry(company.id, inactive.id, '2026-10-07', '08:00', '10:00');
    const other = await createCompany(prisma, { name: 'Otra' });
    const { employee: foreign } = await createEmployee(prisma, other.id);
    await addEntry(other.id, foreign.id, '2026-10-07', '08:00', '10:00');

    const res = await get(app, asAdmin, '/company/attendance/summary');
    expect(res.body.data.employees).toEqual({ active: 0, in: 0, out: 0 });
    expect(res.body.data.worked.seconds).toBe(0);
    expect(res.body.data.atLimit.count).toBe(0);
  });

  it('con el reporte opcional no cuenta pendientes, y el empleado no tiene acceso', async () => {
    const { app, company, employee, asAdmin } = await setup({ requireDailyReport: false });
    const { employee: ana, as } = await employee();
    await addEntry(company.id, ana.id, '2026-10-05');

    const res = await get(app, asAdmin, '/company/attendance/summary');
    expect(res.body.data.pendingReports).toEqual({ required: false, employees: 0, days: 0 });
    expect((await get(app, as, '/company/attendance/summary')).status).toBe(403);
  });
});
