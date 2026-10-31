import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
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
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

async function setup() {
  const { app, clock } = createTestApp();
  const company = await createCompany(prisma, { name: 'Alfa' });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asAna = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, clock, company, employee, asAdmin, asAna };
}

const clockIn = (app: Express, auth: Record<string, string>, body?: object) => {
  const req = request(app).post(api('/me/clock-in')).set(auth);
  return body ? req.send(body) : req;
};

const storedEntries = () => prisma.timeEntry.findMany();

describe('POST /me/clock-in: la ubicación es obligatoria', () => {
  it('guarda donde marcó y lo devuelve en la respuesta', async () => {
    const { app, asAna } = await setup();

    const res = await clockIn(app, asAna, CLOCK_IN_LOCATION).expect(201);
    expect(res.body.data.clockInLocation).toEqual(CLOCK_IN_LOCATION);

    const [stored] = await storedEntries();
    expect(stored).toMatchObject({
      clockInLatitude: CLOCK_IN_LOCATION.latitude,
      clockInLongitude: CLOCK_IN_LOCATION.longitude,
      clockInAccuracyM: CLOCK_IN_LOCATION.accuracyMeters,
    });
  });

  it('sin ubicación no se marca y no queda ninguna entrada', async () => {
    const { app, asAna } = await setup();

    for (const body of [
      undefined,
      {},
      { latitude: 40.7 },
      { latitude: 40.7, longitude: -111.8 },
      { longitude: -111.8, accuracyMeters: 10 },
    ]) {
      const res = await clockIn(app, asAna, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('LOCATION_REQUIRED');
      expect(res.body.error.message).toContain('ubicación');
    }
    expect(await storedEntries()).toHaveLength(0);
  });

  it('rechaza coordenadas fuera de rango, precisión negativa y campos de más', async () => {
    const { app, asAna } = await setup();

    for (const bad of [
      { ...CLOCK_IN_LOCATION, latitude: 91 },
      { ...CLOCK_IN_LOCATION, longitude: -181 },
      { ...CLOCK_IN_LOCATION, accuracyMeters: -1 },
      { ...CLOCK_IN_LOCATION, accuracyMeters: 100_001 },
    ]) {
      const res = await clockIn(app, asAna, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error.code).toBe('INVALID_LOCATION');
    }

    const extra = await clockIn(app, asAna, { ...CLOCK_IN_LOCATION, address: 'x' });
    expect(extra.status).toBe(400);
    const text = await clockIn(app, asAna, { ...CLOCK_IN_LOCATION, latitude: '40.7' });
    expect(text.status).toBe(400);
    expect(await storedEntries()).toHaveLength(0);
  });

  it('una precisión baja no impide marcar, solo se guarda', async () => {
    const { app, asAna } = await setup();
    const res = await clockIn(app, asAna, { ...CLOCK_IN_LOCATION, accuracyMeters: 5000 }).expect(
      201,
    );
    expect(res.body.data.clockInLocation.accuracyMeters).toBe(5000);
  });

  it('la salida no pide ubicación y no cambia la de la entrada', async () => {
    const { app, asAna } = await setup();
    await clockIn(app, asAna, CLOCK_IN_LOCATION).expect(201);

    const out = await request(app).post(api('/me/clock-out')).set(asAna).expect(200);
    expect(out.body.data.clockInLocation).toEqual(CLOCK_IN_LOCATION);
    const [stored] = await storedEntries();
    expect(stored?.clockOutAt).not.toBeNull();
    expect(stored?.clockInLatitude).toBe(CLOCK_IN_LOCATION.latitude);
  });

  it('el empleado ve sus propios puntos y el admin los de su empresa', async () => {
    const { app, asAna, asAdmin } = await setup();
    await clockIn(app, asAna, CLOCK_IN_LOCATION).expect(201);

    const mine = await request(app).get(api('/me/time-entries')).set(asAna).expect(200);
    expect(mine.body.data[0].clockInLocation).toEqual(CLOCK_IN_LOCATION);

    const company = await request(app).get(api('/company/time-entries')).set(asAdmin).expect(200);
    expect(company.body.data[0].clockInLocation).toEqual(CLOCK_IN_LOCATION);

    const status = await request(app).get(api('/me/clock-status')).set(asAna).expect(200);
    expect(status.body.data.openEntry.clockInLocation).toEqual(CLOCK_IN_LOCATION);
  });

  it('la asistencia en vivo del admin trae el punto de quien está IN', async () => {
    const { app, asAna, asAdmin } = await setup();
    await clockIn(app, asAna, CLOCK_IN_LOCATION).expect(201);

    const roster = await request(app)
      .get(api('/company/attendance/roster'))
      .set(asAdmin)
      .expect(200);
    const row = (roster.body.data as { status: string; clockedInLocation: unknown }[]).find(
      (item) => item.status === 'in',
    );
    expect(row?.clockedInLocation).toEqual(CLOCK_IN_LOCATION);
  });
});

describe('Registros hechos por un admin', () => {
  it('marcar entrada por un empleado no lleva ubicación', async () => {
    const { app, employee, asAdmin } = await setup();

    const res = await request(app)
      .post(api(`/company/employees/${employee.id}/clock-in`))
      .set(asAdmin)
      .send({})
      .expect(201);
    expect(res.body.data.clockInLocation).toBeNull();
    const [stored] = await storedEntries();
    expect(stored?.clockInLatitude).toBeNull();
  });

  it('un registro manual tampoco lleva ubicación', async () => {
    const { app, clock, employee, asAdmin } = await setup();
    const out = new Date(clock.now().getTime() - 3_600_000);
    const inn = new Date(out.getTime() - 4 * 3_600_000);

    const res = await request(app)
      .post(api(`/company/employees/${employee.id}/time-entries`))
      .set(asAdmin)
      .send({
        clockInAt: inn.toISOString(),
        clockOutAt: out.toISOString(),
        reason: 'Olvidó marcar',
      })
      .expect(201);
    expect(res.body.data.clockInLocation).toBeNull();
  });
});

describe('La base de datos cuida la ubicación', () => {
  async function insertEntry(location: Record<string, number | null>) {
    const company = await createCompany(prisma);
    const { employee } = await createEmployee(prisma, company.id);
    return prisma.timeEntry.create({
      data: {
        id: uuidv7(),
        companyId: company.id,
        employeeId: employee.id,
        clockInAt: new Date('2026-06-01T14:00:00Z'),
        timezone: 'America/Denver',
        workDate: new Date('2026-06-01T00:00:00Z'),
        source: 'web',
        ...location,
      },
    });
  }

  async function expectRejected(operation: Promise<unknown>) {
    const error: unknown = await operation.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).toContain(
      'time_entries_clock_in_location_valid',
    );
  }

  it('las tres columnas van juntas o ninguna', async () => {
    await expectRejected(insertEntry({ clockInLatitude: 40.7 }));
    await expectRejected(insertEntry({ clockInLatitude: 40.7, clockInLongitude: -111.8 }));
    await insertEntry({});
  });

  it('rechaza valores fuera de rango aunque la app tenga un bug', async () => {
    await expectRejected(
      insertEntry({ clockInLatitude: 95, clockInLongitude: 0, clockInAccuracyM: 5 }),
    );
    await expectRejected(
      insertEntry({ clockInLatitude: 0, clockInLongitude: 200, clockInAccuracyM: 5 }),
    );
    await expectRejected(
      insertEntry({ clockInLatitude: 0, clockInLongitude: 0, clockInAccuracyM: -3 }),
    );
  });
});

