import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import {
  CLOCK_IN_LOCATION,
  createCompany,
  createEmployee,
  createMultiAdmin,
  createUser,
  DEFAULT_PASSWORD,
} from './helpers/fixtures.js';
import { api, bearer, createTestApp, login, switchCompany } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

type Auth = Record<string, string>;

// Un grado de latitud son unos 111 km: sirve para poner un punto a una distancia conocida
const metersNorth = (meters: number, accuracyMeters = 5) => ({
  latitude: CLOCK_IN_LOCATION.latitude + meters / 111_195,
  longitude: CLOCK_IN_LOCATION.longitude,
  accuracyMeters,
});

async function setup(options: { allowCheckIns?: boolean } = {}) {
  const { app, clock } = createTestApp();
  const company = await createCompany(prisma, { name: 'Alfa' });
  if (options.allowCheckIns !== false) {
    await prisma.company.update({ where: { id: company.id }, data: { allowCheckIns: true } });
  }
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asAna = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, clock, company, admin, employee, asAdmin, asAna };
}

// Dia laboral en la zona de la empresa de prueba segun el reloj falso de la app
const workDateOf = (clock: { now(): Date }) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(clock.now());

// Llena el dia con registros previos para probar el tope sin hacer 49 peticiones
async function seedCheckIns(
  companyId: string,
  employeeId: string,
  workDate: string,
  count: number,
) {
  await prisma.checkIn.createMany({
    data: Array.from({ length: count }, () => ({
      companyId,
      employeeId,
      checkedInAt: new Date(`${workDate}T15:00:00.000Z`),
      timezone: 'America/Denver',
      workDate: new Date(`${workDate}T00:00:00.000Z`),
      latitude: CLOCK_IN_LOCATION.latitude,
      longitude: CLOCK_IN_LOCATION.longitude,
      accuracyM: 5,
    })),
  });
}

const checkIn = (app: Express, auth: Auth, body: object = CLOCK_IN_LOCATION) =>
  request(app).post(api('/me/check-ins')).set(auth).send(body);

const companyCheckIns = (app: Express, auth: Auth, query = '') =>
  request(app)
    .get(api(`/company/check-ins${query}`))
    .set(auth);

const voidCheckIn = (app: Express, auth: Auth, id: string, reason = 'Registrado por error') =>
  request(app)
    .post(api(`/company/check-ins/${id}/void`))
    .set(auth)
    .send({ reason });

