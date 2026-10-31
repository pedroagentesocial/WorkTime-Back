import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import type { FakeClock } from './helpers/fake-clock.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import {
  createCompany,
  createEmployee,
  createUser,
  DEFAULT_PASSWORD,
  companyIdentifiers,
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

type As = () => Promise<Record<string, string>>;
const asUser =
  (app: Express, email: string): As =>
  async () =>
    bearer((await login(app, email, DEFAULT_PASSWORD)).accessToken);

const REPORT = 'Atendí a tres clientes y cerré el inventario del almacén';

async function setup(app: Express, options: { required?: boolean; limit?: number | null } = {}) {
  const company = await createCompany(prisma);
  await prisma.company.update({
    where: { id: company.id },
    data: {
      requireDailyReport: options.required ?? true,
      dailyLimitMinutes: options.limit ?? null,
    },
  });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id);
  return {
    company,
    employee,
    asAdmin: asUser(app, admin.email),
    asEmployee: asUser(app, user.email),
  };
}

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
}

const send = async (
  method: 'post' | 'put' | 'patch',
  app: Express,
  as: As,
  path: string,
  body?: object,
) => {
  const req = request(app)
    [method](api(path))
    .set(await as());
  return body ? req.send(body) : req;
};
const get = async (app: Express, as: As, path: string) =>
  request(app)
    .get(api(path))
    .set(await as());

const clockIn = (app: Express, as: As) => send('post', app, as, '/me/clock-in', CLOCK_IN_LOCATION);
const clockOut = (app: Express, as: As, dailyReport?: string) =>
  send('post', app, as, '/me/clock-out', dailyReport === undefined ? undefined : { dailyReport });

describe('configuración', () => {
  it('una empresa nueva exige el reporte por defecto', async () => {
    const created = await prisma.company.create({
      data: {
        ...companyIdentifiers(),
        name: 'Sin ajustes',
        timezone: 'America/Denver',
        maxEmployees: 5,
      },
    });
    expect(created.requireDailyReport).toBe(true);
  });

  it('el admin activa o apaga el reporte obligatorio y solo acepta booleanos', async () => {
    const { app } = createTestApp();
    const { asAdmin } = await setup(app, { required: false });

    expect((await get(app, asAdmin, '/company')).body.data.requireDailyReport).toBe(false);
    const on = await send('patch', app, asAdmin, '/company', { requireDailyReport: true });
    expect(on.body.data.requireDailyReport).toBe(true);
    expect(
      (await send('patch', app, asAdmin, '/company', { requireDailyReport: 'si' })).status,
    ).toBe(400);
  });
});

describe('marcar salida con reporte', () => {
  it('si la empresa lo exige no cierra sin reporte válido y no se pierde la entrada', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(120);

    const missing = await clockOut(app, asEmployee);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('DAILY_REPORT_REQUIRED');

    const short = await clockOut(app, asEmployee, 'ok');
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('INVALID_DAILY_REPORT');

    const blank = await clockOut(app, asEmployee, '          ');
    expect(blank.body.error.code).toBe('DAILY_REPORT_REQUIRED');

    expect((await get(app, asEmployee, '/me/clock-status')).body.data.clockedIn).toBe(true);
    expect(await prisma.dailyReport.count()).toBe(0);

    const ok = await clockOut(app, asEmployee, REPORT);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'closed', closedBy: 'employee' });
    const saved = await prisma.dailyReport.findFirstOrThrow();
    expect(saved.content).toBe(REPORT);
    expect(saved.workDate.toISOString().slice(0, 10)).toBe('2026-06-01');
  });

  it('si no es obligatorio, sin reporte cierra normal y con reporte lo guarda', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app, { required: false });
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(60);
    expect((await clockOut(app, asEmployee)).status).toBe(200);
    expect(await prisma.dailyReport.count()).toBe(0);

    await clockIn(app, asEmployee);
    clock.advanceMinutes(60);
    expect((await clockOut(app, asEmployee, REPORT)).status).toBe(200);
    expect(await prisma.dailyReport.count()).toBe(1);
  });

  it('varias salidas el mismo día piden el texto ya cargado y guardan un solo reporte con historial', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee, asAdmin } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');

    await clockIn(app, asEmployee);
    clock.advanceMinutes(60);
    await clockOut(app, asEmployee, REPORT);

    clock.advanceMinutes(30);
    await clockIn(app, asEmployee);
    const status = await get(app, asEmployee, '/me/clock-status');
    expect(status.body.data.dailyReport).toEqual({
      required: true,
      workDate: '2026-06-01',
      content: REPORT,
    });

    clock.advanceMinutes(60);
    const extended = `${REPORT}. Después revisé pedidos pendientes.`;
    expect((await clockOut(app, asEmployee, extended)).status).toBe(200);

    await clockIn(app, asEmployee);
    clock.advanceMinutes(30);
    expect((await clockOut(app, asEmployee, extended)).status).toBe(200);

    expect(await prisma.dailyReport.count()).toBe(1);
    const list = await get(app, asAdmin, '/company/daily-reports');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      workDate: '2026-06-01',
      content: extended,
      revisions: 1,
    });

    const revisions = await get(
      app,
      asAdmin,
      `/company/daily-reports/${list.body.data[0].id}/revisions`,
    );
    expect(revisions.body.data).toHaveLength(1);
    expect(revisions.body.data[0].content).toBe(REPORT);
  });

  it('un reporte nuevo al día siguiente no toca el anterior', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);
    for (const day of ['2026-06-01', '2026-06-02']) {
      setTime(clock, `${day}T14:00:00Z`);
      await clockIn(app, asEmployee);
      clock.advanceMinutes(60);
      expect((await clockOut(app, asEmployee, `${REPORT} (${day})`)).status).toBe(200);
    }
    expect(await prisma.dailyReport.count()).toBe(2);
    const mine = await get(app, asEmployee, '/me/daily-reports');
    const dates = (mine.body.data as { workDate: string }[]).map((r) => r.workDate);
    expect(dates).toEqual(['2026-06-02', '2026-06-01']);
  });
});

