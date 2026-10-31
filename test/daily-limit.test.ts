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

// El reloj avanza horas y el access token dura 15 minutos: cada peticion inicia sesion en la hora simulada
type As = () => Promise<Record<string, string>>;
const asUser =
  (app: Express, email: string): As =>
  async () =>
    bearer((await login(app, email, DEFAULT_PASSWORD)).accessToken);

const LIMIT = 490;

async function setup(app: Express, limit: number | null = LIMIT) {
  const company = await createCompany(prisma);
  if (limit !== null) {
    await prisma.company.update({ where: { id: company.id }, data: { dailyLimitMinutes: limit } });
  }
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

const post = async (app: Express, as: As, path: string, body?: object) => {
  const req = request(app)
    .post(api(path))
    .set(await as());
  return body ? req.send(body) : req;
};
const get = async (app: Express, as: As, path: string) =>
  request(app)
    .get(api(path))
    .set(await as());
const patch = async (app: Express, as: As, path: string, body: object) =>
  request(app)
    .patch(api(path))
    .set(await as())
    .send(body);

const clockIn = (app: Express, as: As) => post(app, as, '/me/clock-in', CLOCK_IN_LOCATION);
const clockOut = (app: Express, as: As) => post(app, as, '/me/clock-out');

describe('configuración del límite diario', () => {
  it('el admin lo define por empresa y por empleado, y el del empleado manda', async () => {
    const { app } = createTestApp();
    const { asAdmin, employee } = await setup(app, null);

    expect((await get(app, asAdmin, '/company')).body.data.dailyLimitMinutes).toBeNull();
    const company = await patch(app, asAdmin, '/company', { dailyLimitMinutes: LIMIT });
    expect(company.status).toBe(200);
    expect(company.body.data.dailyLimitMinutes).toBe(LIMIT);

    const inherited = await get(app, asAdmin, `/company/employees/${employee.id}`);
    expect(inherited.body.data).toMatchObject({
      dailyLimitMinutes: null,
      effectiveDailyLimitMinutes: LIMIT,
    });

    const own = await patch(app, asAdmin, `/company/employees/${employee.id}`, {
      dailyLimitMinutes: 240,
    });
    expect(own.body.data).toMatchObject({
      dailyLimitMinutes: 240,
      effectiveDailyLimitMinutes: 240,
    });

    const back = await patch(app, asAdmin, `/company/employees/${employee.id}`, {
      dailyLimitMinutes: null,
    });
    expect(back.body.data.effectiveDailyLimitMinutes).toBe(LIMIT);

    const off = await patch(app, asAdmin, '/company', { dailyLimitMinutes: null });
    expect(off.body.data.dailyLimitMinutes).toBeNull();
  });

  it('rechaza valores fuera de rango o que no son enteros', async () => {
    const { app } = createTestApp();
    const { asAdmin, employee } = await setup(app, null);
    for (const value of [0, -5, 1441, 8.5, '490']) {
      expect((await patch(app, asAdmin, '/company', { dailyLimitMinutes: value })).status).toBe(
        400,
      );
      expect(
        (
          await patch(app, asAdmin, `/company/employees/${employee.id}`, {
            dailyLimitMinutes: value,
          })
        ).status,
      ).toBe(400);
    }
  });

  it('un admin no puede tocar el límite de un empleado de otra empresa', async () => {
    const { app } = createTestApp();
    const mine = await setup(app, null);
    const other = await setup(app, null);
    const res = await patch(app, mine.asAdmin, `/company/employees/${other.employee.id}`, {
      dailyLimitMinutes: 60,
    });
    expect(res.status).toBe(404);
  });
});

describe('se pausa al llegar al límite', () => {
  it('cierra la entrada en el instante exacto del límite y no deja volver a marcar ese día', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    expect((await clockIn(app, asEmployee)).status).toBe(201);

    clock.advanceMinutes(300);
    const mid = await get(app, asEmployee, '/me/clock-status');
    expect(mid.body.data.clockedIn).toBe(true);
    expect(mid.body.data.dailyLimit).toEqual({
      minutes: LIMIT,
      workedSeconds: 300 * 60,
      remainingSeconds: 190 * 60,
      reached: false,
    });

    clock.advanceMinutes(300);
    const status = await get(app, asEmployee, '/me/clock-status');
    expect(status.body.data.clockedIn).toBe(false);
    expect(status.body.data.dailyLimit).toMatchObject({ reached: true, remainingSeconds: 0 });

    const history = await get(app, asEmployee, '/me/time-entries');
    expect(history.body.data[0]).toMatchObject({
      status: 'closed',
      clockOutAt: '2026-06-01T22:10:00.000Z',
      durationSeconds: LIMIT * 60,
      durationHours: 8.17,
      closedBy: 'daily_limit',
    });

    const again = await clockIn(app, asEmployee);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(again.body.error.details).toEqual({ limitMinutes: LIMIT });

    setTime(clock, '2026-06-02T14:00:00Z');
    expect((await clockIn(app, asEmployee)).status).toBe(201);
  });

  it('si marca salida despues del limite la salida queda en el instante del limite', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(600);

    const res = await clockOut(app, asEmployee);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      clockOutAt: '2026-06-01T22:10:00.000Z',
      durationSeconds: LIMIT * 60,
      closedBy: 'daily_limit',
    });
  });

  it('el límite suma todos los marcajes del día', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(180);
    await clockOut(app, asEmployee);
    clock.advanceMinutes(60);
    await clockIn(app, asEmployee);
    clock.advanceMinutes(400);
    await get(app, asEmployee, '/me/clock-status');

    const history = await get(app, asEmployee, '/me/time-entries');
    const [second, first] = history.body.data as { durationSeconds: number; closedBy: string }[];
    expect(first).toMatchObject({ durationSeconds: 180 * 60, closedBy: 'employee' });
    expect(second).toMatchObject({ durationSeconds: 310 * 60, closedBy: 'daily_limit' });
    expect(history.body.meta.totalHours).toBe(8.17);
  });

  it('el empleado con limite propio usa el suyo y sin limite no se corta', async () => {
    const { app, clock } = createTestApp();
    const mine = await setup(app);
    await prisma.employee.update({
      where: { id: mine.employee.id },
      data: { dailyLimitMinutes: 60 },
    });
    const free = await setup(app, null);

    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, mine.asEmployee);
    await clockIn(app, free.asEmployee);
    clock.advanceMinutes(120);

    const limited = await get(app, mine.asEmployee, '/me/clock-status');
    expect(limited.body.data.clockedIn).toBe(false);
    const unlimited = await get(app, free.asEmployee, '/me/clock-status');
    expect(unlimited.body.data).toMatchObject({ clockedIn: true, dailyLimit: null });
  });

  it('la tarea periodica cierra a quien nadie consulta, y es idempotente', async () => {
    const { app, clock, container } = createTestApp();
    const { asEmployee, asAdmin } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);

    clock.advanceMinutes(100);
    expect(await container.cradle.closeEntriesOverLimit.execute()).toBe(0);

    clock.advanceMinutes(500);
    expect(await container.cradle.closeEntriesOverLimit.execute()).toBe(1);
    expect(await container.cradle.closeEntriesOverLimit.execute()).toBe(0);

    const live = await get(app, asAdmin, '/company/attendance/live');
    expect(live.body.data.working).toBe(0);
    const entry = await prisma.timeEntry.findFirstOrThrow();
    expect(entry.clockOutAt?.toISOString()).toBe('2026-06-01T22:10:00.000Z');
    expect(entry.closeSource).toBe('daily_limit');
  });
});

