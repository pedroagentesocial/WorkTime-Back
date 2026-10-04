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

async function setup() {
  const { app } = createTestApp();
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id);
  const adminSession = await login(app, admin.email, DEFAULT_PASSWORD);
  const employeeSession = await login(app, user.email, DEFAULT_PASSWORD);
  return {
    app,
    company,
    admin,
    user,
    employee,
    asAdmin: bearer(adminSession.accessToken),
    asEmployee: bearer(employeeSession.accessToken),
    employeeSession,
  };
}

const get = (app: Express, auth: Record<string, string>, path: string) =>
  request(app).get(api(path)).set(auth);
const post = (app: Express, auth: Record<string, string>, path: string, body: object = {}) =>
  request(app).post(api(path)).set(auth).send(body);
const patch = (app: Express, auth: Record<string, string>, path: string, body: object) =>
  request(app).patch(api(path)).set(auth).send(body);

describe('PATCH /auth/me', () => {
  it('cambia el nombre y se ve en el perfil y en la lista de empleados', async () => {
    const { app, employee, asAdmin, asEmployee } = await setup();

    const res = await patch(app, asEmployee, '/auth/me', {
      firstName: '  Mariana ',
      lastName: 'López',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ firstName: 'Mariana', lastName: 'López' });

    expect((await get(app, asEmployee, '/auth/me')).body.data.firstName).toBe('Mariana');
    const seenByAdmin = await get(app, asAdmin, `/company/employees/${employee.id}`);
    expect(seenByAdmin.body.data).toMatchObject({ firstName: 'Mariana', lastName: 'López' });

    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { type: 'profile.updated' },
    });
    expect(event.userId).toBe(employee.userId);
  });

  it('solo acepta nombre y apellido, nunca email, rol ni empresa', async () => {
    const { app, user, asEmployee } = await setup();
    const bad: object[] = [
      {},
      { firstName: 'Ana' },
      { firstName: '', lastName: 'López' },
      { firstName: 'x'.repeat(101), lastName: 'López' },
      { firstName: 'Ana', lastName: 'López', email: 'otro@test.com' },
      { firstName: 'Ana', lastName: 'López', role: 'company_admin' },
    ];
    for (const body of bad) {
      expect((await patch(app, asEmployee, '/auth/me', body)).status).toBe(400);
    }
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ email: user.email, role: 'employee', firstName: 'Test' });
  });

  it('exige sesión', async () => {
    const { app } = await setup();
    const res = await request(app)
      .patch(api('/auth/me'))
      .send({ firstName: 'Ana', lastName: 'López' });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/me/logout-all', () => {
  it('cierra todas las sesiones al instante, también la actual, y se puede volver a entrar', async () => {
    const { app, user, asEmployee, employeeSession } = await setup();
    const second = await login(app, user.email, DEFAULT_PASSWORD);

    const res = await post(app, asEmployee, '/auth/me/logout-all');
    expect(res.status).toBe(204);

    expect((await get(app, asEmployee, '/auth/me')).status).toBe(401);
    expect((await get(app, bearer(second.accessToken), '/auth/me')).status).toBe(401);
    for (const refreshToken of [employeeSession.refreshToken, second.refreshToken]) {
      const refresh = await request(app).post(api('/auth/refresh')).send({ refreshToken });
      expect(refresh.status).toBe(401);
    }

    const again = await login(app, user.email, DEFAULT_PASSWORD);
    expect((await get(app, bearer(again.accessToken), '/auth/me')).status).toBe(200);
    expect(await prisma.securityEvent.count({ where: { type: 'sessions.revoked' } })).toBe(1);
  });

  it('no toca las sesiones de otros usuarios', async () => {
    const { app, asAdmin, asEmployee } = await setup();
    await post(app, asEmployee, '/auth/me/logout-all');
    expect((await get(app, asAdmin, '/auth/me')).status).toBe(200);
  });

  it('un usuario con contraseña temporal también puede cerrar sus sesiones', async () => {
    const { app, company } = await setup();
    const temp = await createUser(prisma, {
      role: Role.EMPLOYEE,
      companyId: company.id,
      mustChangePassword: true,
    });
    const session = await login(app, temp.email, DEFAULT_PASSWORD);
    const res = await post(app, bearer(session.accessToken), '/auth/me/logout-all');
    expect(res.status).toBe(204);
  });
});

describe('POST /company/employees/{id}/revoke-sessions', () => {
  it('cierra las sesiones del empleado sin tocar al admin ni su contraseña', async () => {
    const { app, user, employee, admin, asAdmin, asEmployee, employeeSession } = await setup();

    const res = await post(app, asAdmin, `/company/employees/${employee.id}/revoke-sessions`);
    expect(res.status).toBe(204);

    expect((await get(app, asEmployee, '/auth/me')).status).toBe(401);
    const refresh = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: employeeSession.refreshToken });
    expect(refresh.status).toBe(401);

    expect((await get(app, asAdmin, '/auth/me')).status).toBe(200);
    const again = await login(app, user.email, DEFAULT_PASSWORD);
    expect((await get(app, bearer(again.accessToken), '/auth/me')).status).toBe(200);

    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { type: 'employee.sessions_revoked' },
    });
    expect(event.userId).toBe(admin.id);
    expect(event.metadata).toMatchObject({ employeeId: employee.id });
  });

  it('un empleado de otra empresa o inexistente responde 404 y no se toca', async () => {
    const { app, asAdmin } = await setup();
    const other = await createCompany(prisma, { name: 'Otra' });
    const { user: foreignUser, employee: foreign } = await createEmployee(prisma, other.id);
    const foreignSession = await login(app, foreignUser.email, DEFAULT_PASSWORD);

    const res = await post(app, asAdmin, `/company/employees/${foreign.id}/revoke-sessions`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect((await get(app, bearer(foreignSession.accessToken), '/auth/me')).status).toBe(200);
  });

  it('el empleado no puede cerrar sesiones de nadie', async () => {
    const { app, employee, asEmployee } = await setup();
    const res = await post(app, asEmployee, `/company/employees/${employee.id}/revoke-sessions`);
    expect(res.status).toBe(403);
  });
});
