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
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS test_audit_failure ON security_events`;
});

const NOW = '2026-10-07T18:00:00Z';

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
}

async function setup(options: { requireDailyReport?: boolean; presetLimit?: number } = {}) {
  const { app, clock, container } = createTestApp(
    options.presetLimit ? { presetLimit: options.presetLimit } : {},
  );
  setTime(clock, NOW);
  const company = await createCompany(prisma, {
    requireDailyReport: options.requireDailyReport ?? false,
  });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asEmployee = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, clock, container, company, admin, user, employee, asAdmin, asEmployee };
}

async function addEntry(
  companyId: string,
  employeeId: string,
  date: string,
  from = '08:00',
  to: string | null = '12:00',
  extra: { dailyLimitWaived?: boolean } = {},
) {
  const id = uuidv7();
  await prisma.timeEntry.create({
    data: {
      id,
      companyId,
      employeeId,
      clockInAt: new Date(`${date}T${from}:00-06:00`),
      clockOutAt: to ? new Date(`${date}T${to}:00-06:00`) : null,
      timezone: 'America/Denver',
      workDate: new Date(`${date}T00:00:00.000Z`),
      source: 'web',
      ...extra,
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

describe('fechas fuera de rango', () => {
  it('se rechazan con 400 en lugar de romper con un 500', async () => {
    const { app, employee, asAdmin, asEmployee } = await setup();
    for (const path of [
      '/company/periods?date=9999-12-31',
      '/company/timesheet?date=0000-01-01',
      '/company/timesheet/export?date=9999-12-31',
      `/company/employees/${employee.id}/timesheet?date=9999-12-31`,
      '/company/time-entries?from=0001-01-01&to=0001-02-01',
    ]) {
      expect((await get(app, asAdmin, path)).status, path).toBe(400);
    }
    expect((await get(app, asEmployee, '/me/timesheet?date=9999-12-31')).status).toBe(400);
    expect((await get(app, asEmployee, '/me/daily-reports?from=0001-01-01')).status).toBe(400);
  });

  it('un instante de otro milenio no se acepta ni al crear ni al corregir', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const manual = await post(app, asAdmin, `/company/employees/${employee.id}/time-entries`, {
      clockInAt: '0001-06-01T08:00:00Z',
      clockOutAt: '2026-10-06T16:00:00Z',
      reason: 'Registro de prueba',
    });
    expect(manual.status).toBe(400);

    const entry = await addEntry(company.id, employee.id, '2026-10-06');
    const correct = await patch(app, asAdmin, `/company/time-entries/${entry}`, {
      clockInAt: '0001-06-01T08:00:00Z',
      reason: 'Corrección de prueba',
    });
    expect(correct.status).toBe(400);
    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry } });
    expect(stored.workDate.toISOString().slice(0, 10)).toBe('2026-10-06');
  });
});

describe('entrada olvidada con reporte obligatorio', () => {
  it('se puede cerrar con su reporte aunque lleve más de 14 días abierta', async () => {
    const { app, company, employee, asEmployee } = await setup({ requireDailyReport: true });
    await addEntry(company.id, employee.id, '2026-09-10', '08:00', null);

    expect((await get(app, asEmployee, '/me/clock-status')).body.data.clockedIn).toBe(true);
    const withoutReport = await post(app, asEmployee, '/me/clock-out');
    expect(withoutReport.body.error.code).toBe('DAILY_REPORT_REQUIRED');

    const res = await post(app, asEmployee, '/me/clock-out', {
      dailyReport: 'Me quedé con la entrada abierta por olvido',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
    expect((await get(app, asEmployee, '/me/clock-status')).body.data.clockedIn).toBe(false);
  });
});

describe('la auditoría de acciones sensibles va en la misma transacción', () => {
  async function failAuditOf(typeCondition: string) {
    await prisma.$executeRaw`
      CREATE OR REPLACE FUNCTION test_audit_failure() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'auditoria caida';
      END;
      $$ LANGUAGE plpgsql`;
    // eslint-disable-next-line no-restricted-properties
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER test_audit_failure BEFORE INSERT ON security_events
       FOR EACH ROW WHEN (${typeCondition}) EXECUTE FUNCTION test_audit_failure()`,
    );
  }
  const restoreAudit = () =>
    prisma.$executeRaw`DROP TRIGGER IF EXISTS test_audit_failure ON security_events`;

  it('si no se puede auditar, el registro manual no se crea', async () => {
    const { app, employee, asAdmin } = await setup();
    await failAuditOf(`NEW.type = 'time_entry.created_by_admin'`);

    const body = {
      clockInAt: '2026-10-06T08:00:00-06:00',
      clockOutAt: '2026-10-06T12:00:00-06:00',
      reason: 'Olvidó marcar la jornada',
    };
    const failed = await post(app, asAdmin, `/company/employees/${employee.id}/time-entries`, body);
    expect(failed.status).toBe(500);
    expect(await prisma.timeEntry.count()).toBe(0);

    await restoreAudit();
    expect(
      (await post(app, asAdmin, `/company/employees/${employee.id}/time-entries`, body)).status,
    ).toBe(201);
  });

  it('si no se puede auditar, ni se anula, ni se corrige, ni se marca por otro', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const done = await addEntry(company.id, employee.id, '2026-10-06');
    await failAuditOf(`NEW.type LIKE 'time_entry.%_by_admin'`);

    const voided = await post(app, asAdmin, `/company/time-entries/${done}/void`, {
      reason: 'Se creó por duplicado',
    });
    expect(voided.status).toBe(500);
    const corrected = await patch(app, asAdmin, `/company/time-entries/${done}`, {
      clockOutAt: '2026-10-06T13:00:00-06:00',
      reason: 'Salió más tarde',
    });
    expect(corrected.status).toBe(500);
    const clockedIn = await post(app, asAdmin, `/company/employees/${employee.id}/clock-in`);
    expect(clockedIn.status).toBe(500);

    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: done } });
    expect(stored.voidedAt).toBeNull();
    expect(stored.clockOutAt?.toISOString()).toBe('2026-10-06T18:00:00.000Z');
    expect(await prisma.timeEntry.count({ where: { clockOutAt: null } })).toBe(0);

    await restoreAudit();
    await post(app, asAdmin, `/company/employees/${employee.id}/clock-in`);
    await failAuditOf(`NEW.type = 'time_entry.clocked_out_by_admin'`);
    const out = await post(app, asAdmin, `/company/employees/${employee.id}/clock-out`);
    expect(out.status).toBe(500);
    expect(await prisma.timeEntry.count({ where: { clockOutAt: null } })).toBe(1);
  });

  it('si no se puede auditar, el periodo no se cierra', async () => {
    const { app, asAdmin } = await setup();
    await failAuditOf(`NEW.type = 'pay_period.closed'`);

    const res = await post(app, asAdmin, '/company/periods/close', { date: '2026-09-30' });
    expect(res.status).toBe(500);
    expect(await prisma.payPeriodClosure.count()).toBe(0);
  });
});

