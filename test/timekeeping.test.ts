import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { AUTO_CLOSE_REASON } from '#modules/timekeeping/application/close-entry-on-deactivation.use-case.js';
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

type Auth = Record<string, string>;

type As = () => Promise<Auth>;
const asUser =
  (app: Express, email: string): As =>
  async () =>
    bearer((await login(app, email, DEFAULT_PASSWORD)).accessToken);

async function setup(app: Express, employeeTimezone: string | null = null) {
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id, {
    timezone: employeeTimezone,
  });
  return {
    company,
    admin,
    employee,
    asAdmin: asUser(app, admin.email),
    asEmployee: asUser(app, user.email),
  };
}

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
}

async function clockIn(app: Express, as: As) {
  return request(app)
    .post(api('/me/clock-in'))
    .set(await as())
    .send(CLOCK_IN_LOCATION);
}

async function clockOut(app: Express, as: As) {
  return request(app)
    .post(api('/me/clock-out'))
    .set(await as());
}

async function get(app: Express, as: As, path: string) {
  return request(app)
    .get(api(path))
    .set(await as());
}

async function patch(app: Express, as: As, path: string, body: object) {
  return request(app)
    .patch(api(path))
    .set(await as())
    .send(body);
}

describe('Acceso', () => {
  it('el admin de empresa no marca asistencia y el empleado no ve la de otros', async () => {
    const { app } = createTestApp();
    const { asAdmin, asEmployee } = await setup(app);

    const adminClock = await clockIn(app, asAdmin);
    expect(adminClock.status).toBe(403);
    expect(adminClock.body.error.code).toBe('FORBIDDEN');

    for (const path of ['/company/time-entries', '/company/attendance/live']) {
      expect((await get(app, asEmployee, path)).status).toBe(403);
    }
  });
});

describe('Marcar entrada y salida', () => {
  it('registra la entrada con hora del servidor, zona y día laboral local', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');

    const res = await clockIn(app, asEmployee);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'open',
      clockInAt: '2026-06-01T14:00:00.000Z',
      clockInLocal: '2026-06-01T08:00:00-06:00',
      clockOutAt: null,
      timezone: 'America/Denver',
      workDate: '2026-06-01',
      durationSeconds: null,
      durationHours: null,
      source: 'web',
      corrected: false,
    });
  });

  it('un empleado en Sinaloa marca con SU zona aunque la empresa esté en Utah', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app, 'America/Mazatlan');
    setTime(clock, '2026-01-15T15:00:00Z');

    const res = await clockIn(app, asEmployee);
    expect(res.body.data).toMatchObject({
      timezone: 'America/Mazatlan',
      clockInLocal: '2026-01-15T08:00:00-07:00',
      workDate: '2026-01-15',
    });
  });

  it('no permite dos entradas abiertas, ni siquiera con clics simultáneos', async () => {
    const { app } = createTestApp();
    const { asEmployee, employee } = await setup(app);
    const auth = await asEmployee();

    const results = await Promise.all(
      [1, 2, 3].map(() => request(app).post(api('/me/clock-in')).set(auth).send(CLOCK_IN_LOCATION)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual([
      'ALREADY_CLOCKED_IN',
      'ALREADY_CLOCKED_IN',
    ]);
    expect(await prisma.timeEntry.count({ where: { employeeId: employee.id } })).toBe(1);
  });

  it('cierra con la salida y calcula la duración', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);

    expect((await clockOut(app, asEmployee)).status).toBe(409);
    expect((await clockIn(app, asEmployee)).status).toBe(201);
    clock.advanceMinutes(8 * 60 + 30);

    const res = await clockOut(app, asEmployee);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'closed',
      durationSeconds: 30600,
      durationHours: 8.5,
    });

    const again = await clockOut(app, asEmployee);
    expect(again.body.error.code).toBe('NOT_CLOCKED_IN');
  });

  it('un turno nocturno cuenta para el día en que empezó', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);
    setTime(clock, '2026-06-02T04:00:00Z');
    await clockIn(app, asEmployee);
    setTime(clock, '2026-06-02T12:00:00Z');

    const res = await clockOut(app, asEmployee);
    expect(res.body.data).toMatchObject({
      workDate: '2026-06-01',
      clockOutLocal: '2026-06-02T06:00:00-06:00',
      durationSeconds: 28800,
      durationHours: 8,
    });
  });

  it('/me/clock-status refleja el estado actual', async () => {
    const { app } = createTestApp();
    const { asEmployee } = await setup(app, 'America/Mexico_City');

    const before = await get(app, asEmployee, '/me/clock-status');
    expect(before.body.data).toMatchObject({
      clockedIn: false,
      openEntry: null,
      timezone: 'America/Mexico_City',
    });

    await clockIn(app, asEmployee);
    const after = await get(app, asEmployee, '/me/clock-status');
    expect(after.body.data.clockedIn).toBe(true);
    expect(after.body.data.openEntry.status).toBe('open');
  });

  it('cambiar la zona del empleado no altera sus registros anteriores', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee, asAdmin, employee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    await clockIn(app, asEmployee);
    clock.advanceMinutes(60);
    await clockOut(app, asEmployee);

    const updated = await patch(app, asAdmin, `/company/employees/${employee.id}`, {
      timezone: 'Europe/Madrid',
    });
    expect(updated.status).toBe(200);

    const history = await get(app, asEmployee, '/me/time-entries');
    expect(history.body.data[0]).toMatchObject({
      timezone: 'America/Denver',
      clockInLocal: '2026-06-01T08:00:00-06:00',
    });

    clock.advanceMinutes(60);
    const next = await clockIn(app, asEmployee);
    expect(next.body.data.timezone).toBe('Europe/Madrid');
  });
});