describe('POST /me/check-ins', () => {
  it('registra la llegada con hora del servidor, ubicación y nota, sin tocar las horas', async () => {
    const { app, clock, asAna } = await setup();
    const res = await checkIn(app, asAna, {
      ...CLOCK_IN_LOCATION,
      note: '  Llegué con el cliente Pérez  ',
    }).expect(201);

    expect(res.body.data).toMatchObject({
      checkedInAt: clock.now().toISOString(),
      timezone: 'America/Denver',
      location: CLOCK_IN_LOCATION,
      zone: null,
      note: 'Llegué con el cliente Pérez',
    });
    expect(await prisma.timeEntry.count()).toBe(0);
    const status = await request(app).get(api('/me/clock-status')).set(asAna).expect(200);
    expect(status.body.data).toMatchObject({ clockedIn: false, canCheckIn: true });
  });

  it('funciona con la entrada marcada y no la cierra', async () => {
    const { app, asAna } = await setup();
    await request(app).post(api('/me/clock-in')).set(asAna).send(CLOCK_IN_LOCATION).expect(201);
    await checkIn(app, asAna).expect(201);
    const status = await request(app).get(api('/me/clock-status')).set(asAna).expect(200);
    expect(status.body.data.clockedIn).toBe(true);
  });

  it('guarda si cayó dentro o fuera de la zona, sin bloquear aunque la empresa exija zonas', async () => {
    const { app, asAdmin, asAna } = await setup();
    const site = (
      await request(app)
        .post(api('/company/work-sites'))
        .set(asAdmin)
        .send({
          name: 'Cliente Pérez',
          latitude: CLOCK_IN_LOCATION.latitude,
          longitude: CLOCK_IN_LOCATION.longitude,
          radiusMeters: 100,
        })
        .expect(201)
    ).body.data;
    await request(app)
      .patch(api('/company'))
      .set(asAdmin)
      .send({ enforceWorkSites: true })
      .expect(200);

    const inside = await checkIn(app, asAna, metersNorth(50)).expect(201);
    expect(inside.body.data.zone).toMatchObject({
      status: 'inside',
      site: { id: site.id, name: 'Cliente Pérez' },
    });
    const outside = await checkIn(app, asAna, metersNorth(2000)).expect(201);
    expect(outside.body.data.zone).toMatchObject({ status: 'outside', distanceMeters: 2000 });
  });

  it('sin el permiso de la empresa responde 409 y el estado lo avisa', async () => {
    const { app, asAna } = await setup({ allowCheckIns: false });
    const res = await checkIn(app, asAna).expect(409);
    expect(res.body.error.code).toBe('CHECK_INS_DISABLED');
    const status = await request(app).get(api('/me/clock-status')).set(asAna).expect(200);
    expect(status.body.data.canCheckIn).toBe(false);
    expect(await prisma.checkIn.count()).toBe(0);
  });

  it('exige ubicación válida y una nota de hasta 200 caracteres', async () => {
    const { app, asAna } = await setup();
    expect((await checkIn(app, asAna, {}).expect(400)).body.error.code).toBe('LOCATION_REQUIRED');
    expect(
      (await checkIn(app, asAna, { ...CLOCK_IN_LOCATION, latitude: 91 }).expect(400)).body.error
        .code,
    ).toBe('INVALID_LOCATION');
    await checkIn(app, asAna, { ...CLOCK_IN_LOCATION, note: 'a'.repeat(201) }).expect(400);
    await checkIn(app, asAna, { ...CLOCK_IN_LOCATION, extra: 1 }).expect(400);
    const blank = await checkIn(app, asAna, { ...CLOCK_IN_LOCATION, note: '   ' }).expect(201);
    expect(blank.body.data.note).toBeNull();
  });

  it('no pasa de 50 por día, contando los anulados', async () => {
    const { app, clock, asAdmin, asAna, company, employee } = await setup();
    await seedCheckIns(company.id, employee.id, workDateOf(clock), 49);
    const last = await checkIn(app, asAna).expect(201);
    await voidCheckIn(app, asAdmin, last.body.data.id).expect(200);
    const res = await checkIn(app, asAna).expect(409);
    expect(res.body.error).toMatchObject({
      code: 'CHECK_IN_LIMIT_REACHED',
      details: { perDay: 50 },
    });
  });

  it('dos registros a la vez no pasan del tope', async () => {
    const { app, clock, asAna, company, employee } = await setup();
    await seedCheckIns(company.id, employee.id, workDateOf(clock), 49);
    const results = await Promise.all([checkIn(app, asAna), checkIn(app, asAna)]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await prisma.checkIn.count()).toBe(50);
  });

  it('un admin no puede registrar llegadas propias', async () => {
    const { app, asAdmin } = await setup();
    await checkIn(app, asAdmin).expect(403);
  });
});

