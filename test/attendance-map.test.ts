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

interface EntryOptions {
  date: string;
  withLocation?: boolean;
  voided?: boolean;
  open?: boolean;
  zone?: 'inside' | 'outside';
}

async function addEntry(companyId: string, employeeId: string, options: EntryOptions) {
  const { date, withLocation = true, voided = false, open = false } = options;
  const site =
    options.zone &&
    (await prisma.workSite.create({
      data: {
        companyId,
        name: 'Oficina',
        latitude: CLOCK_IN_LOCATION.latitude,
        longitude: CLOCK_IN_LOCATION.longitude,
        radiusM: 100,
      },
    }));
  // Ya hay un company_admin por empresa: se usa como quien anula
  const admin = voided
    ? await prisma.user.findFirst({ where: { companyId, role: Role.COMPANY_ADMIN } })
    : null;
  return prisma.timeEntry.create({
    data: {
      id: uuidv7(),
      companyId,
      employeeId,
      clockInAt: new Date(`${date}T15:00:00Z`),
      clockOutAt: open ? null : new Date(`${date}T23:00:00Z`),
      timezone: 'America/Denver',
      workDate: new Date(`${date}T00:00:00.000Z`),
      source: 'web',
      ...(withLocation && {
        clockInLatitude: CLOCK_IN_LOCATION.latitude,
        clockInLongitude: CLOCK_IN_LOCATION.longitude,
        clockInAccuracyM: CLOCK_IN_LOCATION.accuracyMeters,
      }),
      ...(site && {
        clockInZone: options.zone,
        clockInSiteId: site.id,
        clockInDistanceM: options.zone === 'inside' ? 20 : 900,
      }),
      ...(admin && { voidedAt: new Date(), voidedById: admin.id, voidReason: 'Duplicado' }),
    },
  });
}

async function setup() {
  const { app } = createTestApp();
  const alfa = await createCompany(prisma, { name: 'Alfa' });
  const beta = await createCompany(prisma, { name: 'Beta' });
  const ajena = await createCompany(prisma, { name: 'Ajena' });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: alfa.id });
  const ana = await createEmployee(prisma, alfa.id, { firstName: 'Ana' });
  const luis = await createEmployee(prisma, alfa.id, { firstName: 'Luis' });
  const beto = await createEmployee(prisma, beta.id, { firstName: 'Beto' });
  const ajeno = await createEmployee(prisma, ajena.id, { firstName: 'Ajeno' });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asAna = bearer((await login(app, ana.user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, alfa, beta, ajena, ana, luis, beto, ajeno, asAdmin, asAna };
}

const get = (app: Express, auth: Record<string, string>, path: string) =>
  request(app).get(api(path)).set(auth);

describe('GET /company/attendance/map', () => {
  it('devuelve los marcajes con ubicación de la empresa, los más recientes primero', async () => {
    const { app, alfa, ana, luis, asAdmin } = await setup();
    await addEntry(alfa.id, ana.employee.id, { date: '2026-10-05' });
    await addEntry(alfa.id, luis.employee.id, { date: '2026-10-06', open: true });

    const res = await get(app, asAdmin, '/company/attendance/map').expect(200);
    expect(res.body.data.truncated).toBe(false);
    const points = res.body.data.points;
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      workDate: '2026-10-06',
      open: true,
      employee: { firstName: 'Luis' },
      company: { name: 'Alfa' },
      clockInLocation: CLOCK_IN_LOCATION,
      clockInZone: null,
    });
    expect(points[1]).toMatchObject({ workDate: '2026-10-05', open: false });
  });

  it('no incluye anulados, marcajes sin ubicación ni los de otras empresas', async () => {
    const { app, alfa, beta, ana, beto, asAdmin } = await setup();
    await addEntry(alfa.id, ana.employee.id, { date: '2026-10-05' });
    await addEntry(alfa.id, ana.employee.id, { date: '2026-10-06', voided: true });
    await addEntry(alfa.id, ana.employee.id, { date: '2026-10-07', withLocation: false });
    await addEntry(beta.id, beto.employee.id, { date: '2026-10-05' });

    const res = await get(app, asAdmin, '/company/attendance/map').expect(200);
    expect(res.body.data.points).toHaveLength(1);
    expect(res.body.data.points[0].employee.firstName).toBe('Ana');
  });

  it('incluye la zona dentro o fuera con la distancia', async () => {
    const { app, alfa, ana, asAdmin } = await setup();
    await addEntry(alfa.id, ana.employee.id, { date: '2026-10-05', zone: 'outside' });

    const res = await get(app, asAdmin, '/company/attendance/map').expect(200);
    expect(res.body.data.points[0].clockInZone).toMatchObject({
      status: 'outside',
      site: { name: 'Oficina' },
      distanceMeters: 900,
    });
  });

  it('filtra por rango de días y por empleado', async () => {
    const { app, alfa, ana, luis, asAdmin } = await setup();
    await addEntry(alfa.id, ana.employee.id, { date: '2026-10-05' });
    await addEntry(alfa.id, ana.employee.id, { date: '2026-10-08' });
    await addEntry(alfa.id, luis.employee.id, { date: '2026-10-08' });

    const range = await get(app, asAdmin, '/company/attendance/map?from=2026-10-07&to=2026-10-09');
    expect(range.body.data.points).toHaveLength(2);

    const one = await get(
      app,
      asAdmin,
      `/company/attendance/map?employeeId=${luis.employee.id}`,
    ).expect(200);
    expect(one.body.data.points).toHaveLength(1);
    expect(one.body.data.points[0].employee.firstName).toBe('Luis');
  });

  it('rechaza un rango invertido y un empleado de otra empresa', async () => {
    const { app, ajeno, asAdmin } = await setup();
    const bad = await get(app, asAdmin, '/company/attendance/map?from=2026-10-09&to=2026-10-01');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_DATE_RANGE');

    const foreign = await get(
      app,
      asAdmin,
      `/company/attendance/map?employeeId=${ajeno.employee.id}`,
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('el empleado no puede verlo', async () => {
    const { app, asAna } = await setup();
    await get(app, asAna, '/company/attendance/map').expect(403);
  });

  it('avisa cuando hay más puntos que el tope y devuelve los más recientes', async () => {
    const { app, alfa, ana, asAdmin } = await setup();
    await prisma.timeEntry.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        id: uuidv7(),
        companyId: alfa.id,
        employeeId: ana.employee.id,
        clockInAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 60_000),
        clockOutAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 30) + i * 60_000),
        timezone: 'America/Denver',
        workDate: new Date('2026-01-01T00:00:00.000Z'),
        source: 'web' as const,
        clockInLatitude: CLOCK_IN_LOCATION.latitude,
        clockInLongitude: CLOCK_IN_LOCATION.longitude,
        clockInAccuracyM: CLOCK_IN_LOCATION.accuracyMeters,
      })),
    });

    const res = await get(app, asAdmin, '/company/attendance/map').expect(200);
    expect(res.body.data.points).toHaveLength(500);
    expect(res.body.data.truncated).toBe(true);
  });
});

