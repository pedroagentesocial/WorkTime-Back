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
const CLOSED_DAY = '2026-09-30';

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
}

async function setup(options: { requireDailyReport?: boolean; now?: string } = {}) {
  const { app, clock } = createTestApp();
  setTime(clock, options.now ?? NOW);
  const company = await createCompany(prisma, {
    requireDailyReport: options.requireDailyReport ?? false,
  });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asEmployee = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, clock, company, admin, user, employee, asAdmin, asEmployee };
}

async function addEntry(
  companyId: string,
  employeeId: string,
  date: string,
  from = '08:00',
  to: string | null = '12:00',
  timezone = 'America/Denver',
) {
  const id = uuidv7();
  await prisma.timeEntry.create({
    data: {
      id,
      companyId,
      employeeId,
      clockInAt: new Date(`${date}T${from}:00-06:00`),
      clockOutAt: to ? new Date(`${date}T${to}:00-06:00`) : null,
      timezone,
      workDate: new Date(`${date}T00:00:00.000Z`),
      source: 'web',
    },
  });
  return id;
}

const get = (app: Express, auth: Record<string, string>, path: string) =>
  request(app).get(api(path)).set(auth);
const post = (app: Express, auth: Record<string, string>, path: string, body: object = {}) =>
  request(app).post(api(path)).set(auth).send(body);
const patch = (app: Express, auth: Record<string, string>, path: string, body: object) =>
  request(app).patch(api(path)).set(auth).send(body);
const closePeriod = (app: Express, auth: Record<string, string>, date = CLOSED_DAY) =>
  post(app, auth, '/company/periods/close', { date });

describe('GET /company/periods', () => {
  it('dice si el periodo terminó, si se puede cerrar y cuántas horas lleva', async () => {
    const { app, company, employee, asAdmin } = await setup();
    await addEntry(company.id, employee.id, '2026-09-22', '08:00', '16:00');
    await addEntry(company.id, employee.id, '2026-09-23', '08:00', '12:00');

    const past = await get(app, asAdmin, `/company/periods?date=${CLOSED_DAY}`);
    expect(past.status).toBe(200);
    expect(past.body.data).toMatchObject({
      period: { start: '2026-09-21', end: '2026-10-04' },
      previousPeriodStart: '2026-09-07',
      nextPeriodStart: '2026-10-05',
      finished: true,
      closure: null,
      totalHours: 12,
      openEntries: [],
      canClose: true,
    });

    const current = await get(app, asAdmin, '/company/periods');
    expect(current.body.data).toMatchObject({
      period: { start: '2026-10-05', end: '2026-10-18' },
      finished: false,
      canClose: false,
    });
  });

  it('lista las entradas abiertas que impiden cerrar', async () => {
    const { app, company, employee, asAdmin } = await setup();
    await addEntry(company.id, employee.id, '2026-09-30', '09:00', null);

    const res = await get(app, asAdmin, `/company/periods?date=${CLOSED_DAY}`);
    expect(res.body.data.canClose).toBe(false);
    expect(res.body.data.openEntries).toHaveLength(1);
    expect(res.body.data.openEntries[0]).toMatchObject({
      workDate: '2026-09-30',
      employee: { firstName: 'Ana' },
    });
  });

  it('avisa los reportes pendientes sin impedir el cierre', async () => {
    const { app, company, employee, asAdmin } = await setup({ requireDailyReport: true });
    await addEntry(company.id, employee.id, '2026-09-25');

    const res = await get(app, asAdmin, `/company/periods?date=${CLOSED_DAY}`);
    expect(res.body.data.pendingReports).toEqual({ required: true, employees: 1, days: 1 });
    expect(res.body.data.canClose).toBe(true);
  });

  it('el empleado no tiene acceso y la fecha se valida', async () => {
    const { app, asAdmin, asEmployee } = await setup();
    expect((await get(app, asEmployee, '/company/periods')).status).toBe(403);
    expect((await get(app, asAdmin, '/company/periods?date=ayer')).status).toBe(400);
  });
});