describe('GET /me/time-entries', () => {
  it('filtra por día laboral y suma los minutos de todo el rango', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);

    for (const day of ['2026-06-01', '2026-06-02', '2026-06-03']) {
      setTime(clock, `${day}T14:00:00Z`);
      expect((await clockIn(app, asEmployee)).status).toBe(201);
      clock.advanceMinutes(480);
      expect((await clockOut(app, asEmployee)).status).toBe(200);
    }

    const all = await get(app, asEmployee, '/me/time-entries?limit=2');
    expect(all.body.meta).toMatchObject({ total: 3, totalPages: 2, totalHours: 24 });
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data[0].workDate).toBe('2026-06-03');

    const range = await get(app, asEmployee, '/me/time-entries?from=2026-06-02&to=2026-06-03');
    expect(range.body.meta).toMatchObject({ total: 2, totalHours: 16 });
  });

  it('varios marcajes el mismo día suman sus horas decimales ya redondeadas', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);

    setTime(clock, '2026-06-01T14:00:00Z');
    for (const seconds of [3 * 3600 + 620, 2 * 3600 + 3020, 1 * 3600 + 1820]) {
      expect((await clockIn(app, asEmployee)).status).toBe(201);
      clock.advance(seconds * 1000);
      expect((await clockOut(app, asEmployee)).status).toBe(200);
      clock.advanceMinutes(10);
    }

    const res = await get(app, asEmployee, '/me/time-entries?from=2026-06-01&to=2026-06-01');
    const entries = res.body.data as { workDate: string; durationHours: number }[];
    expect(entries.map((e) => e.workDate)).toEqual(['2026-06-01', '2026-06-01', '2026-06-01']);
    expect(entries.map((e) => e.durationHours)).toEqual([1.51, 2.84, 3.17]);
    expect(res.body.meta).toMatchObject({ total: 3, totalHours: 7.52 });
  });

  it('valida el rango', async () => {
    const { app } = createTestApp();
    const { asEmployee } = await setup(app);
    const res = await get(app, asEmployee, '/me/time-entries?from=2026-06-10&to=2026-06-01');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE_RANGE');
    expect((await get(app, asEmployee, '/me/time-entries?from=01-06-2026')).status).toBe(400);
  });

  it('cada empleado solo ve lo suyo', async () => {
    const { app } = createTestApp();
    const { company, asEmployee } = await setup(app);
    const other = await createEmployee(prisma, company.id);
    expect((await clockIn(app, asUser(app, other.user.email))).status).toBe(201);

    const mine = await get(app, asEmployee, '/me/time-entries');
    expect(mine.body.meta.total).toBe(0);
  });
});

