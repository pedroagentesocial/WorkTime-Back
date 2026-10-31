import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import {
  CLOCK_IN_LOCATION,
  createCompany,
  createEmployee,
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

// Un grado de latitud son unos 111 km: sirve para poner un punto a una distancia conocida
const metersNorth = (meters: number, accuracyMeters = 5) => ({
  latitude: CLOCK_IN_LOCATION.latitude + meters / 111_195,
  longitude: CLOCK_IN_LOCATION.longitude,
  accuracyMeters,
});

const DAY = 86_400_000;

const OFFICE = {
  name: 'Oficina',
  latitude: CLOCK_IN_LOCATION.latitude,
  longitude: CLOCK_IN_LOCATION.longitude,
  radiusMeters: 150,
};

async function setup() {
  const { app, clock } = createTestApp();
  const company = await createCompany(prisma, { name: 'Alfa' });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asAna = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, clock, company, employee, asAdmin, asAna };
}

const createSite = (app: Express, auth: Record<string, string>, body: object = OFFICE) =>
  request(app).post(api('/company/work-sites')).set(auth).send(body);

const clockIn = (app: Express, auth: Record<string, string>, location: object) =>
  request(app).post(api('/me/clock-in')).set(auth).send(location);

const enforce = (app: Express, auth: Record<string, string>, value: boolean) =>
  request(app).patch(api('/company')).set(auth).send({ enforceWorkSites: value });

describe('gestión de zonas de trabajo', () => {
  it('el admin crea, lista, edita y desactiva zonas', async () => {
    const { app, asAdmin } = await setup();

    const created = await createSite(app, asAdmin).expect(201);
    expect(created.body.data).toMatchObject({ name: 'Oficina', radiusMeters: 150, active: true });

    const id = created.body.data.id;
    const edited = await request(app)
      .patch(api(`/company/work-sites/${id}`))
      .set(asAdmin)
      .send({ name: 'Matriz', radiusMeters: 200 })
      .expect(200);
    expect(edited.body.data).toMatchObject({ name: 'Matriz', radiusMeters: 200 });

    await request(app)
      .patch(api(`/company/work-sites/${id}`))
      .set(asAdmin)
      .send({ active: false })
      .expect(200);

    const list = await request(app).get(api('/company/work-sites')).set(asAdmin).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].active).toBe(false);

    const events = await prisma.securityEvent.findMany({
      where: { type: { in: ['work_site.created', 'work_site.updated'] } },
    });
    expect(events).toHaveLength(3);
  });

  it('acepta radios de hasta 60 km', async () => {
    const { app, asAdmin } = await setup();
    const res = await createSite(app, asAdmin, { ...OFFICE, radiusMeters: 60000 }).expect(201);
    expect(res.body.data.radiusMeters).toBe(60000);
  });

  it('valida coordenadas, radio, nombre y campos de más', async () => {
    const { app, asAdmin } = await setup();
    for (const bad of [
      { ...OFFICE, latitude: 91 },
      { ...OFFICE, longitude: -181 },
      { ...OFFICE, radiusMeters: 9 },
      { ...OFFICE, radiusMeters: 60001 },
      { ...OFFICE, radiusMeters: 10.5 },
      { ...OFFICE, name: '   ' },
      { ...OFFICE, extra: 1 },
    ]) {
      await createSite(app, asAdmin, bad).expect(400);
    }
    expect(await prisma.workSite.count()).toBe(0);
  });

  it('el empleado no puede ver ni gestionar zonas', async () => {
    const { app, asAna } = await setup();
    await request(app).get(api('/company/work-sites')).set(asAna).expect(403);
    await createSite(app, asAna).expect(403);
  });

  it('una zona de otra empresa responde 404 y no se toca', async () => {
    const { app, asAdmin } = await setup();
    const other = await createCompany(prisma, { name: 'Beta' });
    const otherAdmin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: other.id });
    const asOther = bearer((await login(app, otherAdmin.email, DEFAULT_PASSWORD)).accessToken);
    const site = (await createSite(app, asOther).expect(201)).body.data;

    await request(app)
      .patch(api(`/company/work-sites/${site.id}`))
      .set(asAdmin)
      .send({ active: false })
      .expect(404);
    const mine = await request(app).get(api('/company/work-sites')).set(asAdmin).expect(200);
    expect(mine.body.data).toEqual([]);
    expect((await prisma.workSite.findUniqueOrThrow({ where: { id: site.id } })).active).toBe(true);
  });

  it('limita las zonas por empresa', async () => {
    const { app, asAdmin, company } = await setup();
    await prisma.workSite.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        companyId: company.id,
        name: `Zona ${i}`,
        latitude: 40,
        longitude: -111,
        radiusM: 100,
      })),
    });
    const res = await createSite(app, asAdmin).expect(409);
    expect(res.body.error.code).toBe('WORK_SITE_LIMIT');
  });
});

describe('exigir marcar dentro de una zona', () => {
  it('no se puede exigir sin zonas activas ni desactivar la última con la exigencia encendida', async () => {
    const { app, asAdmin } = await setup();

    const none = await enforce(app, asAdmin, true).expect(409);
    expect(none.body.error.code).toBe('WORK_SITES_REQUIRED');

    const site = (await createSite(app, asAdmin).expect(201)).body.data;
    const on = await enforce(app, asAdmin, true).expect(200);
    expect(on.body.data.enforceWorkSites).toBe(true);

    const res = await request(app)
      .patch(api(`/company/work-sites/${site.id}`))
      .set(asAdmin)
      .send({ active: false })
      .expect(409);
    expect(res.body.error.code).toBe('WORK_SITES_REQUIRED');

    await enforce(app, asAdmin, false).expect(200);
    await request(app)
      .patch(api(`/company/work-sites/${site.id}`))
      .set(asAdmin)
      .send({ active: false })
      .expect(200);
  });
});