describe('POST /company/periods/close', () => {
  it('cierra un periodo terminado y deja constancia', async () => {
    const { app, company, admin, employee, asAdmin, asEmployee } = await setup();
    await addEntry(company.id, employee.id, '2026-09-22', '08:00', '16:00');
    await addEntry(company.id, employee.id, '2026-09-23', '08:00', '12:00');

    const res = await closePeriod(app, asAdmin);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      periodStart: '2026-09-21',
      periodEnd: '2026-10-04',
      totalHours: 12,
      closedBy: { id: admin.id },
    });

    const status = await get(app, asAdmin, `/company/periods?date=${CLOSED_DAY}`);
    expect(status.body.data.closure.totalHours).toBe(12);
    expect(status.body.data.canClose).toBe(false);

    const sheet = await get(app, asAdmin, `/company/timesheet?date=${CLOSED_DAY}`);
    expect(sheet.body.meta.closed).toMatchObject({ totalHours: 12 });
    expect((await get(app, asAdmin, '/company/timesheet')).body.meta.closed).toBeNull();
    expect((await get(app, asEmployee, `/me/timesheet?date=${CLOSED_DAY}`)).body.data.closed).toBe(
      true,
    );
    expect((await get(app, asEmployee, '/me/timesheet')).body.data.closed).toBe(false);

    const activity = await get(app, asAdmin, '/company/activity?type=pay_period.closed');
    expect(activity.body.data[0]).toMatchObject({
      type: 'pay_period.closed',
      details: { periodStart: '2026-09-21', periodEnd: '2026-10-04', totalHours: 12 },
    });
  });

  it('no cierra un periodo que todavía no termina', async () => {
    const { app, asAdmin } = await setup();
    const res = await closePeriod(app, asAdmin, '2026-10-07');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_NOT_FINISHED');
    expect(await prisma.payPeriodClosure.count()).toBe(0);
  });

  it('el último día del periodo todavía cuenta como no terminado', async () => {
    const { app, asAdmin } = await setup({ now: '2026-10-04T20:00:00Z' });
    const res = await closePeriod(app, asAdmin);
    expect(res.body.error.code).toBe('PERIOD_NOT_FINISHED');
  });

  it('no se cierra dos veces', async () => {
    const { app, asAdmin } = await setup();
    expect((await closePeriod(app, asAdmin)).status).toBe(201);
    const again = await closePeriod(app, asAdmin);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PERIOD_ALREADY_CLOSED');
  });

  it('dos cierres a la vez: solo uno gana', async () => {
    const { app, asAdmin } = await setup();
    const results = await Promise.all([closePeriod(app, asAdmin), closePeriod(app, asAdmin)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.payPeriodClosure.count()).toBe(1);
  });

  it('una entrada abierta impide cerrar, y una del periodo actual no', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const open = await addEntry(company.id, employee.id, '2026-09-30', '09:00', null);

    const blocked = await closePeriod(app, asAdmin);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PERIOD_HAS_OPEN_ENTRIES');
    expect(blocked.body.error.details.entries).toEqual([
      { employee: 'Ana User', workDate: '2026-09-30' },
    ]);
    expect(await prisma.payPeriodClosure.count()).toBe(0);

    await post(app, asAdmin, `/company/time-entries/${open}/void`, {
      reason: 'Se marcó por error',
    });
    await addEntry(company.id, employee.id, '2026-10-07', '09:00', null);
    expect((await closePeriod(app, asAdmin)).status).toBe(201);
  });

  it('los reportes pendientes no impiden cerrar', async () => {
    const { app, company, employee, asAdmin } = await setup({ requireDailyReport: true });
    await addEntry(company.id, employee.id, '2026-09-25');
    expect((await closePeriod(app, asAdmin)).status).toBe(201);
  });

  it('solo el admin de la empresa puede cerrar y valida el cuerpo', async () => {
    const { app, asAdmin, asEmployee } = await setup();
    expect((await closePeriod(app, asEmployee)).status).toBe(403);
    for (const body of [{}, { date: 'ayer' }, { date: CLOSED_DAY, extra: 1 }]) {
      expect((await post(app, asAdmin, '/company/periods/close', body)).status).toBe(400);
    }
  });

  it('cerrar el periodo de otra empresa no toca el propio', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const other = await createCompany(prisma, { name: 'Otra' });
    const otherAdmin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: other.id });
    const asOtherAdmin = bearer((await login(app, otherAdmin.email, DEFAULT_PASSWORD)).accessToken);
    expect((await closePeriod(app, asOtherAdmin)).status).toBe(201);

    const entry = await addEntry(company.id, employee.id, '2026-09-30');
    const res = await patch(app, asAdmin, `/company/time-entries/${entry}`, {
      clockOutAt: '2026-09-30T13:00:00-06:00',
      reason: 'Salió más tarde',
    });
    expect(res.status).toBe(200);
    expect(
      (await get(app, asAdmin, `/company/periods?date=${CLOSED_DAY}`)).body.data.closure,
    ).toBeNull();
  });
});