describe('desactivar a un empleado con una entrada abierta', () => {
  it('la tarea de respaldo cierra las entradas abiertas de empleados ya inactivos', async () => {
    const { container, company, employee, user } = await setup();
    const open = await addEntry(company.id, employee.id, '2026-10-07', '09:00', null);
    const { employee: other } = await createEmployee(prisma, company.id, { firstName: 'Beto' });
    const kept = await addEntry(company.id, other.id, '2026-10-07', '09:00', null);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'inactive' } });

    expect(await container.cradle.closeEntriesOfInactiveEmployees.execute()).toBe(1);

    const closed = await prisma.timeEntry.findUniqueOrThrow({ where: { id: open } });
    expect(closed.clockOutAt).not.toBeNull();
    expect(closed.closeSource).toBe('admin');
    expect(
      (await prisma.timeEntry.findUniqueOrThrow({ where: { id: kept } })).clockOutAt,
    ).toBeNull();
    expect(await container.cradle.closeEntriesOfInactiveEmployees.execute()).toBe(0);
  });
});

describe('resumen del día', () => {
  it('quien trabaja con horas extra autorizadas no cuenta como límite alcanzado', async () => {
    const { app, company, employee, asAdmin } = await setup();
    await prisma.company.update({ where: { id: company.id }, data: { dailyLimitMinutes: 120 } });
    await addEntry(company.id, employee.id, '2026-10-07', '07:00', null, {
      dailyLimitWaived: true,
    });

    const res = await get(app, asAdmin, '/company/attendance/summary');
    expect(res.body.data.atLimit.count).toBe(0);
    expect(res.body.data.employees.in).toBe(1);
  });
});

describe('nombres con caracteres de control', () => {
  it('se rechazan, y el cambio de nombre guarda el anterior', async () => {
    const { app, employee, asEmployee } = await setup();
    for (const firstName of ['Ana\nLópez', 'Ana\u0000', 'Ana\tLópez']) {
      const res = await patch(app, asEmployee, '/auth/me', { firstName, lastName: 'López' });
      expect(res.status, JSON.stringify(firstName)).toBe(400);
    }

    const ok = await patch(app, asEmployee, '/auth/me', { firstName: 'Mariana', lastName: 'Ruiz' });
    expect(ok.status).toBe(200);
    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { type: 'profile.updated' },
    });
    expect(event.userId).toBe(employee.userId);
    expect(event.metadata).toMatchObject({ previousFirstName: 'Ana', previousLastName: 'User' });
  });
});

describe('límites de uso en endpoints pesados y sensibles', () => {
  it('el CSV, la actividad y las consultas agrupadas devuelven 429 al excederse', async () => {
    const { app, asAdmin } = await setup({ presetLimit: 3 });
    for (const path of [
      '/company/timesheet/export',
      '/company/activity',
      '/company/attendance/summary',
      '/company/timesheet',
      '/company/periods',
      '/company/daily-reports/pending',
    ]) {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await get(app, asAdmin, path)).status);
      expect(statuses.slice(0, 3), path).toEqual([200, 200, 200]);
      expect(statuses.slice(3), path).toEqual([429, 429]);
    }
  });

  it('cerrar periodos y cerrar sesiones de un empleado también tienen límite', async () => {
    const { app, employee, asAdmin } = await setup({ presetLimit: 3 });
    const closes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      closes.push((await post(app, asAdmin, '/company/periods/close', { date: 'ayer' })).status);
    }
    expect(closes).toEqual([400, 400, 400, 429, 429]);

    const revokes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      revokes.push(
        (await post(app, asAdmin, `/company/employees/${employee.id}/revoke-sessions`)).status,
      );
    }
    expect(revokes).toEqual([204, 204, 204, 429, 429]);
  });
});
