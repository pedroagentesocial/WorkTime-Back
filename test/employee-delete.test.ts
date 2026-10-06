import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { createCompany, createUser, DEFAULT_PASSWORD } from './helpers/fixtures.js';
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

async function companyAdminSession(app: Express, maxEmployees = 10) {
  const company = await createCompany(prisma, { maxEmployees });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const session = await login(app, admin.email, DEFAULT_PASSWORD);
  return { company, admin, auth: bearer(session.accessToken) };
}

async function createEmployeeVia(app: Express, auth: Record<string, string>, email?: string) {
  const res = await request(app)
    .post(api('/company/employees'))
    .set(auth)
    .send({ email: email ?? `${uuidv7()}@empresa.com`, firstName: 'Ana', lastName: 'López' });
  if (res.status !== 201)
    throw new Error(`alta falló (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as {
    employee: { id: string; userId: string; email: string; employeeCode: string };
    temporaryPassword: string;
  };
}

const remove = (app: Express, auth: Record<string, string>, id: string) =>
  request(app)
    .delete(api(`/company/employees/${id}`))
    .set(auth);

function addEntry(companyId: string, employeeId: string, voided = false) {
  return prisma.timeEntry.create({
    data: {
      id: uuidv7(),
      companyId,
      employeeId,
      clockInAt: new Date('2026-10-05T14:00:00Z'),
      clockOutAt: voided ? new Date('2026-10-05T18:00:00Z') : null,
      timezone: 'America/Denver',
      workDate: new Date('2026-10-05T00:00:00.000Z'),
      source: 'web',
    },
  });
}

describe('DELETE /company/employees/:id', () => {
  it('elimina a un empleado sin historial, corta su acceso y libera su correo', async () => {
    const { app } = createTestApp();
    const { company, admin, auth } = await companyAdminSession(app);
    const { employee, temporaryPassword } = await createEmployeeVia(app, auth);
    const session = await login(app, employee.email, temporaryPassword);

    await remove(app, auth, employee.id).expect(204);

    expect(await prisma.employee.count({ where: { id: employee.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: employee.userId } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: employee.userId } })).toBe(0);
    await request(app).get(api('/auth/me')).set(bearer(session.accessToken)).expect(401);
    const relogin = await request(app)
      .post(api('/auth/login'))
      .send({ email: employee.email, password: temporaryPassword });
    expect(relogin.status).toBe(401);
    await request(app)
      .get(api(`/company/employees/${employee.id}`))
      .set(auth)
      .expect(404);

    const again = await createEmployeeVia(app, auth, employee.email);
    expect(again.employee.email).toBe(employee.email);
    expect(again.employee.employeeCode).not.toBe(employee.employeeCode);

    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { type: 'employee.deleted', companyId: company.id },
    });
    expect(event.userId).toBe(admin.id);
    expect(event.metadata).toMatchObject({
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      email: employee.email,
    });
  });

  it('libera su lugar en el tope de empleados', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app, 1);
    const first = await createEmployeeVia(app, auth);
    const full = await request(app)
      .post(api('/company/employees'))
      .set(auth)
      .send({ email: `${uuidv7()}@empresa.com`, firstName: 'Luis', lastName: 'Mena' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('EMPLOYEE_LIMIT_REACHED');

    await remove(app, auth, first.employee.id).expect(204);
    await createEmployeeVia(app, auth);
  });

  it('no elimina a quien ya tiene un marcaje, aunque este abierto o anulado', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminSession(app);
    const { employee } = await createEmployeeVia(app, auth);
    const entry = await addEntry(company.id, employee.id);

    const res = await remove(app, auth, employee.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMPLOYEE_HAS_HISTORY');
    expect(await prisma.employee.count({ where: { id: employee.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: employee.userId } })).toBe(1);

    await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        voidedAt: new Date('2026-10-06T00:00:00Z'),
        voidedById: (await prisma.user.findFirstOrThrow({ where: { role: Role.COMPANY_ADMIN } }))
          .id,
        voidReason: 'Registro duplicado',
      },
    });
    expect((await remove(app, auth, employee.id)).body.error.code).toBe('EMPLOYEE_HAS_HISTORY');
  });

  it('no elimina a quien ya escribio un reporte', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminSession(app);
    const { employee } = await createEmployeeVia(app, auth);
    await prisma.dailyReport.create({
      data: {
        companyId: company.id,
        employeeId: employee.id,
        workDate: new Date('2026-10-05T00:00:00Z'),
        content: 'Atendí a tres clientes del almacén',
      },
    });

    const res = await remove(app, auth, employee.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMPLOYEE_HAS_HISTORY');
  });

  it('un empleado desactivado sin historial tambien se puede eliminar', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const { employee } = await createEmployeeVia(app, auth);
    await request(app)
      .patch(api(`/company/employees/${employee.id}/status`))
      .set(auth)
      .send({ status: 'inactive' })
      .expect(200);

    await remove(app, auth, employee.id).expect(204);
    expect(await prisma.employee.count({ where: { id: employee.id } })).toBe(0);
  });

  it('un empleado de otra empresa responde 404 y no se toca', async () => {
    const { app } = createTestApp();
    const mine = await companyAdminSession(app);
    const other = await companyAdminSession(app);
    const { employee } = await createEmployeeVia(app, other.auth);

    const res = await remove(app, mine.auth, employee.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(await prisma.employee.count({ where: { id: employee.id } })).toBe(1);
  });

  it('un id inexistente responde 404', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const res = await remove(app, auth, uuidv7());
    expect(res.status).toBe(404);
  });

  it('solo el admin de empresa puede eliminar', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminSession(app);
    const { employee } = await createEmployeeVia(app, auth);
    const worker = await createUser(prisma, { role: Role.EMPLOYEE, companyId: company.id });
    const platform = await createUser(prisma, { role: Role.PLATFORM_ADMIN });

    for (const user of [worker, platform]) {
      const session = await login(app, user.email, DEFAULT_PASSWORD);
      expect((await remove(app, bearer(session.accessToken), employee.id)).status).toBe(403);
    }
    expect((await request(app).delete(api(`/company/employees/${employee.id}`))).status).toBe(401);
    expect(await prisma.employee.count({ where: { id: employee.id } })).toBe(1);
  });

  it('el codigo del empleado eliminado no se reutiliza', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const first = await createEmployeeVia(app, auth);
    await remove(app, auth, first.employee.id).expect(204);
    const second = await createEmployeeVia(app, auth);
    const number = (code: string) => Number(code.split('-')[1]);
    expect(number(second.employee.employeeCode)).toBeGreaterThan(
      number(first.employee.employeeCode),
    );
  });
});