describe('GET /me/check-ins', () => {
  it('lista solo los propios y sin los anulados', async () => {
    const { app, company, asAdmin, asAna } = await setup();
    const { user: other } = await createEmployee(prisma, company.id, { firstName: 'Beto' });
    const asBeto = bearer((await login(app, other.email, DEFAULT_PASSWORD)).accessToken);
    const mine = (await checkIn(app, asAna, { ...CLOCK_IN_LOCATION, note: 'mío' })).body.data;
    const voided = (await checkIn(app, asAna)).body.data;
    await checkIn(app, asBeto).expect(201);
    await voidCheckIn(app, asAdmin, voided.id).expect(200);

    const res = await request(app).get(api('/me/check-ins')).set(asAna).expect(200);
    expect((res.body.data as { id: string }[]).map((item) => item.id)).toEqual([mine.id]);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('GET /company/check-ins', () => {
  it('lista los de la empresa con empleado, zona y nota, y filtra', async () => {
    const { app, company, asAdmin, asAna } = await setup();
    const { user: other, employee: beto } = await createEmployee(prisma, company.id, {
      firstName: 'Beto',
    });
    const asBeto = bearer((await login(app, other.email, DEFAULT_PASSWORD)).accessToken);
    await request(app)
      .post(api('/company/work-sites'))
      .set(asAdmin)
      .send({
        name: 'Oficina',
        latitude: CLOCK_IN_LOCATION.latitude,
        longitude: CLOCK_IN_LOCATION.longitude,
        radiusMeters: 100,
      })
      .expect(201);
    await checkIn(app, asAna, { ...metersNorth(10), note: 'Dentro' }).expect(201);
    await checkIn(app, asBeto, metersNorth(5000)).expect(201);

    const all = await companyCheckIns(app, asAdmin).expect(200);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data[0]).toMatchObject({
      employee: { id: beto.id, firstName: 'Beto' },
      status: 'active',
      zone: { status: 'outside' },
      voidedAt: null,
    });

    const outside = await companyCheckIns(app, asAdmin, '?location=outside').expect(200);
    expect(outside.body.data).toHaveLength(1);
    const byEmployee = await companyCheckIns(app, asAdmin, `?employeeId=${beto.id}`).expect(200);
    expect(byEmployee.body.data).toHaveLength(1);
  });

  it('no mezcla empresas: un check-in de otra empresa no se ve ni se anula', async () => {
    const { app, asAdmin } = await setup();
    const other = await createCompany(prisma, { name: 'Beta' });
    await prisma.company.update({ where: { id: other.id }, data: { allowCheckIns: true } });
    const { user } = await createEmployee(prisma, other.id);
    const asOther = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
    const foreign = (await checkIn(app, asOther).expect(201)).body.data;
    const { employee: foreignEmployee } = await prisma.checkIn.findUniqueOrThrow({
      where: { id: foreign.id },
      select: { employee: { select: { id: true } } },
    });

    expect((await companyCheckIns(app, asAdmin).expect(200)).body.data).toHaveLength(0);
    const res = await voidCheckIn(app, asAdmin, foreign.id).expect(404);
    expect(res.body.error.code).toBe('CHECK_IN_NOT_FOUND');
    await companyCheckIns(app, asAdmin, `?employeeId=${foreignEmployee.id}`).expect(404);
  });

  it('el empleado no puede ver los de la empresa ni anular', async () => {
    const { app, asAna } = await setup();
    const own = (await checkIn(app, asAna).expect(201)).body.data;
    await companyCheckIns(app, asAna).expect(403);
    await voidCheckIn(app, asAna, own.id).expect(403);
  });
});

describe('POST /company/check-ins/{id}/void', () => {
  it('anula sin borrar, guarda quién y por qué y deja la actividad', async () => {
    const { app, admin, asAdmin, asAna } = await setup();
    const created = (await checkIn(app, asAna).expect(201)).body.data;

    const res = await voidCheckIn(app, asAdmin, created.id, 'Era otro cliente').expect(200);
    expect(res.body.data).toMatchObject({
      status: 'voided',
      voidReason: 'Era otro cliente',
      voidedBy: { id: admin.id },
    });
    expect(await prisma.checkIn.count()).toBe(1);
    expect((await companyCheckIns(app, asAdmin).expect(200)).body.data).toHaveLength(0);
    expect(
      (await companyCheckIns(app, asAdmin, '?status=voided').expect(200)).body.data,
    ).toHaveLength(1);

    const again = await voidCheckIn(app, asAdmin, created.id).expect(409);
    expect(again.body.error.code).toBe('CHECK_IN_VOIDED');
    await voidCheckIn(app, asAdmin, created.id, 'no').expect(400);

    const activity = await request(app).get(api('/company/activity')).set(asAdmin).expect(200);
    expect(activity.body.data[0]).toMatchObject({
      type: 'check_in.voided_by_admin',
      employee: { firstName: 'Ana' },
      details: { checkInId: created.id, reason: 'Era otro cliente' },
    });
  });

  it('un admin multiempresa también puede anular en su empresa activa', async () => {
    const { app, company, asAna } = await setup();
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id] });
    const session = await login(app, laura.email, DEFAULT_PASSWORD);
    const asLaura = bearer((await switchCompany(app, session, company.id)).accessToken);
    const created = (await checkIn(app, asAna).expect(201)).body.data;
    const res = await voidCheckIn(app, asLaura, created.id).expect(200);
    expect(res.body.data.voidedBy).toMatchObject({ id: laura.id });
  });

  it('la base de datos no deja borrar ni cambiar lo registrado', async () => {
    const { app, asAna } = await setup();
    const created = (await checkIn(app, asAna).expect(201)).body.data;
    await expect(prisma.checkIn.delete({ where: { id: created.id } })).rejects.toThrow();
    await expect(
      prisma.checkIn.update({ where: { id: created.id }, data: { note: 'cambiada' } }),
    ).rejects.toThrow();
  });
});

