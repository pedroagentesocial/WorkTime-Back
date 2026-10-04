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

async function setup() {
  const { app, clock } = createTestApp();
  setTime(clock, NOW);
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  return { app, company, asAdmin };
}

async function addEntry(
  companyId: string,
  employeeId: string,
  date: string,
  from: string,
  to: string | null,
) {
  await prisma.timeEntry.create({
    data: {
      id: uuidv7(),
      companyId,
      employeeId,
      clockInAt: new Date(`${date}T${from}:00-06:00`),
      clockOutAt: to ? new Date(`${date}T${to}:00-06:00`) : null,
      timezone: 'America/Denver',
      workDate: new Date(`${date}T00:00:00.000Z`),
      source: 'web',
    },
  });
}

const sheet = (app: Express, auth: Record<string, string>, query = '') =>
  request(app)
    .get(api(`/company/timesheet${query}`))
    .set(auth);

describe('GET /company/timesheet', () => {
  it('muestra una fila por empleado con sus horas por día y los totales', async () => {
    const { app, company, asAdmin } = await setup();
    const { employee: ana } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
    const { employee: beto } = await createEmployee(prisma, company.id, { firstName: 'Beto' });
    await addEntry(company.id, ana.id, '2026-10-05', '08:00', '16:30');
    await addEntry(company.id, ana.id, '2026-10-06', '09:00', '12:00');
    await addEntry(company.id, ana.id, '2026-10-06', '13:00', '14:30');
    await addEntry(company.id, beto.id, '2026-10-05', '08:00', '12:00');

    const res = await sheet(app, asAdmin);
    expect(res.status).toBe(200);
    const { data, meta } = res.body as {
      data: { employee: { firstName: string }; hours: number[]; totalHours: number }[];
      meta: {
        period: unknown;
        previousPeriodStart: string;
        nextPeriodStart: string;
        days: unknown[];
        total: number;
        totals: { hours: number[]; totalHours: number };
      };
    };

    expect(meta.period).toEqual({ start: '2026-10-05', end: '2026-10-18' });
    expect(meta.previousPeriodStart).toBe('2026-09-21');
    expect(meta.nextPeriodStart).toBe('2026-10-19');
    expect(meta.days).toHaveLength(14);
    expect(meta.days[0]).toEqual({ date: '2026-10-05', weekday: 'monday' });
    expect(meta.total).toBe(2);

    expect(data.map((r) => r.employee.firstName)).toEqual(['Ana', 'Beto']);
    expect(data[0]?.hours).toHaveLength(14);
    expect(data[0]?.hours.slice(0, 3)).toEqual([8.5, 4.5, 0]);
    expect(data[0]?.totalHours).toBe(13);
    expect(data[1]?.totalHours).toBe(4);
    expect(meta.totals.hours.slice(0, 2)).toEqual([12.5, 4.5]);
    expect(meta.totals.totalHours).toBe(17);
  });

  it('un marcaje abierto no suma horas pero se avisa', async () => {
    const { app, company, asAdmin } = await setup();
    const { employee } = await createEmployee(prisma, company.id);
    await addEntry(company.id, employee.id, '2026-10-07', '08:00', null);

    const res = await sheet(app, asAdmin);
    expect(res.body.data[0]).toMatchObject({ totalHours: 0, openEntries: 1 });
  });

  it('elige el periodo con date y pagina sin alterar los totales de la empresa', async () => {
    const { app, company, asAdmin } = await setup();
    const { employee: ana } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
    const { employee: beto } = await createEmployee(prisma, company.id, { firstName: 'Beto' });
    await addEntry(company.id, ana.id, '2026-09-22', '08:00', '16:00');
    await addEntry(company.id, beto.id, '2026-09-23', '08:00', '12:00');

    const previous = await sheet(app, asAdmin, '?date=2026-09-30&limit=1&page=2');
    expect(previous.body.meta).toMatchObject({
      period: { start: '2026-09-21', end: '2026-10-04' },
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(previous.body.data).toHaveLength(1);
    expect(previous.body.data[0].employee.firstName).toBe('Beto');
    expect(previous.body.meta.totals.totalHours).toBe(12);

    const current = await sheet(app, asAdmin);
    expect(current.body.meta.totals.totalHours).toBe(0);
  });

  it('filtra por búsqueda y los totales cubren solo lo filtrado', async () => {
    const { app, company, asAdmin } = await setup();
    const { employee: ana } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
    const { employee: beto } = await createEmployee(prisma, company.id, { firstName: 'Beto' });
    await addEntry(company.id, ana.id, '2026-10-05', '08:00', '16:00');
    await addEntry(company.id, beto.id, '2026-10-05', '08:00', '12:00');

    const res = await sheet(app, asAdmin, '?search=bet');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.totals.totalHours).toBe(4);
  });

  it('incluye desactivados solo si trabajaron en el periodo', async () => {
    const { app, company, asAdmin } = await setup();
    const { employee: worked } = await createEmployee(prisma, company.id, {
      firstName: 'Con',
      status: 'inactive',
    });
    await createEmployee(prisma, company.id, { firstName: 'Sin', status: 'inactive' });
    await addEntry(company.id, worked.id, '2026-10-05', '08:00', '16:00');

    const res = await sheet(app, asAdmin);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].employee).toMatchObject({ firstName: 'Con', active: false });
  });

  it('no muestra empleados ni horas de otra empresa', async () => {
    const { app, company, asAdmin } = await setup();
    const other = await createCompany(prisma, { name: 'Otra' });
    const { employee: foreign } = await createEmployee(prisma, other.id);
    const { employee: own } = await createEmployee(prisma, company.id);
    await addEntry(other.id, foreign.id, '2026-10-05', '08:00', '16:00');
    await addEntry(company.id, own.id, '2026-10-05', '08:00', '10:00');

    const res = await sheet(app, asAdmin);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].employee.id).toBe(own.id);
    expect(res.body.meta.totals.totalHours).toBe(2);
  });

  it('valida los parámetros y el empleado no tiene acceso', async () => {
    const { app, company, asAdmin } = await setup();
    expect((await sheet(app, asAdmin, '?date=ayer')).status).toBe(400);
    expect((await sheet(app, asAdmin, '?limit=0')).status).toBe(400);

    const { user } = await createEmployee(prisma, company.id);
    const asEmployee = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
    expect((await sheet(app, asEmployee)).status).toBe(403);
  });
});

