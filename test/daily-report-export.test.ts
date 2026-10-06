import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
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

async function setupCompany(app: Express) {
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  return { company, asAdmin };
}

function addReport(companyId: string, employeeId: string, workDate: string, content: string) {
  return prisma.dailyReport.create({
    data: { companyId, employeeId, workDate: new Date(`${workDate}T00:00:00Z`), content },
  });
}

const exportCsv = (app: Express, auth: Record<string, string>, query = '') =>
  request(app)
    .get(api(`/company/daily-reports/export${query}`))
    .set(auth);

const rows = (text: string) => text.replace('﻿', '').trim().split('\r\n');

describe('GET /company/daily-reports/export', () => {
  it('descarga un CSV con todos los reportes de la empresa', async () => {
    const { app } = createTestApp();
    const { company, asAdmin } = await setupCompany(app);
    const { employee: ana } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
    const { employee: beto } = await createEmployee(prisma, company.id, { firstName: 'Beto' });
    await addReport(company.id, ana.id, '2026-10-05', 'Atendí a tres clientes del almacén');
    await addReport(company.id, beto.id, '2026-10-06', 'Cerré el inventario de la bodega');

    const res = await exportCsv(app, asAdmin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="reportes-diarios.csv"');

    const lines = rows(res.text);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Código,Empleado,Fecha,Reporte');
    expect(res.text).toContain('Atendí a tres clientes del almacén');
    expect(res.text).toContain('Cerré el inventario de la bodega');
  });

  it('filtra por empleado y por rango y lo refleja en el nombre del archivo', async () => {
    const { app } = createTestApp();
    const { company, asAdmin } = await setupCompany(app);
    const { employee: ana } = await createEmployee(prisma, company.id, { firstName: 'Ana' });
    const { employee: beto } = await createEmployee(prisma, company.id, { firstName: 'Beto' });
    await addReport(company.id, ana.id, '2026-10-05', 'Reporte de Ana del lunes cinco');
    await addReport(company.id, ana.id, '2026-10-07', 'Reporte de Ana del miércoles');
    await addReport(company.id, beto.id, '2026-10-07', 'Reporte de Beto del miércoles');

    const byEmployee = await exportCsv(app, asAdmin, `?employeeId=${ana.id}`);
    expect(rows(byEmployee.text)).toHaveLength(3);
    expect(byEmployee.text).not.toContain('Beto del');

    const byRange = await exportCsv(app, asAdmin, '?from=2026-10-06&to=2026-10-07');
    expect(rows(byRange.text)).toHaveLength(3);
    expect(byRange.text).not.toContain('lunes cinco');
    expect(byRange.headers['content-disposition']).toBe(
      'attachment; filename="reportes-diarios-2026-10-06_2026-10-07.csv"',
    );
  });

  it('entrecomilla los saltos de línea y neutraliza fórmulas', async () => {
    const { app } = createTestApp();
    const { company, asAdmin } = await setupCompany(app);
    const { employee } = await createEmployee(prisma, company.id);
    await addReport(
      company.id,
      employee.id,
      '2026-10-05',
      'Primera línea\nsegunda línea, con coma',
    );
    await addReport(company.id, employee.id, '2026-10-06', '=HYPERLINK("http://evil.test")');

    const res = await exportCsv(app, asAdmin);
    expect(res.text).toContain('"Primera línea\nsegunda línea, con coma"');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil.test"")"`);
  });

  it('sin reportes devuelve solo el encabezado', async () => {
    const { app } = createTestApp();
    const { asAdmin } = await setupCompany(app);
    const res = await exportCsv(app, asAdmin);
    expect(res.status).toBe(200);
    expect(rows(res.text)).toHaveLength(1);
  });

  it('valida el rango y el empleado', async () => {
    const { app } = createTestApp();
    const { asAdmin } = await setupCompany(app);
    const inverted = await exportCsv(app, asAdmin, '?from=2026-10-07&to=2026-10-01');
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe('INVALID_DATE_RANGE');

    const unknown = await exportCsv(
      app,
      asAdmin,
      '?employeeId=0199c7a0-0000-7000-8000-000000000000',
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('no mezcla empresas y exige permiso', async () => {
    const { app } = createTestApp();
    const mine = await setupCompany(app);
    const other = await setupCompany(app);
    const { employee: mineEmployee, user: mineUser } = await createEmployee(
      prisma,
      mine.company.id,
    );
    const { employee: otherEmployee } = await createEmployee(prisma, other.company.id);
    await addReport(mine.company.id, mineEmployee.id, '2026-10-05', 'Reporte propio de mi empresa');
    await addReport(other.company.id, otherEmployee.id, '2026-10-05', 'Reporte secreto ajeno');

    const res = await exportCsv(app, mine.asAdmin);
    expect(res.text).toContain('Reporte propio de mi empresa');
    expect(res.text).not.toContain('secreto');

    const foreign = await exportCsv(app, mine.asAdmin, `?employeeId=${otherEmployee.id}`);
    expect(foreign.status).toBe(404);

    const asEmployee = bearer((await login(app, mineUser.email, DEFAULT_PASSWORD)).accessToken);
    expect((await exportCsv(app, asEmployee)).status).toBe(403);
    expect((await request(app).get(api('/company/daily-reports/export'))).status).toBe(401);
  });
});