describe('permiso por empleado', () => {
  const setCheckIns = (app: Express, auth: Auth, employeeId: string, value: boolean | null) =>
    request(app)
      .patch(api(`/company/employees/${employeeId}`))
      .set(auth)
      .send({ allowCheckIns: value });

  it('sin ajuste propio hereda el de la empresa', async () => {
    const { app, asAdmin, employee } = await setup({ allowCheckIns: false });
    const view = await request(app)
      .get(api(`/company/employees/${employee.id}`))
      .set(asAdmin)
      .expect(200);
    expect(view.body.data).toMatchObject({ allowCheckIns: null, effectiveAllowCheckIns: false });
    await request(app)
      .patch(api('/company'))
      .set(asAdmin)
      .send({ allowCheckIns: true })
      .expect(200);
    const after = await request(app)
      .get(api(`/company/employees/${employee.id}`))
      .set(asAdmin)
      .expect(200);
    expect(after.body.data).toMatchObject({ allowCheckIns: null, effectiveAllowCheckIns: true });
  });

  it('permitido: lo tiene aunque la empresa lo tenga apagado', async () => {
    const { app, asAdmin, asAna, employee } = await setup({ allowCheckIns: false });
    await checkIn(app, asAna).expect(409);
    const res = await setCheckIns(app, asAdmin, employee.id, true).expect(200);
    expect(res.body.data).toMatchObject({ allowCheckIns: true, effectiveAllowCheckIns: true });
    await checkIn(app, asAna).expect(201);
    const status = await request(app).get(api('/me/clock-status')).set(asAna).expect(200);
    expect(status.body.data.canCheckIn).toBe(true);
  });

  it('no permitido: no lo tiene aunque la empresa lo tenga encendido, pero conserva su historial', async () => {
    const { app, asAdmin, asAna, employee } = await setup();
    await checkIn(app, asAna).expect(201);
    const res = await setCheckIns(app, asAdmin, employee.id, false).expect(200);
    expect(res.body.data).toMatchObject({ allowCheckIns: false, effectiveAllowCheckIns: false });

    const denied = await checkIn(app, asAna).expect(409);
    expect(denied.body.error.code).toBe('CHECK_INS_DISABLED');
    const status = await request(app).get(api('/me/clock-status')).set(asAna).expect(200);
    expect(status.body.data.canCheckIn).toBe(false);
    expect(
      (await request(app).get(api('/me/check-ins')).set(asAna).expect(200)).body.data,
    ).toHaveLength(1);
    expect((await companyCheckIns(app, asAdmin).expect(200)).body.data).toHaveLength(1);
  });

  it('null vuelve a heredar y el cambio queda auditado', async () => {
    const { app, asAdmin, asAna, employee } = await setup();
    await setCheckIns(app, asAdmin, employee.id, false).expect(200);
    await checkIn(app, asAna).expect(409);
    const back = await setCheckIns(app, asAdmin, employee.id, null).expect(200);
    expect(back.body.data).toMatchObject({ allowCheckIns: null, effectiveAllowCheckIns: true });
    await checkIn(app, asAna).expect(201);

    const events = await prisma.securityEvent.findMany({ where: { type: 'employee.updated' } });
    expect(events.map((event) => event.metadata)).toEqual(
      expect.arrayContaining([expect.objectContaining({ fields: ['allowCheckIns'] })]),
    );
  });

  it('rechaza un valor que no sea booleano ni null y no toca empleados de otra empresa', async () => {
    const { app, asAdmin, employee } = await setup();
    await request(app)
      .patch(api(`/company/employees/${employee.id}`))
      .set(asAdmin)
      .send({ allowCheckIns: 'si' })
      .expect(400);

    const other = await createCompany(prisma, { name: 'Beta' });
    const { employee: foreign } = await createEmployee(prisma, other.id);
    await setCheckIns(app, asAdmin, foreign.id, true).expect(404);
    expect(
      (await prisma.employee.findUniqueOrThrow({ where: { id: foreign.id } })).allowCheckIns,
    ).toBeNull();
  });

  it('el empleado no puede cambiarse el permiso', async () => {
    const { app, asAna, employee } = await setup({ allowCheckIns: false });
    await setCheckIns(app, asAna, employee.id, true).expect(403);
  });
});

describe('ajuste de la empresa y borrado de empleados', () => {
  it('el admin activa y desactiva el registro de llegadas', async () => {
    const { app, asAdmin, asAna } = await setup({ allowCheckIns: false });
    const on = await request(app).patch(api('/company')).set(asAdmin).send({ allowCheckIns: true });
    expect(on.status).toBe(200);
    expect(on.body.data.allowCheckIns).toBe(true);
    await checkIn(app, asAna).expect(201);
    await request(app)
      .patch(api('/company'))
      .set(asAdmin)
      .send({ allowCheckIns: false })
      .expect(200);
    await checkIn(app, asAna).expect(409);
  });

  it('un empleado con check-ins ya no se puede eliminar', async () => {
    const { app, asAdmin, asAna, employee } = await setup();
    await checkIn(app, asAna).expect(201);
    const res = await request(app)
      .delete(api(`/company/employees/${employee.id}`))
      .set(asAdmin)
      .expect(409);
    expect(res.body.error.code).toBe('EMPLOYEE_HAS_HISTORY');
  });
});