describe('GET /portfolio/attendance/live', () => {
  async function portfolio() {
    const { app, clock } = createTestApp();
    const alfa = await createCompany(prisma, { name: 'Alfa' });
    const beta = await createCompany(prisma, { name: 'Beta' });
    const foreign = await createCompany(prisma, { name: 'Ajena' });
    // Se suspende despues de marcar: una empresa suspendida no deja iniciar sesion
    const suspended = await createCompany(prisma, { name: 'Suspendida' });
    const people = {
      ana: await createEmployee(prisma, alfa.id, { firstName: 'Ana' }),
      beto: await createEmployee(prisma, beta.id, { firstName: 'Beto' }),
      ajeno: await createEmployee(prisma, foreign.id, { firstName: 'Ajeno' }),
      susp: await createEmployee(prisma, suspended.id, { firstName: 'Susp' }),
      libre: await createEmployee(prisma, alfa.id, { firstName: 'Libre' }),
    };
    const laura = await createMultiAdmin(prisma, { companyIds: [alfa.id, beta.id, suspended.id] });
    const session = await login(app, laura.email, DEFAULT_PASSWORD);
    const auth = bearer(session.accessToken);

    const clock_in = async (user: { email: string }, location: object) => {
      const s = await login(app, user.email, DEFAULT_PASSWORD);
      await clockIn(app, bearer(s.accessToken), location).expect(201);
    };
    await clock_in(people.ana.user, { ...CLOCK_IN_LOCATION, latitude: 40.1 });
    await clock_in(people.beto.user, { ...CLOCK_IN_LOCATION, latitude: 41.2 });
    await clock_in(people.ajeno.user, CLOCK_IN_LOCATION);
    await clock_in(people.susp.user, CLOCK_IN_LOCATION);
    await prisma.company.update({ where: { id: suspended.id }, data: { status: 'suspended' } });
    return { app, clock, alfa, beta, foreign, suspended, laura, auth };
  }

  it('lista a quienes están IN de sus empresas activas, con su empresa y su punto', async () => {
    const { app, auth, alfa, beta } = await portfolio();

    const res = await request(app).get(api('/portfolio/attendance/live')).set(auth).expect(200);
    const entries = res.body.data.entries as {
      company: { id: string; name: string };
      employee: { firstName: string };
      clockInLocation: { latitude: number } | null;
    }[];

    expect(res.body.data.working).toBe(2);
    expect(
      entries.map((e) => [e.company.name, e.employee.firstName, e.clockInLocation?.latitude]),
    ).toEqual([
      ['Alfa', 'Ana', 40.1],
      ['Beta', 'Beto', 41.2],
    ]);
    expect(entries.map((e) => e.company.id)).toEqual([alfa.id, beta.id]);
  });

  it('nunca muestra a empleados de empresas ajenas ni suspendidas', async () => {
    const { app, auth } = await portfolio();
    const res = await request(app).get(api('/portfolio/attendance/live')).set(auth).expect(200);
    const names = (res.body.data.entries as { employee: { firstName: string } }[]).map(
      (e) => e.employee.firstName,
    );
    expect(names).not.toContain('Ajeno');
    expect(names).not.toContain('Susp');
    expect(names).not.toContain('Libre');
  });

  it('se puede acotar a una empresa y una ajena responde 404', async () => {
    const { app, auth, beta, foreign } = await portfolio();

    const one = await request(app)
      .get(api(`/portfolio/attendance/live?companyId=${beta.id}`))
      .set(auth)
      .expect(200);
    expect(one.body.data.working).toBe(1);

    const res = await request(app)
      .get(api(`/portfolio/attendance/live?companyId=${foreign.id}`))
      .set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMPANY_NOT_FOUND');
  });

  it('una entrada registrada por un admin aparece sin punto', async () => {
    const { app, auth, alfa } = await portfolio();
    const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: alfa.id });
    const { employee } = await createEmployee(prisma, alfa.id, { firstName: 'Manual' });
    const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
    await request(app)
      .post(api(`/company/employees/${employee.id}/clock-in`))
      .set(asAdmin)
      .send({})
      .expect(201);

    const res = await request(app).get(api('/portfolio/attendance/live')).set(auth).expect(200);
    const manual = (
      res.body.data.entries as { employee: { firstName: string }; clockInLocation: unknown }[]
    ).find((e) => e.employee.firstName === 'Manual');
    expect(manual?.clockInLocation).toBeNull();
  });

  it('solo el admin multiempresa puede usarla', async () => {
    const { app, alfa } = await portfolio();
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: alfa.id,
    });
    const platform = await createUser(prisma, { role: Role.PLATFORM_ADMIN });

    for (const user of [companyAdmin, platform]) {
      const session = await login(app, user.email, DEFAULT_PASSWORD);
      const res = await request(app)
        .get(api('/portfolio/attendance/live'))
        .set(bearer(session.accessToken));
      expect(res.status).toBe(403);
    }
  });
});