describe('Admin: asistencia de la empresa', () => {
  it('ve quién está trabajando ahora y desde hace cuánto', async () => {
    const { app, clock } = createTestApp();
    const { asAdmin, asEmployee, employee } = await setup(app);
    await clockIn(app, asEmployee);
    clock.advanceMinutes(95);

    const res = await get(app, asAdmin, '/company/attendance/live');
    expect(res.status).toBe(200);
    expect(res.body.data.working).toBe(1);
    expect(res.body.data.entries[0]).toMatchObject({
      employee: { id: employee.id },
      elapsedSeconds: 5700,
      elapsedHours: 1.58,
      status: 'open',
    });
  });

  it('agrupa por el día local de cada empleado aunque estén en zonas distintas', async () => {
    const { app, clock } = createTestApp();
    const { company, asAdmin, asEmployee, employee } = await setup(app);
    const madrid = await createEmployee(prisma, company.id, { timezone: 'Europe/Madrid' });

    setTime(clock, '2026-06-02T03:00:00Z');
    await clockIn(app, asEmployee);
    await clockIn(app, asUser(app, madrid.user.email));

    const june1 = await get(app, asAdmin, '/company/time-entries?from=2026-06-01&to=2026-06-01');
    const ids = (june1.body.data as { employee: { id: string } }[]).map((e) => e.employee.id);
    expect(ids).toEqual([employee.id]);

    const byEmployee = await get(
      app,
      asAdmin,
      `/company/time-entries?employeeId=${madrid.employee.id}`,
    );
    expect(byEmployee.body.data[0]).toMatchObject({
      workDate: '2026-06-02',
      timezone: 'Europe/Madrid',
    });
  });

  it('corrige una salida olvidada con motivo; queda auditada y visible para el empleado', async () => {
    const { app, clock } = createTestApp();
    const { admin, asAdmin, asEmployee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    const entry = (await clockIn(app, asEmployee)).body.data;
    setTime(clock, '2026-06-02T15:00:00Z');

    const res = await patch(app, asAdmin, `/company/time-entries/${entry.id}`, {
      clockOutAt: '2026-06-01T17:00:00-06:00',
      reason: 'Olvidó marcar su salida',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'closed',
      clockOutAt: '2026-06-01T23:00:00.000Z',
      durationSeconds: 32400,
      durationHours: 9,
      corrections: 1,
    });

    const corrections = await get(app, asAdmin, `/company/time-entries/${entry.id}/corrections`);
    expect(corrections.body.data).toEqual([
      expect.objectContaining({
        correctedBy: expect.objectContaining({ id: admin.id }),
        previousClockInAt: '2026-06-01T14:00:00.000Z',
        previousClockOutAt: null,
        newClockOutAt: '2026-06-01T23:00:00.000Z',
        reason: 'Olvidó marcar su salida',
      }),
    ]);

    const mine = await get(app, asEmployee, '/me/time-entries');
    expect(mine.body.data[0].corrected).toBe(true);
  });

  it('una corrección que cambia la entrada recalcula el día laboral', async () => {
    const { app, clock } = createTestApp();
    const { asAdmin, asEmployee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    const entry = (await clockIn(app, asEmployee)).body.data;
    clock.advanceMinutes(60);
    await clockOut(app, asEmployee);

    const res = await patch(app, asAdmin, `/company/time-entries/${entry.id}`, {
      clockInAt: '2026-05-31T23:30:00-06:00',
      reason: 'Entró antes de la medianoche',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.workDate).toBe('2026-05-31');
  });

  it('rechaza correcciones inválidas', async () => {
    const { app, clock } = createTestApp();
    const { asAdmin, asEmployee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    const first = (await clockIn(app, asEmployee)).body.data;
    clock.advanceMinutes(120);
    await clockOut(app, asEmployee);
    clock.advanceMinutes(60);
    await clockIn(app, asEmployee);
    clock.advanceMinutes(180);

    const cases: [object, number, string][] = [
      [{ clockOutAt: '2026-06-01T13:00:00Z', reason: 'Salida antes' }, 400, 'INVALID_TIME_RANGE'],
      [{ clockOutAt: '2026-06-09T13:00:00Z', reason: 'En el futuro' }, 400, 'TIME_IN_FUTURE'],
      [{ clockOutAt: '2026-06-01T18:00:00Z', reason: 'Se cruza' }, 409, 'TIME_ENTRY_OVERLAP'],
      [{ clockOutAt: '2026-06-01T16:00:00Z', reason: 'Mismo valor' }, 400, 'NO_CHANGES'],
      [{ clockOutAt: '2026-06-01T15:00:00Z', reason: 'no' }, 400, 'VALIDATION_ERROR'],
      [{ reason: 'Sin horas que corregir' }, 400, 'VALIDATION_ERROR'],
    ];
    for (const [body, status, code] of cases) {
      const res = await patch(app, asAdmin, `/company/time-entries/${first.id}`, body);
      expect(res.status, code).toBe(status);
      expect(res.body.error.code).toBe(code);
    }
  });

  it('dos correcciones simultáneas que juntas se cruzarían: solo una se aplica', async () => {
    const { app, clock } = createTestApp();
    const { asAdmin, asEmployee } = await setup(app);
    setTime(clock, '2026-06-01T10:00:00Z');
    const a = (await clockIn(app, asEmployee)).body.data;
    setTime(clock, '2026-06-01T11:00:00Z');
    await clockOut(app, asEmployee);
    setTime(clock, '2026-06-01T14:00:00Z');
    const b = (await clockIn(app, asEmployee)).body.data;
    setTime(clock, '2026-06-01T15:00:00Z');
    await clockOut(app, asEmployee);
    setTime(clock, '2026-06-01T20:00:00Z');

    const auth = await asAdmin();
    const [first, second] = await Promise.all([
      request(app)
        .patch(api(`/company/time-entries/${a.id}`))
        .set(auth)
        .send({
          clockInAt: '2026-06-01T12:00:00Z',
          clockOutAt: '2026-06-01T13:30:00Z',
          reason: 'Ajuste A',
        }),
      request(app)
        .patch(api(`/company/time-entries/${b.id}`))
        .set(auth)
        .send({ clockInAt: '2026-06-01T13:00:00Z', reason: 'Ajuste B' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body.error.code).toBe('TIME_ENTRY_OVERLAP');
  });

  it('el empleado no puede corregir sus propios registros', async () => {
    const { app } = createTestApp();
    const { asEmployee } = await setup(app);
    const entry = (await clockIn(app, asEmployee)).body.data;
    const res = await patch(app, asEmployee, `/company/time-entries/${entry.id}`, {
      clockInAt: '2026-06-01T10:00:00Z',
      reason: 'Quiero más horas',
    });
    expect(res.status).toBe(403);
  });
});

describe('Aislamiento entre empresas', () => {
  it('un admin no ve ni corrige registros de otra empresa', async () => {
    const { app } = createTestApp();
    const a = await setup(app);
    const b = await setup(app);
    const entryOfB = (await clockIn(app, b.asEmployee)).body.data;

    for (const res of [
      await get(app, a.asAdmin, `/company/time-entries/${entryOfB.id}`),
      await patch(app, a.asAdmin, `/company/time-entries/${entryOfB.id}`, {
        clockOutAt: '2026-06-01T13:00:00Z',
        reason: 'Intento indebido',
      }),
      await get(app, a.asAdmin, `/company/time-entries/${entryOfB.id}/corrections`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TIME_ENTRY_NOT_FOUND');
    }

    const filterOther = await get(
      app,
      a.asAdmin,
      `/company/time-entries?employeeId=${b.employee.id}`,
    );
    expect(filterOther.body.error.code).toBe('EMPLOYEE_NOT_FOUND');

    const live = await get(app, a.asAdmin, '/company/attendance/live');
    expect(live.body.data.working).toBe(0);
    expect((await get(app, a.asAdmin, `/company/time-entries/${uuidv7()}`)).status).toBe(404);
  });
});

describe('Reacción a la desactivación (evento de workforce)', () => {
  it('al desactivar a un empleado con entrada abierta, se cierra y queda auditado', async () => {
    const { app, clock } = createTestApp();
    const { admin, asAdmin, asEmployee, employee } = await setup(app);
    setTime(clock, '2026-06-01T14:00:00Z');
    const entry = (await clockIn(app, asEmployee)).body.data;
    setTime(clock, '2026-06-01T16:00:00Z');

    const deactivated = await patch(app, asAdmin, `/company/employees/${employee.id}/status`, {
      status: 'inactive',
    });
    expect(deactivated.status).toBe(200);

    const closed = await get(app, asAdmin, `/company/time-entries/${entry.id}`);
    expect(closed.body.data).toMatchObject({
      status: 'closed',
      clockOutAt: '2026-06-01T16:00:00.000Z',
      durationSeconds: 7200,
      durationHours: 2,
      corrections: 1,
    });
    const corrections = await get(app, asAdmin, `/company/time-entries/${entry.id}/corrections`);
    expect(corrections.body.data[0]).toMatchObject({
      reason: AUTO_CLOSE_REASON,
      correctedBy: { id: admin.id },
    });
  });
});

describe('hoja de tiempo por periodo de pago', () => {
  async function work(app: Express, clock: FakeClock, as: As, startIso: string, minutes: number) {
    setTime(clock, startIso);
    expect((await clockIn(app, as)).status).toBe(201);
    clock.advanceMinutes(minutes);
    expect((await clockOut(app, as)).status).toBe(200);
  }

  it('el empleado ve los 14 días del periodo con sus horas y día de la semana', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);

    await work(app, clock, asEmployee, '2026-10-05T14:00:00Z', 180);
    await work(app, clock, asEmployee, '2026-10-05T20:00:00Z', 300);
    await work(app, clock, asEmployee, '2026-10-07T14:00:00Z', 270);

    const res = await get(app, asEmployee, '/me/timesheet?date=2026-10-12');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      period: { start: '2026-10-05', end: '2026-10-18' },
      previousPeriodStart: '2026-09-21',
      nextPeriodStart: '2026-10-19',
      timezone: 'America/Denver',
      totalHours: 12.5,
    });
    const days = res.body.data.days as { date: string; weekday: string; hours: number }[];
    expect(days).toHaveLength(14);
    expect(days[0]).toMatchObject({ date: '2026-10-05', weekday: 'monday', entries: 2, hours: 8 });
    expect(days[1]).toMatchObject({ date: '2026-10-06', weekday: 'tuesday', entries: 0, hours: 0 });
    expect(days[2]).toMatchObject({ date: '2026-10-07', weekday: 'wednesday', hours: 4.5 });
    expect(days[13]).toMatchObject({ date: '2026-10-18', weekday: 'sunday' });
  });

  it('sin date usa el periodo actual en la zona del empleado y no cuenta marcajes abiertos', async () => {
    const { app, clock } = createTestApp();
    const { asEmployee } = await setup(app);

    setTime(clock, '2026-10-06T14:00:00Z');
    expect((await clockIn(app, asEmployee)).status).toBe(201);

    const res = await get(app, asEmployee, '/me/timesheet');
    expect(res.body.data.period).toEqual({ start: '2026-10-05', end: '2026-10-18' });
    expect(res.body.data.totalHours).toBe(0);
    expect(res.body.data.days[1]).toMatchObject({ entries: 1, openEntries: 1, hours: 0 });
  });

  it('un empleado nunca ve horas de otro y valida la fecha', async () => {
    const { app, clock } = createTestApp();
    const a = await setup(app);
    const b = await createEmployee(prisma, a.company.id);
    await work(app, clock, a.asEmployee, '2026-10-05T14:00:00Z', 60);

    const asB = asUser(app, b.user.email);
    expect((await get(app, asB, '/me/timesheet?date=2026-10-05')).body.data.totalHours).toBe(0);
    expect((await get(app, a.asEmployee, '/me/timesheet?date=ayer')).status).toBe(400);
  });

  it('el admin ve la hoja de cualquier empleado de su empresa y no de otras', async () => {
    const { app, clock } = createTestApp();
    const mine = await setup(app);
    const other = await setup(app);
    await work(app, clock, mine.asEmployee, '2026-10-05T14:00:00Z', 90);

    const res = await get(
      app,
      mine.asAdmin,
      `/company/employees/${mine.employee.id}/timesheet?date=2026-10-05`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.totalHours).toBe(1.5);

    const cross = await get(
      app,
      other.asAdmin,
      `/company/employees/${mine.employee.id}/timesheet?date=2026-10-05`,
    );
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });
});