describe('un periodo cerrado ya no admite cambios', () => {
  it('no se corrige, crea ni anula, y lo demás sigue funcionando', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const inside = await addEntry(company.id, employee.id, '2026-09-30', '08:00', '12:00');
    const current = await addEntry(company.id, employee.id, '2026-10-06', '08:00', '12:00');
    await closePeriod(app, asAdmin);

    const correct = await patch(app, asAdmin, `/company/time-entries/${inside}`, {
      clockOutAt: '2026-09-30T13:00:00-06:00',
      reason: 'Salió más tarde',
    });
    expect(correct.status).toBe(409);
    expect(correct.body.error).toMatchObject({
      code: 'PERIOD_CLOSED',
      details: { periodStart: '2026-09-21', periodEnd: '2026-10-04' },
    });

    const manual = await post(app, asAdmin, `/company/employees/${employee.id}/time-entries`, {
      clockInAt: '2026-09-25T08:00:00-06:00',
      clockOutAt: '2026-09-25T10:00:00-06:00',
      reason: 'Olvidó marcar la jornada',
    });
    expect(manual.status).toBe(409);
    expect(manual.body.error.code).toBe('PERIOD_CLOSED');

    const voided = await post(app, asAdmin, `/company/time-entries/${inside}/void`, {
      reason: 'Se creó por duplicado',
    });
    expect(voided.status).toBe(409);
    expect(voided.body.error.code).toBe('PERIOD_CLOSED');

    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: inside } });
    expect(stored.voidedAt).toBeNull();
    expect(stored.clockOutAt?.toISOString()).toBe('2026-09-30T18:00:00.000Z');
    expect(await prisma.timeEntry.count({ where: { source: 'admin' } })).toBe(0);

    const open = await patch(app, asAdmin, `/company/time-entries/${current}`, {
      clockOutAt: '2026-10-06T13:00:00-06:00',
      reason: 'Salió más tarde',
    });
    expect(open.status).toBe(200);
  });

  it('tampoco se mueve un registro hacia dentro o hacia fuera de un periodo cerrado', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const inside = await addEntry(company.id, employee.id, '2026-09-30', '08:00', '12:00');
    const current = await addEntry(company.id, employee.id, '2026-10-06', '08:00', '12:00');
    await closePeriod(app, asAdmin);

    const moveIn = await patch(app, asAdmin, `/company/time-entries/${current}`, {
      clockInAt: '2026-09-29T08:00:00-06:00',
      clockOutAt: '2026-09-29T12:00:00-06:00',
      reason: 'Era de otro día',
    });
    expect(moveIn.body.error.code).toBe('PERIOD_CLOSED');

    const moveOut = await patch(app, asAdmin, `/company/time-entries/${inside}`, {
      clockInAt: '2026-10-06T14:00:00-06:00',
      clockOutAt: '2026-10-06T15:00:00-06:00',
      reason: 'Era de otro día',
    });
    expect(moveOut.body.error.code).toBe('PERIOD_CLOSED');

    const storedCurrent = await prisma.timeEntry.findUniqueOrThrow({ where: { id: current } });
    expect(storedCurrent.workDate.toISOString().slice(0, 10)).toBe('2026-10-06');
  });

  it('el empleado puede seguir escribiendo reportes de días de un periodo cerrado', async () => {
    const { app, company, employee, asAdmin, asEmployee } = await setup({
      requireDailyReport: true,
    });
    await addEntry(company.id, employee.id, '2026-09-25');
    await closePeriod(app, asAdmin);

    const blocked = await post(app, asEmployee, '/me/clock-in', CLOCK_IN_LOCATION);
    expect(blocked.body.error.code).toBe('DAILY_REPORT_PENDING');

    const written = await request(app)
      .put(api('/me/daily-reports/2026-09-25'))
      .set(asEmployee)
      .send({ content: 'Trabajé en el inventario' });
    expect(written.status).toBe(200);
    expect((await post(app, asEmployee, '/me/clock-in', CLOCK_IN_LOCATION)).status).toBe(201);
  });

  it('el CSV de un periodo cerrado no cambia', async () => {
    const { app, company, employee, asAdmin } = await setup();
    await addEntry(company.id, employee.id, '2026-09-22', '08:00', '16:00');
    const before = await get(app, asAdmin, `/company/timesheet/export?date=${CLOSED_DAY}`);
    await closePeriod(app, asAdmin);
    const after = await get(app, asAdmin, `/company/timesheet/export?date=${CLOSED_DAY}`);
    expect(after.text).toBe(before.text);
  });

  it('no se cierra mientras alguien en el mundo todavía está dentro del último día', async () => {
    const { app, company, asAdmin } = await setup({ now: '2026-10-05T08:00:00Z' });
    const { user } = await createEmployee(prisma, company.id, {
      timezone: 'Pacific/Honolulu',
      firstName: 'Kai',
    });
    const asKai = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);

    const status = await get(app, asAdmin, `/company/periods?date=${CLOSED_DAY}`);
    expect(status.body.data).toMatchObject({ finished: false, canClose: false });
    const early = await closePeriod(app, asAdmin);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('PERIOD_NOT_FINISHED');

    const clockIn = await post(app, asKai, '/me/clock-in', CLOCK_IN_LOCATION);
    expect(clockIn.status).toBe(201);
    expect(clockIn.body.data.workDate).toBe('2026-10-04');
  });

  it('aun si algo cerrara el periodo, marcar entrada en un día cerrado se rechaza', async () => {
    const { app, company, admin, asAdmin } = await setup({ now: '2026-10-05T08:00:00Z' });
    const { user, employee } = await createEmployee(prisma, company.id, {
      timezone: 'Pacific/Honolulu',
      firstName: 'Kai',
    });
    const asKai = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
    await prisma.payPeriodClosure.create({
      data: {
        id: uuidv7(),
        companyId: company.id,
        periodStart: new Date('2026-09-21T00:00:00.000Z'),
        periodEnd: new Date('2026-10-04T00:00:00.000Z'),
        totalCentihours: 0n,
        closedById: admin.id,
      },
    });

    const own = await post(app, asKai, '/me/clock-in', CLOCK_IN_LOCATION);
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe('PERIOD_CLOSED');
    const byAdmin = await post(app, asAdmin, `/company/employees/${employee.id}/clock-in`);
    expect(byAdmin.status).toBe(409);
    expect(byAdmin.body.error.code).toBe('PERIOD_CLOSED');
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  it('no se cierran periodos anteriores al primero ni fechas fuera de rango', async () => {
    const { app, asAdmin } = await setup();
    const before = await closePeriod(app, asAdmin, '2026-09-10');
    expect(before.status).toBe(400);
    expect(before.body.error.code).toBe('PERIOD_BEFORE_START');
    for (const date of ['0100-03-01', '9999-12-31', '1999-12-31']) {
      expect((await closePeriod(app, asAdmin, date)).status, date).toBe(400);
    }
    expect(await prisma.payPeriodClosure.count()).toBe(0);
  });

  it('cerrar y crear un registro a la vez nunca deja horas fuera del total guardado', async () => {
    const { app, company, employee, asAdmin } = await setup();
    await addEntry(company.id, employee.id, '2026-09-22', '08:00', '12:00');

    await Promise.all([
      closePeriod(app, asAdmin),
      post(app, asAdmin, `/company/employees/${employee.id}/time-entries`, {
        clockInAt: '2026-09-25T08:00:00-06:00',
        clockOutAt: '2026-09-25T12:00:00-06:00',
        reason: 'Olvidó marcar la jornada',
      }),
    ]);

    const closure = await prisma.payPeriodClosure.findFirstOrThrow();
    const [row] = await prisma.$queryRaw<{ centihours: bigint }[]>`
      SELECT COALESCE(SUM(FLOOR((FLOOR(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at))) + 18) / 36)), 0)::bigint AS centihours
      FROM time_entries WHERE work_date BETWEEN '2026-09-21' AND '2026-10-04'`;
    expect(Number(closure.totalCentihours)).toBe(Number(row?.centihours));
  });
});

