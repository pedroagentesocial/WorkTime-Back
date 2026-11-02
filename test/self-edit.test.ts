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

// Miercoles 7 oct 2026 a mediodia en Denver
const NOW = '2026-10-07T18:00:00Z';

type Auth = Record<string, string>;
const get = (app: Express, auth: Auth, path: string) => request(app).get(api(path)).set(auth);
const patch = (app: Express, auth: Auth, path: string, body: object) =>
  request(app).patch(api(path)).set(auth).send(body);
const post = (app: Express, auth: Auth, path: string, body: object = {}) =>
  request(app).post(api(path)).set(auth).send(body);

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
}

async function setup() {
  const { app, clock } = createTestApp();
  setTime(clock, NOW);
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const ana = await createEmployee(prisma, company.id, { firstName: 'Ana' });
  const beto = await createEmployee(prisma, company.id, { firstName: 'Beto' });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asAna = bearer((await login(app, ana.user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, company, ana: ana.employee, beto: beto.employee, asAdmin, asAna };
}

async function addEntry(
  companyId: string,
  employeeId: string,
  date: string,
  from: string,
  to: string | null,
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

const allow = (app: Express, auth: Auth, employeeId: string, body: object = {}) =>
  patch(app, auth, `/company/employees/${employeeId}`, { allowSelfEdit: true, ...body }).expect(
    200,
  );

const correct = (app: Express, auth: Auth, entryId: string, body: object) =>
  patch(app, auth, `/me/time-entries/${entryId}`, { reason: 'Olvidé marcar a tiempo', ...body });

describe('El empleado corrige sus horas', () => {
  it('sin permiso no puede corregir y su estado no lo ofrece', async () => {
    const { app, company, ana, asAna } = await setup();
    const entry = await addEntry(company.id, ana.id, '2026-10-06', '08:00', '12:00');

    expect((await get(app, asAna, '/me/clock-status')).body.data.selfEdit).toBeNull();
    const res = await correct(app, asAna, entry, { clockOutAt: '2026-10-06T13:00:00-06:00' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_EDIT_NOT_ALLOWED');
  });

  it('con permiso corrige su salida, queda en el historial y en la actividad del admin', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    const entry = await addEntry(company.id, ana.id, '2026-10-06', '08:00', '12:00');
    await allow(app, asAdmin, ana.id);

    expect((await get(app, asAna, '/me/clock-status')).body.data.selfEdit).toEqual({
      days: 7,
      until: null,
    });
    const res = await correct(app, asAna, entry, { clockOutAt: '2026-10-06T13:30:00-06:00' });
    expect(res.status).toBe(200);
    expect(res.body.data.clockOutAt).toBe('2026-10-06T19:30:00.000Z');

    const history = await get(app, asAdmin, `/company/time-entries/${entry}/corrections`);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({ reason: 'Olvidé marcar a tiempo' });
    const activity = await get(
      app,
      asAdmin,
      '/company/activity?type=time_entry.corrected_by_employee',
    );
    expect(activity.body.data).toHaveLength(1);
    expect(activity.body.data[0].actor.id).not.toBeNull();
  });

  it('puede poner la salida que olvidó un día anterior', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    const entry = await addEntry(company.id, ana.id, '2026-10-06', '09:00', null);
    await allow(app, asAdmin, ana.id);

    const res = await correct(app, asAna, entry, { clockOutAt: '2026-10-06T17:00:00-06:00' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
  });

  it('la entrada abierta de hoy se termina con Salida, no corrigiendo', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    const entry = await addEntry(company.id, ana.id, '2026-10-07', '09:00', null);
    await allow(app, asAdmin, ana.id);

    const res = await correct(app, asAna, entry, { clockInAt: '2026-10-07T08:00:00-06:00' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_EDIT_OPEN_TODAY');
  });

  it('solo dentro de los días que permite la empresa', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    const old = await addEntry(company.id, ana.id, '2026-09-28', '08:00', '12:00');
    await allow(app, asAdmin, ana.id);

    const blocked = await correct(app, asAna, old, { clockOutAt: '2026-09-28T13:00:00-06:00' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('SELF_EDIT_OUT_OF_RANGE');

    await patch(app, asAdmin, '/company', { selfEditDays: 10 }).expect(200);
    await correct(app, asAna, old, { clockOutAt: '2026-09-28T13:00:00-06:00' }).expect(200);

    const tooMany = await patch(app, asAdmin, '/company', { selfEditDays: 40 });
    expect(tooMany.status).toBe(400);
  });

  it('el permiso vence en su fecha', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    const entry = await addEntry(company.id, ana.id, '2026-10-05', '08:00', '12:00');
    await allow(app, asAdmin, ana.id, { selfEditUntil: '2026-10-06' });

    const employee = await get(app, asAdmin, `/company/employees/${ana.id}`);
    expect(employee.body.data).toMatchObject({ allowSelfEdit: true, selfEditUntil: '2026-10-06' });
    const res = await correct(app, asAna, entry, { clockOutAt: '2026-10-05T13:00:00-06:00' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_EDIT_NOT_ALLOWED');
  });

  it('no toca el marcaje de otro empleado', async () => {
    const { app, company, ana, beto, asAdmin, asAna } = await setup();
    const betos = await addEntry(company.id, beto.id, '2026-10-06', '08:00', '12:00');
    await allow(app, asAdmin, ana.id);

    const res = await correct(app, asAna, betos, { clockOutAt: '2026-10-06T13:00:00-06:00' });
    expect(res.status).toBe(404);
    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: betos } });
    expect(stored.clockOutAt?.toISOString()).toBe('2026-10-06T18:00:00.000Z');
  });

  it('no puede pasar su límite diario', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    await addEntry(company.id, ana.id, '2026-10-06', '13:00', '17:00');
    const morning = await addEntry(company.id, ana.id, '2026-10-06', '08:00', '12:00');
    await allow(app, asAdmin, ana.id, { dailyLimitMinutes: 480 });

    const res = await correct(app, asAna, morning, { clockInAt: '2026-10-06T07:00:00-06:00' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_EDIT_OVER_LIMIT');
    // Acortar si se puede
    await correct(app, asAna, morning, { clockInAt: '2026-10-06T08:30:00-06:00' }).expect(200);
  });

  it('sin límite diario no puede estirar un marcaje a más de 24 h', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    const entry = await addEntry(company.id, ana.id, '2026-10-04', '08:00', '17:00');
    await allow(app, asAdmin, ana.id);

    const res = await correct(app, asAna, entry, { clockOutAt: '2026-10-07T09:00:00-06:00' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_EDIT_TOO_LONG');
    // Un turno nocturno que termina al dia siguiente si se puede
    await correct(app, asAna, entry, { clockOutAt: '2026-10-05T02:00:00-06:00' }).expect(200);
  });

  it('no alarga un marcaje con horas extra autorizadas por el admin', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    const entry = await addEntry(company.id, ana.id, '2026-10-06', '08:00', '18:00');
    await prisma.timeEntry.update({ where: { id: entry }, data: { dailyLimitWaived: true } });
    await allow(app, asAdmin, ana.id, { dailyLimitMinutes: 480 });

    const res = await correct(app, asAna, entry, { clockOutAt: '2026-10-06T20:00:00-06:00' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_EDIT_OVER_LIMIT');
    await correct(app, asAna, entry, { clockOutAt: '2026-10-06T17:00:00-06:00' }).expect(200);
  });

  it('una entrada abierta de otro día se mide hasta ahora contra su límite', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    // Turno nocturno que sigue abierto: empezo ayer a las 22:00 y ahora es mediodia
    const entry = await addEntry(company.id, ana.id, '2026-10-06', '22:00', null);
    await allow(app, asAdmin, ana.id, { dailyLimitMinutes: 1200 });

    const res = await correct(app, asAna, entry, { clockInAt: '2026-10-06T06:00:00-06:00' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_EDIT_TOO_LONG');
    // 22 h hasta ahora: no pasa de 24 h pero si de su limite de 20 h
    const late = await correct(app, asAna, entry, { clockInAt: '2026-10-06T14:00:00-06:00' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('SELF_EDIT_OVER_LIMIT');
  });

  it('una salida leída antes de una corrección de la entrada no cierra el marcaje cambiado', async () => {
    const { container } = createTestApp();
    const company = await createCompany(prisma);
    const ana = await createEmployee(prisma, company.id, { firstName: 'Ana' });
    const entry = await addEntry(company.id, ana.employee.id, '2026-10-06', '22:00', null);
    const readClockIn = new Date('2026-10-06T22:00:00-06:00');
    // La correccion simultanea movio la entrada despues de que la salida la leyera
    await prisma.timeEntry.update({
      where: { id: entry },
      data: { clockInAt: new Date('2026-10-06T06:00:00-06:00') },
    });

    const repository = container.cradle.timeEntryRepository;
    const closeAt = new Date('2026-10-07T02:00:00-06:00');
    expect(await repository.closeIfOpen(company.id, entry, closeAt, 'employee', readClockIn)).toBe(
      false,
    );
    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry } });
    expect(stored.clockOutAt).toBeNull();
  });

  it('nunca dentro de un periodo cerrado', async () => {
    const { app, company, ana, asAdmin, asAna } = await setup();
    const entry = await addEntry(company.id, ana.id, '2026-10-02', '08:00', '12:00');
    await allow(app, asAdmin, ana.id);
    await post(app, asAdmin, '/company/periods/close', { date: '2026-09-30' }).expect(201);

    const res = await correct(app, asAna, entry, { clockOutAt: '2026-10-02T13:00:00-06:00' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_CLOSED');
  });
});
