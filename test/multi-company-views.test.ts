import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import type { FakeClock } from './helpers/fake-clock.js';
import {
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

const NOW = '2026-10-07T18:00:00Z';
const DAY_A = '2026-10-05';
const DAY_B = '2026-10-06';

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
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

function addReport(companyId: string, employeeId: string, workDate: string, content: string) {
  return prisma.dailyReport.create({
    data: { companyId, employeeId, workDate: new Date(`${workDate}T00:00:00Z`), content },
  });
}

// Tres empresas con datos: dos de la persona (Alfa y Beta), una ajena y una suya suspendida
async function setup() {
  const { app, clock } = createTestApp();
  setTime(clock, NOW);
  const alfa = await createCompany(prisma, { name: 'Alfa' });
  const beta = await createCompany(prisma, { name: 'Beta' });
  const foreign = await createCompany(prisma, { name: 'Ajena' });
  const suspended = await createCompany(prisma, { name: 'Suspendida', status: 'suspended' });

  const ana = await createEmployee(prisma, alfa.id, { firstName: 'Ana' });
  const beto = await createEmployee(prisma, beta.id, { firstName: 'Beto' });
  const ajeno = await createEmployee(prisma, foreign.id, { firstName: 'Ajeno' });
  const susp = await createEmployee(prisma, suspended.id, { firstName: 'Susp' });

  await addEntry(alfa.id, ana.employee.id, DAY_A, '08:00', '16:30');
  await addEntry(beta.id, beto.employee.id, DAY_A, '09:00', '13:00');
  await addEntry(beta.id, beto.employee.id, DAY_B, '09:00', '12:00');
  await addEntry(foreign.id, ajeno.employee.id, DAY_A, '08:00', '18:00');
  await addEntry(suspended.id, susp.employee.id, DAY_A, '08:00', '17:00');
  // Ana sigue trabajando ahora, con la entrada abierta
  await addEntry(alfa.id, ana.employee.id, '2026-10-07', '10:00', null);

  const laura = await createMultiAdmin(prisma, {
    companyIds: [alfa.id, beta.id, suspended.id],
  });
  const session = await login(app, laura.email, DEFAULT_PASSWORD);
  return {
    app,
    clock,
    alfa,
    beta,
    foreign,
    suspended,
    ana,
    beto,
    ajeno,
    susp,
    laura,
    auth: bearer(session.accessToken),
    session,
  };
}

const get = (app: Express, auth: Record<string, string>, path: string) =>
  request(app).get(api(path)).set(auth);

const numbers = (values: unknown) => values as number[];

const csvRows = (text: string) => text.replace('﻿', '').trim().split('\r\n');

describe('GET /portfolio/summary', () => {
  it('reúne solo las empresas activas de la persona, en total y por empresa', async () => {
    const { app, auth, alfa, beta } = await setup();

    const res = await get(app, auth, '/portfolio/summary').expect(200);
    const data = res.body.data;

    expect(data.period).toEqual({ start: '2026-10-05', end: '2026-10-18' });
    expect(data.totals.companies).toBe(2);
    expect(data.totals.employees).toEqual({ active: 2, in: 1, out: 1 });
    // 8.5 h de Ana + 4 h y 3 h de Beto, y las 8 h de la entrada abierta de Ana no cuentan en el periodo
    expect(data.totals.periodHours).toBe(15.5);
    expect(numbers(data.totals.dailyHours).slice(0, 2)).toEqual([12.5, 3]);
    expect(data.days).toHaveLength(14);

    type Row = { company: { id: string; name: string }; worked: { seconds: number } };
    const rows = data.companies as Row[];
    const byName = Object.fromEntries(rows.map((c) => [c.company.name, c]));
    expect(Object.keys(byName).sort()).toEqual(['Alfa', 'Beta']);
    expect(byName.Alfa).toMatchObject({
      company: { id: alfa.id },
      employees: { active: 1, in: 1, out: 0 },
      periodHours: 8.5,
    });
    expect(byName.Beta).toMatchObject({
      company: { id: beta.id },
      employees: { active: 1, in: 0, out: 1 },
      periodHours: 7,
    });
    expect(data.totals.worked.seconds).toBe(rows.reduce((sum, c) => sum + c.worked.seconds, 0));
  });

  it('coincide con lo que ve el admin de cada empresa', async () => {
    const { app, auth, alfa, session } = await setup();
    const summary = (await get(app, auth, '/portfolio/summary').expect(200)).body.data;
    const alfaRow = (
      summary.companies as {
        company: { id: string };
        employees: unknown;
        worked: unknown;
        atLimitCount: number;
        periodHours: number;
      }[]
    ).find((c) => c.company.id === alfa.id)!;

    const inAlfa = bearer((await switchCompany(app, session, alfa.id)).accessToken);
    const own = (await get(app, inAlfa, '/company/attendance/summary').expect(200)).body.data;
    expect(alfaRow.employees).toEqual(own.employees);
    expect(alfaRow.worked).toEqual(own.worked);
    expect(alfaRow.atLimitCount).toBe(own.atLimit.count);

    const period = (await get(app, inAlfa, '/company/periods').expect(200)).body.data;
    expect(alfaRow.periodHours).toBe(period.totalHours);
  });

  it('se puede acotar a una empresa y una ajena responde 404', async () => {
    const { app, auth, alfa, foreign, suspended } = await setup();

    const one = await get(app, auth, `/portfolio/summary?companyId=${alfa.id}`).expect(200);
    expect(one.body.data.totals.companies).toBe(1);

    for (const id of [foreign.id, suspended.id, uuidv7()]) {
      const res = await get(app, auth, `/portfolio/summary?companyId=${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('COMPANY_NOT_FOUND');
    }
  });

  it('sin empresas devuelve todo en cero, sin error', async () => {
    const { app } = await setup();
    const empty = await createMultiAdmin(prisma);
    const session = await login(app, empty.email, DEFAULT_PASSWORD);

    const res = await get(app, bearer(session.accessToken), '/portfolio/summary').expect(200);
    expect(res.body.data.totals).toMatchObject({
      companies: 0,
      employees: { active: 0, in: 0, out: 0 },
      periodHours: 0,
    });
    expect(res.body.data.companies).toEqual([]);
  });

  it('al quitarle una empresa deja de contarla de inmediato', async () => {
    const { app, auth, alfa, laura } = await setup();
    await prisma.companyMembership.delete({
      where: { userId_companyId: { userId: laura.id, companyId: alfa.id } },
    });

    const res = await get(app, auth, '/portfolio/summary').expect(200);
    const names = (res.body.data.companies as { company: { name: string } }[]).map(
      (c) => c.company.name,
    );
    expect(names).toEqual(['Beta']);
  });

  it('funciona igual con una empresa activa en la sesión', async () => {
    const { app, alfa, session } = await setup();
    const inAlfa = bearer((await switchCompany(app, session, alfa.id)).accessToken);

    const res = await get(app, inAlfa, '/portfolio/summary').expect(200);
    expect(res.body.data.totals.companies).toBe(2);
  });
});

describe('GET /portfolio/employees', () => {
  it('lista los empleados de todas sus empresas activas con su empresa', async () => {
    const { app, auth, alfa, beta } = await setup();

    const res = await get(app, auth, '/portfolio/employees').expect(200);
    const items = res.body.data as { firstName: string; company: { id: string; name: string } }[];

    expect(items.map((e) => [e.company.name, e.firstName])).toEqual([
      ['Alfa', 'Ana'],
      ['Beta', 'Beto'],
    ]);
    expect(items.map((e) => e.company.id)).toEqual([alfa.id, beta.id]);
    expect(res.body.meta.total).toBe(2);
  });

  it('nunca muestra empleados de empresas ajenas o suspendidas', async () => {
    const { app, auth } = await setup();
    const res = await get(app, auth, '/portfolio/employees?limit=100').expect(200);
    const names = (res.body.data as { firstName: string }[]).map((e) => e.firstName);
    expect(names).not.toContain('Ajeno');
    expect(names).not.toContain('Susp');
  });

  it('filtra por empresa, estado y búsqueda; una empresa ajena responde 404', async () => {
    const { app, auth, beta, foreign } = await setup();

    const byCompany = await get(app, auth, `/portfolio/employees?companyId=${beta.id}`).expect(200);
    expect((byCompany.body.data as unknown[]).length).toBe(1);

    const search = await get(app, auth, '/portfolio/employees?search=ana').expect(200);
    expect((search.body.data as { firstName: string }[]).map((e) => e.firstName)).toEqual(['Ana']);

    const inactive = await get(app, auth, '/portfolio/employees?status=inactive').expect(200);
    expect(inactive.body.data).toEqual([]);

    const ajena = await get(app, auth, `/portfolio/employees?companyId=${foreign.id}`);
    expect(ajena.status).toBe(404);
    expect(ajena.body.error.code).toBe('COMPANY_NOT_FOUND');
  });
});

describe('/portfolio/timesheet', () => {
  it('muestra una fila por empleado con su empresa y los totales de todos', async () => {
    const { app, auth } = await setup();

    const res = await get(app, auth, '/portfolio/timesheet?date=2026-10-07').expect(200);
    const rows = res.body.data as {
      company: { name: string };
      employee: { firstName: string };
      hours: number[];
      totalHours: number;
    }[];

    expect(rows.map((r) => [r.company.name, r.employee.firstName, r.totalHours])).toEqual([
      ['Alfa', 'Ana', 8.5],
      ['Beta', 'Beto', 7],
    ]);
    expect(res.body.meta.totals.totalHours).toBe(15.5);
    expect(numbers(res.body.meta.totals.hours).slice(0, 2)).toEqual([12.5, 3]);
    expect(res.body.meta.period).toEqual({ start: '2026-10-05', end: '2026-10-18' });
    expect(res.body.meta.total).toBe(2);
  });

  it('pagina las filas unidas y no mezcla empresas ajenas', async () => {
    const { app, auth } = await setup();

    const first = await get(app, auth, '/portfolio/timesheet?date=2026-10-07&limit=1').expect(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.meta.totalPages).toBe(2);
    // Los totales siguen siendo de todos, no de la página
    expect(first.body.meta.totals.totalHours).toBe(15.5);

    const all = await get(app, auth, '/portfolio/timesheet?date=2026-10-07&limit=100').expect(200);
    const names = (all.body.data as { employee: { firstName: string } }[]).map(
      (r) => r.employee.firstName,
    );
    expect(names).not.toContain('Ajeno');
    expect(names).not.toContain('Susp');
  });

  it('exporta un CSV con la empresa al inicio de cada fila y la fila de totales', async () => {
    const { app, auth } = await setup();

    const res = await get(app, auth, '/portfolio/timesheet/export?date=2026-10-07').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(
      'horas-todas-las-empresas-2026-10-05_2026-10-18.csv',
    );

    const lines = csvRows(res.text);
    expect(lines[0]).toBe(
      'Empresa,Código de empresa,Código,Empleado,Estado,' +
        Array.from({ length: 14 }, (_, i) => `2026-10-${String(5 + i).padStart(2, '0')}`).join(
          ',',
        ) +
        ',Total',
    );
    expect(lines[1]).toMatch(/^Alfa,[A-Z2-9]{4}-[A-Z2-9]{4},[A-Z]{3}-0001,Ana User,Activo,8.50,/);
    expect(lines[2]).toMatch(
      /^Beta,[A-Z2-9]{4}-[A-Z2-9]{4},[A-Z]{3}-0001,Beto User,Activo,4.00,3.00,/,
    );
    expect(lines.at(-1)).toMatch(/^,,,Total,,12.50,3.00,/);
    expect(res.text).not.toContain('Ajeno');
    expect(res.text).not.toContain('Susp');
  });

  it('el periodo por defecto no avanza hasta que todas sus empresas lo terminaron', async () => {
    const { app, clock, alfa, laura } = await setup();
    // Lunes 00:30 UTC: en UTC ya es el periodo nuevo, en Denver todavia es domingo
    setTime(clock, '2026-10-19T00:30:00Z');
    await prisma.company.update({ where: { id: alfa.id }, data: { timezone: 'UTC' } });
    const fresh = await login(app, laura.email, DEFAULT_PASSWORD);

    const res = await get(app, bearer(fresh.accessToken), '/portfolio/timesheet').expect(200);
    expect(res.body.meta.period).toEqual({ start: '2026-10-05', end: '2026-10-18' });
  });
});

describe('/portfolio/daily-reports', () => {
  async function withReports() {
    const ctx = await setup();
    await addReport(
      ctx.alfa.id,
      ctx.ana.employee.id,
      DAY_A,
      '**Trabajé** en la línea 1 y revisé pedidos',
    );
    await addReport(ctx.beta.id, ctx.beto.employee.id, DAY_B, '=cmd Cerré caja y limpié el local');
    await addReport(
      ctx.foreign.id,
      ctx.ajeno.employee.id,
      DAY_A,
      'Reporte de una empresa ajena visible',
    );
    await addReport(
      ctx.suspended.id,
      ctx.susp.employee.id,
      DAY_A,
      'Reporte de una empresa suspendida',
    );
    return ctx;
  }

  it('lista los reportes de todas sus empresas, los más recientes primero', async () => {
    const { app, auth } = await withReports();

    const res = await get(app, auth, '/portfolio/daily-reports').expect(200);
    const items = res.body.data as {
      company: { name: string };
      employee: { firstName: string };
      workDate: string;
    }[];

    expect(items.map((r) => [r.company.name, r.employee.firstName, r.workDate])).toEqual([
      ['Beta', 'Beto', DAY_B],
      ['Alfa', 'Ana', DAY_A],
    ]);
    expect(res.body.meta.total).toBe(2);
  });

  it('filtra por día y por empresa; una empresa ajena responde 404; rango inválido 400', async () => {
    const { app, auth, alfa, foreign } = await withReports();

    const day = await get(app, auth, `/portfolio/daily-reports?from=${DAY_B}&to=${DAY_B}`).expect(
      200,
    );
    expect((day.body.data as unknown[]).length).toBe(1);

    const one = await get(app, auth, `/portfolio/daily-reports?companyId=${alfa.id}`).expect(200);
    expect((one.body.data as { company: { id: string } }[]).map((r) => r.company.id)).toEqual([
      alfa.id,
    ]);

    const ajena = await get(app, auth, `/portfolio/daily-reports?companyId=${foreign.id}`);
    expect(ajena.status).toBe(404);

    const bad = await get(app, auth, `/portfolio/daily-reports?from=${DAY_B}&to=${DAY_A}`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('exporta un CSV con la empresa, el texto plano y sin celdas peligrosas', async () => {
    const { app, auth } = await withReports();

    const res = await get(app, auth, '/portfolio/daily-reports/export').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('reportes-todas-las-empresas');

    const lines = csvRows(res.text);
    expect(lines[0]).toBe(
      'Empresa,Código de empresa,Código,Empleado,Fecha,Reporte,Creado (UTC),Última edición (UTC)',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^Beta,/);
    // La fórmula queda neutralizada con un apóstrofo
    expect(lines[1]).toContain("'=cmd Cerré caja");
    expect(lines[2]).toMatch(/^Alfa,.*,Trabajé en la línea 1 y revisé pedidos,/);
    expect(res.text).not.toContain('ajena');
    expect(res.text).not.toContain('suspendida');
  });

  it('acota el rango del CSV igual que el de una empresa', async () => {
    const { app, auth } = await withReports();
    const res = await get(
      app,
      auth,
      `/portfolio/daily-reports/export?from=${DAY_A}&to=${DAY_A}`,
    ).expect(200);
    expect(csvRows(res.text)).toHaveLength(2);
    expect(res.headers['content-disposition']).toContain(`${DAY_A}_${DAY_A}`);
  });
});

describe('Acceso a las vistas consolidadas', () => {
  it('solo el admin multiempresa puede usarlas', async () => {
    const { app, alfa } = await setup();
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: alfa.id,
    });
    const platform = await createUser(prisma, { role: Role.PLATFORM_ADMIN });

    for (const user of [companyAdmin, platform]) {
      const session = await login(app, user.email, DEFAULT_PASSWORD);
      for (const path of [
        '/portfolio/summary',
        '/portfolio/employees',
        '/portfolio/timesheet',
        '/portfolio/timesheet/export',
        '/portfolio/daily-reports',
        '/portfolio/daily-reports/export',
      ]) {
        const res = await get(app, bearer(session.accessToken), path);
        expect(res.status, path).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
  });

  it('sin token responde 401', async () => {
    const { app } = await setup();
    const res = await request(app).get(api('/portfolio/summary'));
    expect(res.status).toBe(401);
  });
});

describe('GET /portfolio/payroll', () => {
  it('trae el pago de cada fila en la moneda de su empresa y un total por moneda', async () => {
    const { app, alfa, beta, foreign, ana, beto, laura, auth } = await setup();
    await prisma.company.update({ where: { id: beta.id }, data: { currency: 'MXN' } });
    const rate = (companyId: string, employeeId: string, kind: string, amountCents: bigint) =>
      prisma.employeePayRate.create({
        data: {
          companyId,
          employeeId,
          kind,
          amountCents,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          changedById: laura.id,
        },
      });
    await rate(alfa.id, ana.employee.id, 'hourly', 1000n);
    await rate(beta.id, beto.employee.id, 'salary', 140_000n);

    const res = await get(app, auth, `/portfolio/payroll?date=${DAY_A}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.payTotals).toEqual([
      { currency: 'MXN', totalCents: 140_000, hourlyCents: 0, salaryCents: 140_000 },
      { currency: 'USD', totalCents: 8500, hourlyCents: 8500, salaryCents: 0 },
    ]);
    expect(res.body.meta.missingPay).toEqual([]);
    const rowOf = (id: string) =>
      (res.body.data as { employee: { id: string } }[]).find((row) => row.employee.id === id);
    expect(rowOf(ana.employee.id)).toMatchObject({
      currency: 'USD',
      pay: { amountCents: 8500 },
    });
    expect(rowOf(beto.employee.id)).toMatchObject({
      currency: 'MXN',
      pay: { amountCents: 140_000, salaryDays: 14 },
    });
    expect(JSON.stringify(res.body)).not.toContain('Ajeno');

    const csv = await get(app, auth, `/portfolio/payroll/export?date=${DAY_A}`);
    const lines = csvRows(csv.text);
    expect(lines[0]).toBe(
      'Empresa,Código de empresa,Código,Empleado,Estado,Moneda,Tipo,Sueldo,Horas,Días con sueldo fijo,Pago',
    );
    expect(lines.at(-2)).toBe(',,,Total MXN,,MXN,,,,,1400.00');
    expect(lines.at(-1)).toBe(',,,Total USD,,USD,,,,,85.00');

    const other = await get(app, auth, `/portfolio/payroll?companyId=${foreign.id}`);
    expect(other.status).toBe(404);
  });
});