describe('cierre por el sistema', () => {
  it('si el límite diario ya cerró la entrada no se exige el reporte y queda pendiente', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee, employee } = await setup(app, { limit: 120 });
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(300);

    const res = await clockOut(app, asEmployee);
    expect(res.status).toBe(200);
    expect(res.body.data.closedBy).toBe('daily_limit');
    expect(await prisma.dailyReport.count()).toBe(0);

    const sheet = await get(app, asEmployee, '/me/timesheet?date=2026-06-01');
    expect(sheet.body.data.requiresDailyReport).toBe(true);
    const day = (
      sheet.body.data.days as { date: string; hasReport: boolean; entries: number }[]
    ).find((d) => d.date === '2026-06-01');
    expect(day).toMatchObject({ entries: 1, hasReport: false });

    const put = await send('put', app, asEmployee, '/me/daily-reports/2026-06-01', {
      content: REPORT,
    });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ workDate: '2026-06-01', content: REPORT, revisions: 0 });
    const after = await get(app, asEmployee, '/me/timesheet?date=2026-06-01');
    expect(
      (after.body.data.days as { date: string; hasReport: boolean }[]).find(
        (d) => d.date === '2026-06-01',
      )?.hasReport,
    ).toBe(true);
    expect(employee.id).toBeDefined();
  });

  it('un día pasado con reporte pendiente se puede escribir, pero ya no se edita después', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app, { limit: 120 });
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(300);
    await get(app, asEmployee, '/me/clock-status');

    setTime(clock, '2026-06-03T14:00:00Z');
    const first = await send('put', app, asEmployee, '/me/daily-reports/2026-06-01', {
      content: REPORT,
    });
    expect(first.status).toBe(200);

    const edit = await send('put', app, asEmployee, '/me/daily-reports/2026-06-01', {
      content: `${REPORT} y algo más`,
    });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('DAILY_REPORT_LOCKED');
  });
});

describe('PUT /me/daily-reports/:date', () => {
  it('edita el reporte de hoy y conserva la versión anterior', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee, asAdmin } = await setup(app, { required: false });
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);

    const created = await send('put', app, asEmployee, '/me/daily-reports/2026-06-01', {
      content: REPORT,
    });
    expect(created.status).toBe(200);
    const edited = await send('put', app, asEmployee, '/me/daily-reports/2026-06-01', {
      content: `${REPORT}. Más trabajo.`,
    });
    expect(edited.body.data.revisions).toBe(1);

    const list = await get(app, asAdmin, '/company/daily-reports');
    expect(list.body.data[0]).toMatchObject({
      id: created.body.data.id,
      content: `${REPORT}. Más trabajo.`,
      revisions: 1,
    });
  });

  it('valida el contenido y la fecha', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app, { required: false });
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    const put = (date: string, content: string) =>
      send('put', app, asEmployee, `/me/daily-reports/${date}`, { content });

    expect((await put('2026-06-01', 'corto')).body.error.code).toBe('INVALID_DAILY_REPORT');
    expect((await put('2026-06-01', 'x'.repeat(2001))).status).toBe(400);
    expect((await put('2026-06-02', REPORT)).body.error.code).toBe('INVALID_REPORT_DATE');
    expect((await put('2026-05-30', REPORT)).body.error.code).toBe('NO_WORK_ON_DATE');
    expect((await put('ayer', REPORT)).status).toBe(400);
    expect(
      (
        await send('put', app, asEmployee, '/me/daily-reports/2026-06-01', {
          content: REPORT,
          x: 1,
        })
      ).status,
    ).toBe(400);
  });
});

describe('aislamiento entre empresas', () => {
  it('cada quien ve solo lo suyo y el admin solo lo de su empresa', async () => {
    const { app, clock } = createTestApp();
    const mine = await setup(app, { required: false });
    const other = await setup(app, { required: false });
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, mine.asEmployee);
    await clockIn(app, other.asEmployee);
    await send('put', app, mine.asEmployee, '/me/daily-reports/2026-06-01', { content: REPORT });
    await send('put', app, other.asEmployee, '/me/daily-reports/2026-06-01', {
      content: 'Reporte secreto de la otra empresa',
    });

    const mineList = await get(app, mine.asEmployee, '/me/daily-reports');
    expect(mineList.body.meta.total).toBe(1);
    expect(mineList.body.data[0].content).toBe(REPORT);

    const adminList = await get(app, mine.asAdmin, '/company/daily-reports');
    expect(adminList.body.meta.total).toBe(1);
    expect(JSON.stringify(adminList.body)).not.toContain('secreto');

    const foreign = await prisma.dailyReport.findFirstOrThrow({
      where: { companyId: other.company.id },
    });
    const revisions = await get(
      app,
      mine.asAdmin,
      `/company/daily-reports/${foreign.id}/revisions`,
    );
    expect(revisions.status).toBe(404);
    expect(revisions.body.error.code).toBe('DAILY_REPORT_NOT_FOUND');

    const byEmployee = await get(
      app,
      mine.asAdmin,
      `/company/daily-reports?employeeId=${other.employee.id}`,
    );
    expect(byEmployee.status).toBe(404);

    expect((await get(app, mine.asEmployee, '/company/daily-reports')).status).toBe(403);
  });
});
