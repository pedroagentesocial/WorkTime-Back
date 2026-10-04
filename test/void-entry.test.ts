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

const NOW = '2026-10-07T18:00:00Z';

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
}

async function setup(options: { requireDailyReport?: boolean } = {}) {
  const { app, clock } = createTestApp();
  setTime(clock, NOW);
  const company = await createCompany(prisma, options);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id);
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asEmployee = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, company, admin, employee, asAdmin, asEmployee };
}

async function addEntry(
  companyId: string,
  employeeId: string,
  date: string,
  from = '08:00',
  to: string | null = '12:00',
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
    },
  });
  return id;
}

const get = (app: Express, auth: Record<string, string>, path: string) =>
  request(app).get(api(path)).set(auth);
const post = (app: Express, auth: Record<string, string>, path: string, body: object = {}) =>
  request(app).post(api(path)).set(auth).send(body);
const voidEntry = (
  app: Express,
  auth: Record<string, string>,
  id: string,
  body: object = { reason: 'Se creó por duplicado' },
) => post(app, auth, `/company/time-entries/${id}/void`, body);

describe('POST /company/time-entries/{id}/void', () => {
  it('anula, deja constancia y el empleado deja de verlo', async () => {
    const { app, company, admin, employee, asAdmin, asEmployee } = await setup();
    const id = await addEntry(company.id, employee.id, '2026-10-06');

    const res = await voidEntry(app, asAdmin, id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'voided',
      voidReason: 'Se creó por duplicado',
      voidedBy: { id: admin.id },
    });
    expect(res.body.data.voidedAt).toBe('2026-10-07T18:00:00.000Z');

    const mine = await get(app, asEmployee, '/me/time-entries');
    expect(mine.body.data).toEqual([]);
    expect(mine.body.meta.totalHours).toBe(0);
    const sheet = await get(app, asEmployee, '/me/timesheet?date=2026-10-06');
    expect(sheet.body.data.totalHours).toBe(0);

    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { type: 'time_entry.voided_by_admin' },
    });
    expect(event.userId).toBe(admin.id);
    expect(event.metadata).toMatchObject({ timeEntryId: id, reason: 'Se creó por duplicado' });
  });

  it('el admin no lo ve en la lista salvo con status=voided, y no suma horas', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const kept = await addEntry(company.id, employee.id, '2026-10-05', '08:00', '12:00');
    const voided = await addEntry(company.id, employee.id, '2026-10-06', '08:00', '12:00');
    await voidEntry(app, asAdmin, voided);

    const all = await get(app, asAdmin, '/company/time-entries');
    const listed = all.body.data as { id: string }[];
    expect(listed.map((e) => e.id)).toEqual([kept]);
    expect(all.body.meta.totalHours).toBe(4);

    const onlyVoided = await get(app, asAdmin, '/company/time-entries?status=voided');
    expect(onlyVoided.body.data).toHaveLength(1);
    expect(onlyVoided.body.data[0]).toMatchObject({ id: voided, status: 'voided' });
    expect(onlyVoided.body.meta.totalHours).toBe(0);

    const detail = await get(app, asAdmin, `/company/time-entries/${voided}`);
    expect(detail.body.data.status).toBe('voided');
    expect((await get(app, asAdmin, `/company/time-entries/${voided}/corrections`)).status).toBe(
      200,
    );

    const sheet = await get(app, asAdmin, '/company/timesheet?date=2026-10-06');
    expect(sheet.body.meta.totals.totalHours).toBe(4);
  });

  it('anular una entrada abierta deja al empleado libre para marcar de nuevo', async () => {
    const { app, company, employee, asAdmin, asEmployee } = await setup();
    const id = await addEntry(company.id, employee.id, '2026-10-07', '09:00', null);
    expect((await get(app, asEmployee, '/me/clock-status')).body.data.clockedIn).toBe(true);

    expect((await voidEntry(app, asAdmin, id)).status).toBe(200);

    expect((await get(app, asEmployee, '/me/clock-status')).body.data.clockedIn).toBe(false);
    const live = await get(app, asAdmin, '/company/attendance/live');
    expect(live.body.data.working).toBe(0);
    const roster = await get(app, asAdmin, '/company/attendance/roster');
    expect(roster.body.data[0].status).toBe('out');
    expect((await post(app, asEmployee, '/me/clock-in')).status).toBe(201);
  });

  it('un registro anulado no cuenta para el límite diario ni para el resumen', async () => {
    const { app, company, employee, asAdmin, asEmployee } = await setup();
    await prisma.company.update({ where: { id: company.id }, data: { dailyLimitMinutes: 480 } });
    const id = await addEntry(company.id, employee.id, '2026-10-07', '04:00', '12:00');

    expect((await post(app, asEmployee, '/me/clock-in')).status).toBe(409);
    const before = await get(app, asAdmin, '/company/attendance/summary');
    expect(before.body.data.atLimit.count).toBe(1);

    await voidEntry(app, asAdmin, id);

    const after = await get(app, asAdmin, '/company/attendance/summary');
    expect(after.body.data.atLimit.count).toBe(0);
    expect(after.body.data.worked.seconds).toBe(0);
    expect((await post(app, asEmployee, '/me/clock-in')).status).toBe(201);
  });

  it('un día con solo registros anulados no queda con reporte pendiente', async () => {
    const { app, company, employee, asAdmin, asEmployee } = await setup({
      requireDailyReport: true,
    });
    const id = await addEntry(company.id, employee.id, '2026-10-05');
    expect((await get(app, asEmployee, '/me/daily-reports/pending')).body.data.days).toEqual([
      '2026-10-05',
    ]);

    await voidEntry(app, asAdmin, id);

    expect((await get(app, asEmployee, '/me/daily-reports/pending')).body.data.days).toEqual([]);
  });

  it('un registro anulado no estorba: ni cruces ni la entrada abierta única', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const id = await addEntry(company.id, employee.id, '2026-10-06', '08:00', '16:00');
    await voidEntry(app, asAdmin, id);

    const manual = await post(app, asAdmin, `/company/employees/${employee.id}/time-entries`, {
      clockInAt: '2026-10-06T09:00:00-06:00',
      clockOutAt: '2026-10-06T10:00:00-06:00',
      reason: 'Registro correcto',
    });
    expect(manual.status).toBe(201);

    const open = await addEntry(company.id, employee.id, '2026-10-07', '08:00', null);
    await voidEntry(app, asAdmin, open);
    await expect(
      addEntry(company.id, employee.id, '2026-10-07', '09:00', null),
    ).resolves.toBeTruthy();
  });

  it('no se anula dos veces ni se corrige uno anulado', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const id = await addEntry(company.id, employee.id, '2026-10-06');
    await voidEntry(app, asAdmin, id);

    const again = await voidEntry(app, asAdmin, id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TIME_ENTRY_VOIDED');

    const correct = await request(app)
      .patch(api(`/company/time-entries/${id}`))
      .set(asAdmin)
      .send({ clockOutAt: '2026-10-06T13:00:00-06:00', reason: 'Ajuste de salida' });
    expect(correct.status).toBe(409);
    expect(correct.body.error.code).toBe('TIME_ENTRY_VOIDED');
  });

  it('valida el motivo y no acepta campos extra', async () => {
    const { app, company, employee, asAdmin } = await setup();
    const id = await addEntry(company.id, employee.id, '2026-10-06');
    for (const body of [
      {},
      { reason: 'no' },
      { reason: 'x'.repeat(501) },
      { reason: 'Motivo válido', extra: 1 },
    ]) {
      expect((await voidEntry(app, asAdmin, id, body)).status).toBe(400);
    }
    expect((await get(app, asAdmin, `/company/time-entries/${id}`)).body.data.status).toBe(
      'closed',
    );
  });

  it('un registro de otra empresa o inexistente responde 404 y el empleado no puede', async () => {
    const { app, company, employee, asAdmin, asEmployee } = await setup();
    const other = await createCompany(prisma, { name: 'Otra' });
    const { employee: foreign } = await createEmployee(prisma, other.id);
    const foreignEntry = await addEntry(other.id, foreign.id, '2026-10-06');
    const own = await addEntry(company.id, employee.id, '2026-10-06');

    expect((await voidEntry(app, asAdmin, foreignEntry)).status).toBe(404);
    expect((await voidEntry(app, asAdmin, uuidv7())).status).toBe(404);
    expect((await voidEntry(app, asEmployee, own)).status).toBe(403);
    expect(
      await prisma.timeEntry.count({ where: { id: foreignEntry, voidedAt: { not: null } } }),
    ).toBe(0);
  });

  it('el empleado no puede pedir los anulados', async () => {
    const { app, asEmployee } = await setup();
    expect((await get(app, asEmployee, '/me/time-entries?status=voided')).status).toBe(400);
  });

  it('la BD no acepta un anulado sin quién y por qué', async () => {
    const { company, employee } = await setup();
    const id = await addEntry(company.id, employee.id, '2026-10-06');
    await expect(
      prisma.timeEntry.update({ where: { id }, data: { voidedAt: new Date() } }),
    ).rejects.toThrow(/time_entries_void_consistent/);
  });
});