describe('GET /company/timesheet/export', () => {
  const exportCsv = (app: Express, auth: Record<string, string>, query = '') =>
    request(app)
      .get(api(`/company/timesheet/export${query}`))
      .set(auth);

  it('descarga un CSV con todos los empleados y la fila de totales', async () => {
    const { app, company, asAdmin } = await setup();
    const { employee: ana } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
    const { employee: beto } = await createEmployee(prisma, company.id, { firstName: 'Beto' });
    await addEntry(company.id, ana.id, '2026-10-05', '08:00', '16:30');
    await addEntry(company.id, beto.id, '2026-10-06', '08:00', '12:00');

    const res = await exportCsv(app, asAdmin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="hoja-de-tiempo-2026-10-05_2026-10-18.csv"',
    );

    const lines = res.text.replace('﻿', '').trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]?.split(',').slice(0, 5)).toEqual([
      'Código',
      'Empleado',
      'Estado',
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(lines[0]?.endsWith(',Total')).toBe(true);
    expect(lines[1]).toContain('Ana User,Activo,8.50,0.00');
    expect(lines[1]?.endsWith(',8.50')).toBe(true);
    expect(lines[3]).toMatch(/^,Total,,8\.50,4\.00,/);
    expect(lines[3]?.endsWith(',12.50')).toBe(true);
  });

  it('el CSV no deja ejecutar fórmulas con nombres maliciosos', async () => {
    const { app, company, asAdmin } = await setup();
    await createEmployee(prisma, company.id, { firstName: '=HYPERLINK("http://x.com")' });

    const res = await exportCsv(app, asAdmin);
    expect(res.text).toContain(`"'=HYPERLINK(""http://x.com"") User"`);
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('respeta date y search, y el empleado no tiene acceso', async () => {
    const { app, company, asAdmin } = await setup();
    await createEmployee(prisma, company.id, { firstName: 'Ana' });
    await createEmployee(prisma, company.id, { firstName: 'Beto' });

    const res = await exportCsv(app, asAdmin, '?date=2026-09-22&search=ana');
    expect(res.headers['content-disposition']).toContain('2026-09-21_2026-10-04');
    expect(res.text.trim().split('\r\n')).toHaveLength(3);

    const { user } = await createEmployee(prisma, company.id);
    const asEmployee = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
    expect((await exportCsv(app, asEmployee)).status).toBe(403);
  });
});
