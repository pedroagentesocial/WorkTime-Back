import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import type { FakeClock } from './helpers/fake-clock.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { createCompany, createEmployee, createUser, DEFAULT_PASSWORD } from './helpers/fixtures.js';
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

// Periodo del 21 sep al 4 oct de 2026, ya terminado a esta hora
const NOW = '2026-10-07T18:00:00Z';
const IN_PERIOD = '2026-09-30';

type Auth = Record<string, string>;
const get = (app: Express, auth: Auth, path: string) => request(app).get(api(path)).set(auth);
const post = (app: Express, auth: Auth, path: string, body: object = {}) =>
  request(app).post(api(path)).set(auth).send(body);
const patch = (app: Express, auth: Auth, path: string, body: object) =>
  request(app).patch(api(path)).set(auth).send(body);

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
}

async function setup(now = NOW) {
  const { app, clock } = createTestApp();
  setTime(clock, now);
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const ana = await createEmployee(prisma, company.id, { firstName: 'Ana' });
  const luis = await createEmployee(prisma, company.id, { firstName: 'Luis' });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asEmployee = bearer((await login(app, ana.user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, company, admin, ana: ana.employee, luis: luis.employee, asAdmin, asEmployee };
}

async function addEntry(companyId: string, employeeId: string, date: string, hours: number) {
  const clockInAt = new Date(`${date}T08:00:00-06:00`);
  await prisma.timeEntry.create({
    data: {
      id: uuidv7(),
      companyId,
      employeeId,
      clockInAt,
      clockOutAt: new Date(clockInAt.getTime() + hours * 3_600_000),
      timezone: 'America/Denver',
      workDate: new Date(`${date}T00:00:00.000Z`),
      source: 'web',
    },
  });
}

const setRate = (
  app: Express,
  auth: Auth,
  employeeId: string,
  kind: 'hourly' | 'salary',
  amountCents: number,
  effectiveFrom = '2026-01-01',
) =>
  post(app, auth, `/company/employees/${employeeId}/pay-rates`, {
    kind,
    amountCents,
    effectiveFrom,
  });

// La nomina es donde se ve el pago; la hoja de horas ya no lo trae
const timesheet = (app: Express, auth: Auth, date = IN_PERIOD) =>
  get(app, auth, `/company/payroll?date=${date}`);

const payOf = (body: { data: { employee: { id: string }; pay: unknown }[] }, id: string) =>
  body.data.find((row) => row.employee.id === id)?.pay;

describe('Moneda de la empresa', () => {
  it('por defecto es USD y se cambia con el código en minúsculas o mayúsculas', async () => {
    const { app, asAdmin } = await setup();
    expect((await get(app, asAdmin, '/company')).body.data.currency).toBe('USD');

    const res = await patch(app, asAdmin, '/company', { currency: 'mxn' });
    expect(res.status).toBe(200);
    expect(res.body.data.currency).toBe('MXN');
  });

  it('rechaza un código que no es una moneda', async () => {
    const { app, asAdmin } = await setup();
    const res = await patch(app, asAdmin, '/company', { currency: 'ABZ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURRENCY');
  });
});

describe('Historial de sueldo', () => {
  it('guarda cambios con su fecha y uno por día: el mismo día reemplaza', async () => {
    const { app, ana, asAdmin } = await setup();
    await setRate(app, asAdmin, ana.id, 'hourly', 1500, '2026-10-05').expect(200);
    await setRate(app, asAdmin, ana.id, 'hourly', 1600, '2026-10-12').expect(200);
    const res = await setRate(app, asAdmin, ana.id, 'salary', 200_000, '2026-10-12');

    expect(res.status).toBe(200);
    expect(res.body.data.currency).toBe('USD');
    expect(res.body.data.rates).toMatchObject([
      { kind: 'salary', amountCents: 200_000, effectiveFrom: '2026-10-12' },
      { kind: 'hourly', amountCents: 1500, effectiveFrom: '2026-10-05' },
    ]);
    const listed = await get(app, asAdmin, `/company/employees/${ana.id}/pay-rates`);
    expect(listed.body.data.rates).toHaveLength(2);

    const audit = await prisma.securityEvent.count({
      where: { type: 'employee.pay_rate_changed' },
    });
    expect(audit).toBe(3);
  });

  it('rechaza montos inválidos', async () => {
    const { app, ana, asAdmin } = await setup();
    expect((await setRate(app, asAdmin, ana.id, 'hourly', -1)).status).toBe(400);
    expect((await setRate(app, asAdmin, ana.id, 'hourly', 15.5)).status).toBe(400);
  });

  it('el empleado no ve ni cambia sueldos', async () => {
    const { app, ana, asEmployee } = await setup();
    expect((await get(app, asEmployee, `/company/employees/${ana.id}/pay-rates`)).status).toBe(403);
    expect((await setRate(app, asEmployee, ana.id, 'hourly', 1500)).status).toBe(403);
  });

  it('el sueldo de otra empresa no existe para mí', async () => {
    const { app, ana } = await setup();
    const other = await createCompany(prisma, { name: 'Otra' });
    const otherAdmin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: other.id });
    const asOther = bearer((await login(app, otherAdmin.email, DEFAULT_PASSWORD)).accessToken);

    expect((await get(app, asOther, `/company/employees/${ana.id}/pay-rates`)).status).toBe(404);
    const res = await setRate(app, asOther, ana.id, 'hourly', 1);
    expect(res.status).toBe(404);
    expect(await prisma.employeePayRate.count()).toBe(0);
  });
});

describe('Pago en la hoja del periodo', () => {
  it('por hora: horas × tarifa, con el cambio de tarifa desde su fecha', async () => {
    const { app, company, ana, asAdmin } = await setup();
    await setRate(app, asAdmin, ana.id, 'hourly', 1500).expect(200);
    await setRate(app, asAdmin, ana.id, 'hourly', 2000, '2026-09-28').expect(200);
    await addEntry(company.id, ana.id, '2026-09-22', 8);
    await addEntry(company.id, ana.id, '2026-09-29', 4);

    const res = await timesheet(app, asAdmin);
    expect(res.status).toBe(200);
    expect(payOf(res.body, ana.id)).toEqual({
      amountCents: 8 * 1500 + 4 * 2000,
      rate: { kind: 'hourly', amountCents: 2000, effectiveFrom: '2026-09-28' },
      salaryDays: 0,
    });
    expect(res.body.meta.pay).toEqual({
      currency: 'USD',
      totalCents: 20_000,
      hourlyCents: 20_000,
      salaryCents: 0,
    });
    expect(res.body.meta.totalHours).toBe(12);

    const csv = await get(app, asAdmin, `/company/payroll/export?date=${IN_PERIOD}`);
    const lines = csv.text.replace('\uFEFF', '').trim().split('\r\n');
    expect(csv.headers['content-disposition']).toContain('nomina-2026-09-21_2026-10-04.csv');
    expect(lines[0]).toBe(
      'Código,Empleado,Estado,Tipo,Sueldo,Horas,Días con sueldo fijo,Pago (USD)',
    );
    expect(lines.find((line) => line.includes('Ana'))).toMatch(
      /,Activo,Por hora,20\.00,12\.00,,200\.00$/,
    );
    expect(lines.at(-1)).toBe(',Total,,,,12.00,,200.00');

    const hours = await get(app, asAdmin, `/company/timesheet?date=${IN_PERIOD}`);
    expect(hours.body.data[0]).not.toHaveProperty('pay');
    expect(hours.body.meta).not.toHaveProperty('pay');
  });

  it('sueldo fijo: proporcional hasta el día de la baja, aunque no haya marcado', async () => {
    const { app, luis, asAdmin } = await setup('2026-09-27T18:00:00Z');
    await setRate(app, asAdmin, luis.id, 'salary', 140_000).expect(200);
    await patch(app, asAdmin, `/company/employees/${luis.id}/status`, {
      status: 'inactive',
    }).expect(200);

    const span = await prisma.employeeInactiveSpan.findFirstOrThrow({
      where: { employeeId: luis.id },
    });
    expect(span.fromDay.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(span.toDay).toBeNull();
    const res = await timesheet(app, asAdmin);
    expect(payOf(res.body, luis.id)).toMatchObject({ amountCents: 70_000, salaryDays: 7 });
  });

  it('el empleado no ve la nómina', async () => {
    const { app, asEmployee } = await setup();
    expect((await timesheet(app, asEmployee)).status).toBe(403);
  });

  it('quien no tiene sueldo no va en la tabla sino en los pendientes', async () => {
    const { app, ana, luis, asAdmin } = await setup();
    await setRate(app, asAdmin, luis.id, 'salary', 140_000).expect(200);
    const res = await timesheet(app, asAdmin);

    expect(payOf(res.body, ana.id)).toBeUndefined();
    expect(res.body.meta.missingPay).toMatchObject([{ id: ana.id }]);
    expect(res.body.meta).toMatchObject({
      employeeCount: 2,
      total: 1,
      pay: { totalCents: 140_000, hourlyCents: 0, salaryCents: 140_000 },
    });
  });
});

describe('Cierre del periodo', () => {
  it('congela el pago y la moneda, y ya no deja cambiar el sueldo de esos días', async () => {
    const { app, company, ana, luis, asAdmin } = await setup();
    await setRate(app, asAdmin, ana.id, 'hourly', 1500).expect(200);
    await setRate(app, asAdmin, luis.id, 'salary', 140_000).expect(200);
    await addEntry(company.id, ana.id, '2026-09-22', 8);
    await prisma.employeeInactiveSpan.create({
      data: {
        companyId: company.id,
        employeeId: luis.id,
        fromDay: new Date('2026-09-28T00:00:00.000Z'),
      },
    });

    await post(app, asAdmin, '/company/periods/close', { date: IN_PERIOD }).expect(201);

    // Lo que cambie despues no toca lo congelado
    await prisma.employeeInactiveSpan.deleteMany({ where: { employeeId: luis.id } });
    await patch(app, asAdmin, '/company', { currency: 'MXN' }).expect(200);

    const closed = await timesheet(app, asAdmin);
    expect(payOf(closed.body, ana.id)).toMatchObject({ amountCents: 12_000 });
    expect(payOf(closed.body, luis.id)).toMatchObject({ amountCents: 70_000 });
    expect(closed.body.meta.pay).toMatchObject({
      currency: 'USD',
      totalCents: 82_000,
      hourlyCents: 12_000,
      salaryCents: 70_000,
    });
    expect((await timesheet(app, asAdmin, '2026-10-07')).body.meta.pay.currency).toBe('MXN');

    const blocked = await setRate(app, asAdmin, ana.id, 'hourly', 9999, '2026-10-04');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PAY_RATE_IN_CLOSED_PERIOD');
    await setRate(app, asAdmin, ana.id, 'hourly', 1800, '2026-10-05').expect(200);
  });

  it('la base de datos rechaza sueldos en días cerrados y cambios a lo congelado', async () => {
    const { app, company, ana, admin, asAdmin } = await setup();
    await setRate(app, asAdmin, ana.id, 'salary', 140_000).expect(200);
    await post(app, asAdmin, '/company/periods/close', { date: IN_PERIOD }).expect(201);

    await expect(
      prisma.employeePayRate.create({
        data: {
          companyId: company.id,
          employeeId: ana.id,
          kind: 'hourly',
          amountCents: 1n,
          effectiveFrom: new Date('2026-09-30T00:00:00.000Z'),
          changedById: admin.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.payPeriodClosurePay.updateMany({
        where: { employeeId: ana.id },
        data: { amountCents: 1n },
      }),
    ).rejects.toThrow();
  });

  it('un empleado con pagos cerrados ya no se puede eliminar; uno solo con sueldo, sí', async () => {
    const { app, ana, luis, asAdmin } = await setup();
    await setRate(app, asAdmin, ana.id, 'salary', 140_000).expect(200);
    await post(app, asAdmin, '/company/periods/close', { date: IN_PERIOD }).expect(201);

    const blocked = await request(app)
      .delete(api(`/company/employees/${ana.id}`))
      .set(asAdmin);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('EMPLOYEE_HAS_HISTORY');

    await setRate(app, asAdmin, luis.id, 'hourly', 1500, '2026-10-05').expect(200);
    await request(app)
      .delete(api(`/company/employees/${luis.id}`))
      .set(asAdmin)
      .expect(204);
    expect(await prisma.employeePayRate.count({ where: { employeeId: luis.id } })).toBe(0);
  });
});

const setStatus = (
  app: Express,
  auth: Auth,
  employeeId: string,
  status: 'active' | 'inactive',
  effectiveOn?: string,
) => patch(app, auth, `/company/employees/${employeeId}/status`, { status, effectiveOn });

const removeRate = (app: Express, auth: Auth, employeeId: string, rateId: string | undefined) =>
  request(app)
    .delete(api(`/company/employees/${employeeId}/pay-rates/${rateId}`))
    .set(auth);

describe('Bajas con fecha elegida', () => {
  it('el sueldo fijo no paga los días entre la baja y la reactivación', async () => {
    const { app, luis, asAdmin } = await setup('2026-09-30T18:00:00Z');
    await setRate(app, asAdmin, luis.id, 'salary', 140_000).expect(200);
    await setStatus(app, asAdmin, luis.id, 'inactive', '2026-09-23').expect(200);
    await setStatus(app, asAdmin, luis.id, 'active', '2026-09-28').expect(200);

    const rates = await get(app, asAdmin, `/company/employees/${luis.id}/pay-rates`);
    expect(rates.body.data.inactiveSpans).toEqual([{ fromDay: '2026-09-24', toDay: '2026-09-27' }]);
    // 14 dias menos 4 de baja
    expect(payOf((await timesheet(app, asAdmin)).body, luis.id)).toMatchObject({
      amountCents: 100_000,
    });
    const audit = await prisma.securityEvent.findFirstOrThrow({
      where: { type: 'employee.reactivated' },
    });
    expect(audit.metadata).toMatchObject({ effectiveOn: '2026-09-28' });
  });

  it('reactivar desde el mismo día de la baja no deja días sin pago', async () => {
    const { app, luis, asAdmin } = await setup('2026-09-30T18:00:00Z');
    await setStatus(app, asAdmin, luis.id, 'inactive', '2026-09-25').expect(200);
    await setStatus(app, asAdmin, luis.id, 'active', '2026-09-25').expect(200);
    expect(await prisma.employeeInactiveSpan.count({ where: { employeeId: luis.id } })).toBe(0);
  });

  it('rechaza fechas futuras, anteriores a la baja o de un periodo cerrado', async () => {
    const { app, luis, asAdmin } = await setup();
    const future = await setStatus(app, asAdmin, luis.id, 'inactive', '2026-10-08');
    expect(future.status).toBe(400);
    expect(future.body.error.code).toBe('INVALID_STATUS_DATE');

    await post(app, asAdmin, '/company/periods/close', { date: IN_PERIOD }).expect(201);
    const closed = await setStatus(app, asAdmin, luis.id, 'inactive', '2026-10-04');
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('STATUS_DATE_IN_CLOSED_PERIOD');
    expect(await prisma.employeeInactiveSpan.count()).toBe(0);

    await setStatus(app, asAdmin, luis.id, 'inactive', '2026-10-06').expect(200);
    const before = await setStatus(app, asAdmin, luis.id, 'active', '2026-10-05');
    expect(before.status).toBe(400);
    expect(before.body.error.code).toBe('INVALID_STATUS_DATE');
  });

  it('la base de datos no deja crear una baja en un periodo cerrado', async () => {
    const { app, company, luis, asAdmin } = await setup();
    await post(app, asAdmin, '/company/periods/close', { date: IN_PERIOD }).expect(201);
    await expect(
      prisma.employeeInactiveSpan.create({
        data: {
          companyId: company.id,
          employeeId: luis.id,
          fromDay: new Date('2026-10-01T00:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('Quitar un cambio de sueldo', () => {
  it('quita un cambio equivocado y lo deja en la auditoría', async () => {
    const { app, ana, asAdmin } = await setup();
    await setRate(app, asAdmin, ana.id, 'hourly', 1500, '2026-10-05').expect(200);
    const wrong = await setRate(app, asAdmin, ana.id, 'hourly', 9900, '2026-10-12');
    const wrongId = (wrong.body.data.rates as { id: string; effectiveFrom: string }[]).find(
      (rate) => rate.effectiveFrom === '2026-10-12',
    )?.id;

    const res = await removeRate(app, asAdmin, ana.id, wrongId);
    expect(res.status).toBe(200);
    expect(res.body.data.rates).toMatchObject([{ effectiveFrom: '2026-10-05', locked: false }]);
    const audit = await prisma.securityEvent.findFirstOrThrow({
      where: { type: 'employee.pay_rate_removed' },
    });
    expect(audit.metadata).toMatchObject({ amountCents: 9900, effectiveFrom: '2026-10-12' });
  });

  it('no quita un cambio que rige en un periodo cerrado', async () => {
    const { app, ana, asAdmin } = await setup();
    const saved = await setRate(app, asAdmin, ana.id, 'hourly', 1500).expect(200);
    const rateId = (saved.body.data.rates as { id: string }[])[0]?.id;
    await post(app, asAdmin, '/company/periods/close', { date: IN_PERIOD }).expect(201);

    const listed = await get(app, asAdmin, `/company/employees/${ana.id}/pay-rates`);
    expect(listed.body.data.rates[0].locked).toBe(true);
    const res = await removeRate(app, asAdmin, ana.id, rateId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAY_RATE_IN_CLOSED_PERIOD');
    await expect(prisma.employeePayRate.deleteMany({ where: { id: rateId } })).rejects.toThrow();
  });

  it('el cambio de otra empresa no existe para mí', async () => {
    const { app, ana, asAdmin } = await setup();
    const saved = await setRate(app, asAdmin, ana.id, 'hourly', 1500).expect(200);
    const rateId = (saved.body.data.rates as { id: string }[])[0]?.id;
    const other = await createCompany(prisma, { name: 'Otra' });
    const otherAdmin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: other.id });
    const asOther = bearer((await login(app, otherAdmin.email, DEFAULT_PASSWORD)).accessToken);

    expect((await removeRate(app, asOther, ana.id, rateId)).status).toBe(404);
    expect(await prisma.employeePayRate.count()).toBe(1);
  });
});