describe('motivo guardado y actividad de correcciones', () => {
  it('el registro manual guarda su motivo y lo ven admin y empleado', async () => {
    const { app, employee, asAdmin, asEmployee } = await setup();
    const res = await post(app, asAdmin, `/company/employees/${employee.id}/time-entries`, {
      clockInAt: '2026-10-06T08:00:00-06:00',
      clockOutAt: '2026-10-06T16:30:00-06:00',
      reason: 'Olvidó marcar; confirmado con su supervisor',
    });
    expect(res.body.data.createdReason).toBe('Olvidó marcar; confirmado con su supervisor');

    const mine = await get(app, asEmployee, '/me/time-entries');
    expect(mine.body.data[0]).toMatchObject({
      source: 'admin',
      createdReason: 'Olvidó marcar; confirmado con su supervisor',
    });
  });

  it('un marcaje normal no tiene motivo', async () => {
    const { app, asEmployee } = await setup();
    const res = await post(app, asEmployee, '/me/clock-in');
    expect(res.body.data.createdReason).toBeNull();
  });

  it('corregir un registro queda auditado', async () => {
    const { app, company, admin, employee, asAdmin } = await setup();
    const id = await addEntry(company.id, employee.id, '2026-10-06');
    const res = await request(app)
      .patch(api(`/company/time-entries/${id}`))
      .set(asAdmin)
      .send({ clockOutAt: '2026-10-06T13:00:00-06:00', reason: 'Salió más tarde' });
    expect(res.status).toBe(200);

    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { type: 'time_entry.corrected_by_admin' },
    });
    expect(event.userId).toBe(admin.id);
    expect(event.metadata).toMatchObject({ timeEntryId: id, reason: 'Salió más tarde' });
  });
});