describe('la base de datos protege los cierres', () => {
  it('un cierre no se modifica ni se borra', async () => {
    const { app, asAdmin } = await setup();
    await closePeriod(app, asAdmin);
    const closure = await prisma.payPeriodClosure.findFirstOrThrow();

    await expect(
      prisma.payPeriodClosure.update({ where: { id: closure.id }, data: { totalCentihours: 1n } }),
    ).rejects.toThrow(/pay_period_closures_immutable/);
    await expect(prisma.payPeriodClosure.delete({ where: { id: closure.id } })).rejects.toThrow(
      /pay_period_closures_immutable/,
    );
    expect(await prisma.payPeriodClosure.count()).toBe(1);
  });

  it('un periodo dura exactamente 14 días', async () => {
    const { company, admin } = await setup();
    await expect(
      prisma.payPeriodClosure.create({
        data: {
          id: uuidv7(),
          companyId: company.id,
          periodStart: new Date('2026-09-21T00:00:00.000Z'),
          periodEnd: new Date('2026-10-01T00:00:00.000Z'),
          totalCentihours: 0n,
          closedById: admin.id,
        },
      }),
    ).rejects.toThrow(/pay_period_closures_length/);
  });
});

describe('la base de datos protege las horas de un periodo cerrado', () => {
  async function closedSetup() {
    const ctx = await setup();
    const inside = await addEntry(ctx.company.id, ctx.employee.id, '2026-09-30');
    const outside = await addEntry(ctx.company.id, ctx.employee.id, '2026-10-06');
    expect((await closePeriod(ctx.app, ctx.asAdmin)).status).toBe(201);
    return { ...ctx, inside, outside };
  }

  it('no deja crear ni modificar registros dentro del periodo cerrado, aunque se salte la app', async () => {
    const { company, employee, inside, outside } = await closedSetup();

    await expect(addEntry(company.id, employee.id, '2026-09-25')).rejects.toThrow(
      /time_entries_period_closed/,
    );
    await expect(
      prisma.timeEntry.update({ where: { id: inside }, data: { clockOutAt: new Date() } }),
    ).rejects.toThrow(/time_entries_period_closed/);
    await expect(
      prisma.timeEntry.update({
        where: { id: inside },
        data: { voidedAt: new Date(), voidedById: employee.userId, voidReason: 'Motivo' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.timeEntry.update({
        where: { id: outside },
        data: { workDate: new Date('2026-09-28T00:00:00.000Z') },
      }),
    ).rejects.toThrow(/time_entries_period_closed/);
  });

  it('no afecta a los registros de otros periodos ni de otras empresas', async () => {
    const { outside } = await closedSetup();
    await expect(
      prisma.timeEntry.update({
        where: { id: outside },
        data: { clockOutAt: new Date('2026-10-06T19:00:00Z') },
      }),
    ).resolves.toBeTruthy();

    const other = await createCompany(prisma, { name: 'Otra' });
    const { employee } = await createEmployee(prisma, other.id);
    await expect(addEntry(other.id, employee.id, '2026-09-25')).resolves.toBeTruthy();
  });

  it('quien anula o cierra debe ser de la misma empresa', async () => {
    const { company, employee } = await setup();
    const other = await createCompany(prisma, { name: 'Otra' });
    const foreignAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: other.id,
    });
    await expect(
      prisma.payPeriodClosure.create({
        data: {
          id: uuidv7(),
          companyId: company.id,
          periodStart: new Date('2026-09-21T00:00:00.000Z'),
          periodEnd: new Date('2026-10-04T00:00:00.000Z'),
          totalCentihours: 0n,
          closedById: foreignAdmin.id,
        },
      }),
    ).rejects.toThrow();

    const entry = await addEntry(company.id, employee.id, '2026-10-06');
    await expect(
      prisma.timeEntry.update({
        where: { id: entry },
        data: { voidedAt: new Date(), voidedById: foreignAdmin.id, voidReason: 'Motivo' },
      }),
    ).rejects.toThrow();
  });
});