describe('el admin marca salida y entrada a un empleado', () => {
  it('marca salida con hora del servidor y queda auditado', async () => {
    const { app, clock } = createTestApp();
    const { asAdmin, asEmployee, employee, company } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(120);

    const res = await post(app, asAdmin, `/company/employees/${employee.id}/clock-out`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'closed',
      clockOutAt: '2026-06-01T16:00:00.000Z',
      durationSeconds: 7200,
      closedBy: 'admin',
    });
    expect((await get(app, asEmployee, '/me/clock-status')).body.data.clockedIn).toBe(false);

    const event = await prisma.securityEvent.findFirst({
      where: { type: 'time_entry.clocked_out_by_admin', companyId: company.id },
    });
    expect(event?.metadata).toMatchObject({ employeeId: employee.id });

    const again = await post(app, asAdmin, `/company/employees/${employee.id}/clock-out`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMPLOYEE_NOT_CLOCKED_IN');
  });

  it('marca entrada: queda como admin, no se duplica y se audita', async () => {
    const { app, clock } = createTestApp();
    const { asAdmin, asEmployee, employee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');

    const res = await post(app, asAdmin, `/company/employees/${employee.id}/clock-in`, {});
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'open',
      source: 'admin',
      clockInAt: '2026-06-01T14:00:00.000Z',
    });
    expect((await get(app, asEmployee, '/me/clock-status')).body.data.clockedIn).toBe(true);

    const twice = await post(app, asAdmin, `/company/employees/${employee.id}/clock-in`, {});
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('EMPLOYEE_ALREADY_CLOCKED_IN');
    expect(
      await prisma.securityEvent.count({ where: { type: 'time_entry.clocked_in_by_admin' } }),
    ).toBe(1);
  });

  it('no marca entrada a un empleado desactivado', async () => {
    const { app } = createTestApp();
    const { asAdmin, employee } = await setup(app);
    await prisma.user.update({ where: { id: employee.userId }, data: { status: 'inactive' } });

    const res = await post(app, asAdmin, `/company/employees/${employee.id}/clock-in`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMPLOYEE_INACTIVE');
  });

  it('respeta el límite salvo que el admin autorice horas extra', async () => {
    const { app, clock, container } = createTestApp();
    const { asAdmin, asEmployee, employee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(600);
    await get(app, asEmployee, '/me/clock-status');

    const blocked = await post(app, asAdmin, `/company/employees/${employee.id}/clock-in`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DAILY_LIMIT_REACHED');

    const allowed = await post(app, asAdmin, `/company/employees/${employee.id}/clock-in`, {
      overrideDailyLimit: true,
    });
    expect(allowed.status).toBe(201);

    clock.advanceMinutes(300);
    expect(await container.cradle.closeEntriesOverLimit.execute()).toBe(0);
    expect((await get(app, asEmployee, '/me/clock-status')).body.data.clockedIn).toBe(true);
  });

  it('un admin no puede marcar a empleados de otra empresa ni un empleado marcar a otros', async () => {
    const { app } = createTestApp();
    const mine = await setup(app);
    const other = await setup(app);

    for (const action of ['clock-in', 'clock-out']) {
      const cross = await post(
        app,
        mine.asAdmin,
        `/company/employees/${other.employee.id}/${action}`,
        {},
      );
      expect(cross.status).toBe(404);
      expect(cross.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
      const forbidden = await post(
        app,
        mine.asEmployee,
        `/company/employees/${mine.employee.id}/${action}`,
        {},
      );
      expect(forbidden.status).toBe(403);
    }
  });
});

const idsOf = (rows: { employee: { id: string } }[]) => rows.map((r) => r.employee.id);

describe('GET /company/attendance/roster', () => {
  it('lista a los empleados con su estado, lo trabajado hoy y su límite', async () => {
    const { app, clock } = createTestApp();
    const { asAdmin, asEmployee, employee, company } = await setup(app);
    const second = await createEmployee(prisma, company.id, { firstName: 'Zoe' });
    const inactive = await createEmployee(prisma, company.id, { status: 'inactive' });

    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(60);
    await clockOut(app, asEmployee);
    clock.advanceMinutes(30);
    await clockIn(app, asEmployee);
    clock.advanceMinutes(120);

    const res = await get(app, asAdmin, '/company/attendance/roster');
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 2, page: 1 });
    const rows = res.body.data as {
      employee: { id: string };
      status: string;
      openEntryId: string | null;
    }[];
    expect(rows.map((r) => r.employee.id)).not.toContain(inactive.employee.id);

    const mine = rows.find((r) => r.employee.id === employee.id);
    expect(mine).toMatchObject({
      status: 'in',
      elapsedSeconds: 120 * 60,
      workedTodaySeconds: 180 * 60,
      workedTodayHours: 3,
      dailyLimit: { minutes: LIMIT, remainingSeconds: 310 * 60, reached: false },
    });
    expect(mine?.openEntryId).toEqual(expect.any(String));
    expect(rows.find((r) => r.employee.id === second.employee.id)).toMatchObject({
      status: 'out',
      openEntryId: null,
      elapsedSeconds: null,
      workedTodaySeconds: 0,
    });
  });

  it('filtra por estado y busca por nombre', async () => {
    const { app, clock } = createTestApp();
    const { asAdmin, asEmployee, employee, company } = await setup(app);
    const zoe = await createEmployee(prisma, company.id, { firstName: 'Zoe' });
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);

    const inOnly = await get(app, asAdmin, '/company/attendance/roster?status=in');
    expect(idsOf(inOnly.body.data)).toEqual([employee.id]);
    const outOnly = await get(app, asAdmin, '/company/attendance/roster?status=out');
    expect(idsOf(outOnly.body.data)).toEqual([zoe.employee.id]);
    const search = await get(app, asAdmin, '/company/attendance/roster?search=zoe');
    expect(search.body.meta.total).toBe(1);
    expect((await get(app, asAdmin, '/company/attendance/roster?status=otro')).status).toBe(400);
  });

  it('solo muestra a los empleados de la propia empresa', async () => {
    const { app, clock } = createTestApp();
    const mine = await setup(app);
    const other = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, other.asEmployee);

    const res = await get(app, mine.asAdmin, '/company/attendance/roster');
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].employee.id).toBe(mine.employee.id);
    expect(res.body.data[0].status).toBe('out');
    expect((await get(app, mine.asEmployee, '/company/attendance/roster')).status).toBe(403);
  });
});