describe('POST /me/clock-in con zonas', () => {
  it('sin zonas no hay evaluación', async () => {
    const { app, asAna } = await setup();
    const res = await clockIn(app, asAna, metersNorth(5000)).expect(201);
    expect(res.body.data.clockInZone).toBeNull();
  });

  it('dentro de una zona guarda inside con la zona y la distancia', async () => {
    const { app, asAdmin, asAna } = await setup();
    const site = (await createSite(app, asAdmin).expect(201)).body.data;

    const res = await clockIn(app, asAna, metersNorth(80)).expect(201);
    expect(res.body.data.clockInZone).toMatchObject({
      status: 'inside',
      site: { id: site.id, name: 'Oficina' },
    });
    const [stored] = await prisma.timeEntry.findMany();
    expect(stored).toMatchObject({ clockInZone: 'inside', clockInSiteId: site.id });
  });

  it('fuera de la zona sin exigencia marca igual pero queda como outside', async () => {
    const { app, asAdmin, asAna } = await setup();
    await createSite(app, asAdmin).expect(201);

    const res = await clockIn(app, asAna, metersNorth(900)).expect(201);
    expect(res.body.data.clockInZone.status).toBe('outside');
  });

  it('con exigencia, fuera de la zona responde 409 y no deja entrada', async () => {
    const { app, asAdmin, asAna } = await setup();
    await createSite(app, asAdmin).expect(201);
    await enforce(app, asAdmin, true).expect(200);

    const res = await clockIn(app, asAna, metersNorth(900)).expect(409);
    expect(res.body.error.code).toBe('OUTSIDE_WORK_AREA');
    expect(res.body.error.details).toMatchObject({ siteName: 'Oficina' });
    expect(await prisma.timeEntry.count()).toBe(0);

    await clockIn(app, asAna, metersNorth(50)).expect(201);
  });

  it('la imprecisión del dispositivo juega a favor', async () => {
    const { app, asAdmin, asAna } = await setup();
    await createSite(app, asAdmin).expect(201);
    await enforce(app, asAdmin, true).expect(200);

    await clockIn(app, asAna, metersNorth(200, 80)).expect(201);
  });

  it('las zonas inactivas no cuentan y las de otra empresa tampoco', async () => {
    const { app, asAdmin, asAna } = await setup();
    const other = await createCompany(prisma, { name: 'Beta' });
    await prisma.workSite.create({
      data: {
        companyId: other.id,
        name: 'Ajena',
        latitude: CLOCK_IN_LOCATION.latitude,
        longitude: CLOCK_IN_LOCATION.longitude,
        radiusM: 500,
      },
    });
    const site = (await createSite(app, asAdmin).expect(201)).body.data;
    await request(app)
      .patch(api(`/company/work-sites/${site.id}`))
      .set(asAdmin)
      .send({ active: false })
      .expect(200);

    const res = await clockIn(app, asAna, metersNorth(900)).expect(201);
    expect(res.body.data.clockInZone).toBeNull();
  });

  it('el marcaje conserva la zona aunque luego se edite o desactive', async () => {
    const { app, asAdmin, asAna } = await setup();
    const site = (await createSite(app, asAdmin).expect(201)).body.data;
    await clockIn(app, asAna, metersNorth(10)).expect(201);

    await request(app)
      .patch(api(`/company/work-sites/${site.id}`))
      .set(asAdmin)
      .send({ name: 'Otra', active: false })
      .expect(200);

    const list = await request(app).get(api('/company/time-entries')).set(asAdmin).expect(200);
    expect(list.body.data[0].clockInZone.status).toBe('inside');
  });
});

describe('filtro de ubicación en los marcajes', () => {
  it('without y outside acotan el listado', async () => {
    const { app, clock, asAdmin, asAna, employee } = await setup();
    await createSite(app, asAdmin).expect(201);
    await clockIn(app, asAna, metersNorth(900)).expect(201);
    await request(app).post(api('/me/clock-out')).set(asAna).send({}).expect(200);
    await request(app)
      .post(api(`/company/employees/${employee.id}/time-entries`))
      .set(asAdmin)
      .send({
        clockInAt: new Date(clock.now().getTime() - 3 * DAY).toISOString(),
        clockOutAt: new Date(clock.now().getTime() - 3 * DAY + 3_600_000).toISOString(),
        reason: 'Olvidó marcar',
      })
      .expect(201);

    const all = await request(app).get(api('/company/time-entries')).set(asAdmin).expect(200);
    expect(all.body.data).toHaveLength(2);

    const outside = await request(app)
      .get(api('/company/time-entries?location=outside'))
      .set(asAdmin)
      .expect(200);
    expect(outside.body.data).toHaveLength(1);
    expect(outside.body.data[0].clockInZone.status).toBe('outside');

    const without = await request(app)
      .get(api('/company/time-entries?location=without'))
      .set(asAdmin)
      .expect(200);
    expect(without.body.data).toHaveLength(1);
    expect(without.body.data[0].clockInLocation).toBeNull();

    await request(app).get(api('/company/time-entries?location=nope')).set(asAdmin).expect(400);
  });
});