describe('GET /portfolio/attendance/map', () => {
  async function portfolio() {
    const base = await setup();
    const suspended = await createCompany(prisma, { name: 'Suspendida', status: 'suspended' });
    const susp = await createEmployee(prisma, suspended.id, { firstName: 'Susp' });
    await addEntry(base.alfa.id, base.ana.employee.id, { date: '2026-10-05' });
    await addEntry(base.beta.id, base.beto.employee.id, { date: '2026-10-06' });
    await addEntry(base.ajena.id, base.ajeno.employee.id, { date: '2026-10-06' });
    await addEntry(suspended.id, susp.employee.id, { date: '2026-10-06' });
    const laura = await createMultiAdmin(prisma, {
      companyIds: [base.alfa.id, base.beta.id, suspended.id],
    });
    const auth = bearer((await login(base.app, laura.email, DEFAULT_PASSWORD)).accessToken);
    return { ...base, auth };
  }

  it('reúne las empresas activas de la persona, sin las ajenas ni las suspendidas', async () => {
    const { app, auth } = await portfolio();
    const res = await get(app, auth, '/portfolio/attendance/map').expect(200);
    const names = (res.body.data.points as { company: { name: string } }[]).map(
      (point) => point.company.name,
    );
    expect(names.sort()).toEqual(['Alfa', 'Beta']);
  });

  it('se acota a una empresa suya y una ajena responde 404', async () => {
    const { app, auth, alfa, ajena } = await portfolio();
    const one = await get(app, auth, `/portfolio/attendance/map?companyId=${alfa.id}`).expect(200);
    expect(one.body.data.points).toHaveLength(1);
    expect(one.body.data.points[0].company.name).toBe('Alfa');

    const foreign = await get(app, auth, `/portfolio/attendance/map?companyId=${ajena.id}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('COMPANY_NOT_FOUND');
  });

  it('un empleado de otra empresa no aparece aunque se pida su id', async () => {
    const { app, auth, ajeno } = await portfolio();
    const res = await get(app, auth, `/portfolio/attendance/map?employeeId=${ajeno.employee.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.points).toEqual([]);
  });

  it('el admin de una sola empresa y el empleado no pueden usarlo', async () => {
    const { app, asAdmin, asAna } = await portfolio();
    await get(app, asAdmin, '/portfolio/attendance/map').expect(403);
    await get(app, asAna, '/portfolio/attendance/map').expect(403);
  });
});
