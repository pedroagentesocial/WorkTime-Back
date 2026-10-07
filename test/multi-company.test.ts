import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
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

const newMultiAdmin = (overrides: Record<string, unknown> = {}) => ({
  email: 'Laura@Grupo.com',
  firstName: 'Laura',
  lastName: 'Gómez',
  maxCompanies: 3,
  maxEmployeesPerCompany: 25,
  ...overrides,
});

const newOwnCompany = (overrides: Record<string, unknown> = {}) => ({
  name: 'Sucursal Norte',
  admin: { email: `${uuidv7()}@sucursal.com`, firstName: 'Juan', lastName: 'Pérez' },
  ...overrides,
});

async function platformAuth(app: Express) {
  const admin = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
  const session = await login(app, admin.email, DEFAULT_PASSWORD);
  return { admin, auth: bearer(session.accessToken) };
}

// Sesion de un admin multiempresa ya existente, sin empresa activa
async function multiAdminSession(app: Express, user: { email: string }) {
  const session = await login(app, user.email, DEFAULT_PASSWORD);
  return { ...session, auth: bearer(session.accessToken) };
}

const eventTypes = async (where: object) =>
  (await prisma.securityEvent.findMany({ where, orderBy: { createdAt: 'asc' } })).map(
    (event) => event.type,
  );

describe('Platform: gestión de administradores multiempresa', () => {
  it('crea al administrador con su paquete y una contraseña temporal', async () => {
    const { app } = createTestApp();
    const { admin, auth } = await platformAuth(app);

    const res = await request(app)
      .post(api('/platform/multi-admins'))
      .set(auth)
      .send(newMultiAdmin())
      .expect(201);

    const { multiAdmin, temporaryPassword } = res.body.data;
    expect(multiAdmin).toMatchObject({
      email: 'laura@grupo.com',
      firstName: 'Laura',
      status: 'active',
      maxCompanies: 3,
      maxEmployeesPerCompany: 25,
      companyCount: 0,
    });
    expect(temporaryPassword).toHaveLength(16);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: multiAdmin.id } });
    expect(stored).toMatchObject({
      role: 'multi_company_admin',
      companyId: null,
      mustChangePassword: true,
    });
    expect(await eventTypes({ userId: admin.id })).toContain('multi_admin.created');

    const session = await login(app, 'laura@grupo.com', temporaryPassword);
    expect(session.user.mustChangePassword).toBe(true);
  });

  it('rechaza un email ya registrado y límites fuera de rango', async () => {
    const { app } = createTestApp();
    const { auth } = await platformAuth(app);
    const taken0 = await createCompany(prisma);
    await createUser(prisma, {
      role: Role.EMPLOYEE,
      companyId: taken0.id,
      email: 'laura@grupo.com',
    });

    const taken = await request(app)
      .post(api('/platform/multi-admins'))
      .set(auth)
      .send(newMultiAdmin());
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('EMAIL_TAKEN');

    for (const bad of [{ maxCompanies: 0 }, { maxEmployeesPerCompany: 0 }, { maxCompanies: 1.5 }]) {
      const res = await request(app)
        .post(api('/platform/multi-admins'))
        .set(auth)
        .send(newMultiAdmin({ email: `${uuidv7()}@grupo.com`, ...bad }));
      expect(res.status).toBe(400);
    }
  });

  it('lista, busca y muestra el detalle con sus empresas', async () => {
    const { app } = createTestApp();
    const { auth } = await platformAuth(app);
    const company = await createCompany(prisma, { name: 'Taller Uno' });
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id] });
    await prisma.user.update({ where: { id: laura.id }, data: { firstName: 'Laura' } });
    await createMultiAdmin(prisma);

    const list = await request(app).get(api('/platform/multi-admins')).set(auth).expect(200);
    expect(list.body.data).toHaveLength(2);

    const found = await request(app)
      .get(api('/platform/multi-admins?search=laura'))
      .set(auth)
      .expect(200);
    expect((found.body.data as { id: string }[]).map((item) => item.id)).toEqual([laura.id]);

    const detail = await request(app)
      .get(api(`/platform/multi-admins/${laura.id}`))
      .set(auth)
      .expect(200);
    expect(detail.body.data.multiAdmin).toMatchObject({ id: laura.id, companyCount: 1 });
    expect((detail.body.data.companies as { id: string }[]).map((item) => item.id)).toEqual([
      company.id,
    ]);

    const missing = await request(app)
      .get(api(`/platform/multi-admins/${uuidv7()}`))
      .set(auth);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('MULTI_ADMIN_NOT_FOUND');
  });

  it('no mezcla a otros usuarios: un admin de empresa no es un admin multiempresa', async () => {
    const { app } = createTestApp();
    const { auth } = await platformAuth(app);
    const company = await createCompany(prisma);
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    });

    const res = await request(app)
      .get(api(`/platform/multi-admins/${companyAdmin.id}`))
      .set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MULTI_ADMIN_NOT_FOUND');
  });

  it('edita nombre y paquete, pero el máximo no baja de las empresas que ya tiene', async () => {
    const { app } = createTestApp();
    const { auth } = await platformAuth(app);
    const [a, b] = [await createCompany(prisma), await createCompany(prisma)];
    const laura = await createMultiAdmin(prisma, { companyIds: [a.id, b.id], maxCompanies: 5 });

    const ok = await request(app)
      .patch(api(`/platform/multi-admins/${laura.id}`))
      .set(auth)
      .send({ firstName: ' Lau ', maxCompanies: 2, maxEmployeesPerCompany: 40 })
      .expect(200);
    expect(ok.body.data).toMatchObject({
      firstName: 'Lau',
      maxCompanies: 2,
      maxEmployeesPerCompany: 40,
    });

    const below = await request(app)
      .patch(api(`/platform/multi-admins/${laura.id}`))
      .set(auth)
      .send({ maxCompanies: 1 });
    expect(below.status).toBe(409);
    expect(below.body.error.code).toBe('MAX_COMPANIES_BELOW_ASSIGNED');

    const unknown = await request(app)
      .patch(api(`/platform/multi-admins/${uuidv7()}`))
      .set(auth)
      .send({ maxCompanies: 2 });
    expect(unknown.status).toBe(404);
  });

  it('asigna una empresa existente y respeta el máximo de empresas', async () => {
    const { app } = createTestApp();
    const { admin, auth } = await platformAuth(app);
    const [a, b, c] = [
      await createCompany(prisma),
      await createCompany(prisma),
      await createCompany(prisma),
    ];
    const laura = await createMultiAdmin(prisma, { maxCompanies: 2 });
    const assign = (companyId: string) =>
      request(app)
        .post(api(`/platform/multi-admins/${laura.id}/companies`))
        .set(auth)
        .send({ companyId });

    const first = await assign(a.id);
    expect(first.status).toBe(201);
    expect(first.body.data.companyCount).toBe(1);

    const again = await assign(a.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('COMPANY_ALREADY_ASSIGNED');

    await assign(b.id).expect(201);
    const over = await assign(c.id);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('MAX_COMPANIES_REACHED');

    const ghost = await assign(uuidv7());
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe('COMPANY_NOT_FOUND');

    expect(
      await eventTypes({ userId: admin.id, type: 'multi_admin.company_assigned' }),
    ).toHaveLength(2);
  });

  it('quita una empresa y avisa si no estaba asignada', async () => {
    const { app } = createTestApp();
    const { auth } = await platformAuth(app);
    const company = await createCompany(prisma);
    const other = await createCompany(prisma);
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id] });

    const res = await request(app)
      .delete(api(`/platform/multi-admins/${laura.id}/companies/${company.id}`))
      .set(auth)
      .expect(200);
    expect(res.body.data.companyCount).toBe(0);

    const missing = await request(app)
      .delete(api(`/platform/multi-admins/${laura.id}/companies/${other.id}`))
      .set(auth);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('MEMBERSHIP_NOT_FOUND');
    // La empresa y sus datos no se tocan
    expect(await prisma.company.count({ where: { id: company.id } })).toBe(1);
  });

  it('desactiva y reactiva; al desactivar sus sesiones mueren al instante', async () => {
    const { app } = createTestApp();
    const { auth } = await platformAuth(app);
    const laura = await createMultiAdmin(prisma);
    const session = await multiAdminSession(app, laura);

    await request(app).get(api('/auth/me')).set(session.auth).expect(200);
    await request(app)
      .patch(api(`/platform/multi-admins/${laura.id}/status`))
      .set(auth)
      .send({ status: 'inactive' })
      .expect(200);

    const dead = await request(app).get(api('/auth/me')).set(session.auth);
    expect(dead.status).toBe(401);
    const denied = await request(app)
      .post(api('/auth/login'))
      .send({ email: laura.email, password: DEFAULT_PASSWORD });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('USER_INACTIVE');

    await request(app)
      .patch(api(`/platform/multi-admins/${laura.id}/status`))
      .set(auth)
      .send({ status: 'active' })
      .expect(200);
    await login(app, laura.email, DEFAULT_PASSWORD);
  });

  it('restablece la contraseña y cierra sus sesiones', async () => {
    const { app } = createTestApp();
    const { auth } = await platformAuth(app);
    const laura = await createMultiAdmin(prisma);
    const session = await multiAdminSession(app, laura);

    const res = await request(app)
      .post(api(`/platform/multi-admins/${laura.id}/reset-password`))
      .set(auth)
      .expect(200);
    expect(res.body.data.temporaryPassword).toHaveLength(16);

    const dead = await request(app).get(api('/auth/me')).set(session.auth);
    expect(dead.status).toBe(401);
    const fresh = await login(app, laura.email, res.body.data.temporaryPassword);
    expect(fresh.user.mustChangePassword).toBe(true);

    const unknown = await request(app)
      .post(api(`/platform/multi-admins/${uuidv7()}/reset-password`))
      .set(auth);
    expect(unknown.status).toBe(404);
  });

  it('solo el admin global gestiona administradores multiempresa', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma);
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id] });
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    });

    for (const user of [laura, companyAdmin]) {
      const session = await login(app, user.email, DEFAULT_PASSWORD);
      const res = await request(app)
        .get(api('/platform/multi-admins'))
        .set(bearer(session.accessToken));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('Sesión y aislamiento del administrador multiempresa', () => {
  it('al entrar no tiene empresa activa y las rutas de empresa piden elegir una', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma);
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id] });
    const session = await multiAdminSession(app, laura);

    const me = await request(app).get(api('/auth/me')).set(session.auth).expect(200);
    expect(me.body.data).toMatchObject({ role: 'multi_company_admin', company: null });
    expect(me.body.data.permissions).toContain('portfolio.read');

    const blocked = await request(app).get(api('/company/employees')).set(session.auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('COMPANY_REQUIRED');
  });

  it('lista solo sus empresas y lo que le queda de su paquete', async () => {
    const { app } = createTestApp();
    const mine = await createCompany(prisma, { name: 'Zeta' });
    const alsoMine = await createCompany(prisma, { name: 'Alfa' });
    await createCompany(prisma, { name: 'Ajena' });
    const laura = await createMultiAdmin(prisma, {
      companyIds: [mine.id, alsoMine.id],
      maxCompanies: 4,
      maxEmployeesPerCompany: 12,
    });
    const session = await multiAdminSession(app, laura);

    const res = await request(app).get(api('/portfolio/companies')).set(session.auth).expect(200);
    expect(res.body.data.limits).toEqual({
      maxCompanies: 4,
      maxEmployeesPerCompany: 12,
      usedCompanies: 2,
    });
    expect((res.body.data.companies as { name: string }[]).map((item) => item.name)).toEqual([
      'Alfa',
      'Zeta',
    ]);
  });

  it('elige una empresa y trabaja como su admin, solo con los datos de esa empresa', async () => {
    const { app } = createTestApp();
    const a = await createCompany(prisma, { name: 'Empresa A' });
    const b = await createCompany(prisma, { name: 'Empresa B' });
    const { user: employeeA } = await createEmployee(prisma, a.id, { firstName: 'DeA' });
    const { user: employeeB } = await createEmployee(prisma, b.id, { firstName: 'DeB' });
    const laura = await createMultiAdmin(prisma, { companyIds: [a.id, b.id] });
    const session = await multiAdminSession(app, laura);

    const inA = bearer((await switchCompany(app, session.accessToken, a.id)).accessToken);
    const me = await request(app).get(api('/auth/me')).set(inA).expect(200);
    expect(me.body.data.company).toMatchObject({ id: a.id, name: 'Empresa A' });

    const listA = await request(app).get(api('/company/employees')).set(inA).expect(200);
    expect((listA.body.data as { userId: string }[]).map((item) => item.userId)).toEqual([
      employeeA.id,
    ]);

    // Un empleado de la otra empresa, aunque sea suya, no se ve con el token de A
    const peek = await request(app)
      .get(api(`/company/employees/${employeeB.id}`))
      .set(inA);
    expect(peek.status).toBe(404);

    const inB = bearer((await switchCompany(app, session.accessToken, b.id)).accessToken);
    const listB = await request(app).get(api('/company/employees')).set(inB).expect(200);
    expect((listB.body.data as { userId: string }[]).map((item) => item.userId)).toEqual([
      employeeB.id,
    ]);
  });

  it('en la empresa activa puede crear empleados y cambiar sus ajustes', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma);
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id] });
    const session = await multiAdminSession(app, laura);
    const auth = bearer((await switchCompany(app, session.accessToken, company.id)).accessToken);

    const created = await request(app)
      .post(api('/company/employees'))
      .set(auth)
      .send({ email: 'nuevo@empresa.com', firstName: 'Ana', lastName: 'López' })
      .expect(201);
    expect(created.body.data.employee.employeeCode).toMatch(/^[A-Z]{3}-0001$/);

    await request(app).patch(api('/company')).set(auth).send({ name: 'Nombre nuevo' }).expect(200);

    // Queda a nombre del admin multiempresa, no de uno de empresa
    const events = await prisma.securityEvent.findMany({
      where: { companyId: company.id, type: 'employee.created' },
    });
    expect(events.map((e) => e.userId)).toEqual([laura.id]);
  });

  it('no puede cambiar lo que es solo del admin global', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma, { maxEmployees: 10 });
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id] });
    const session = await multiAdminSession(app, laura);
    const auth = bearer((await switchCompany(app, session.accessToken, company.id)).accessToken);

    const limit = await request(app).patch(api('/company')).set(auth).send({ maxEmployees: 500 });
    expect(limit.status).toBe(400);
    const suspend = await request(app)
      .patch(api(`/platform/companies/${company.id}/status`))
      .set(auth)
      .send({ status: 'suspended' });
    expect(suspend.status).toBe(403);
    expect(
      (await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).maxEmployees,
    ).toBe(10);
  });

  it('una empresa ajena o inexistente responde 404 igual al elegirla', async () => {
    const { app } = createTestApp();
    const mine = await createCompany(prisma);
    const foreign = await createCompany(prisma);
    const laura = await createMultiAdmin(prisma, { companyIds: [mine.id] });
    const session = await multiAdminSession(app, laura);

    const pick = (companyId: string) =>
      request(app).post(api('/auth/active-company')).set(session.auth).send({ companyId });

    const ajena = await pick(foreign.id);
    const inexistente = await pick(uuidv7());
    expect(ajena.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(ajena.body.error.code).toBe('COMPANY_NOT_FOUND');
    expect({ ...ajena.body.error, requestId: '' }).toEqual({
      ...inexistente.body.error,
      requestId: '',
    });
  });

  it('puede volver a quedar sin empresa activa', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma);
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id] });
    const session = await multiAdminSession(app, laura);
    const inCompany = await switchCompany(app, session.accessToken, company.id);

    const back = await switchCompany(app, inCompany.accessToken, null);
    const me = await request(app).get(api('/auth/me')).set(bearer(back.accessToken)).expect(200);
    expect(me.body.data.company).toBeNull();
    expect(
      await eventTypes({ userId: laura.id, type: 'session.active_company_changed' }),
    ).toHaveLength(2);
  });

  it('un admin de empresa o un empleado no pueden elegir empresa', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma);
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    });
    const session = await login(app, companyAdmin.email, DEFAULT_PASSWORD);

    const res = await request(app)
      .post(api('/auth/active-company'))
      .set(bearer(session.accessToken))
      .send({ companyId: company.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('renovar la sesión conserva la empresa activa', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma, { name: 'Empresa A' });
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id] });
    const session = await multiAdminSession(app, laura);
    const inCompany = await switchCompany(app, session.accessToken, company.id);

    const refreshed = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: inCompany.refreshToken })
      .expect(200);

    const me = await request(app)
      .get(api('/auth/me'))
      .set(bearer(refreshed.body.data.accessToken))
      .expect(200);
    expect(me.body.data.company).toMatchObject({ id: company.id });
  });

  it('al quitarle la empresa, su sesión en ella deja de servir al instante y no se renueva', async () => {
    const { app } = createTestApp();
    const { auth: platform } = await platformAuth(app);
    const company = await createCompany(prisma);
    const other = await createCompany(prisma);
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id, other.id] });
    const session = await multiAdminSession(app, laura);
    const inCompany = await switchCompany(app, session.accessToken, company.id);
    const auth = bearer(inCompany.accessToken);

    await request(app).get(api('/company/employees')).set(auth).expect(200);
    await request(app)
      .delete(api(`/platform/multi-admins/${laura.id}/companies/${company.id}`))
      .set(platform)
      .expect(200);

    const dead = await request(app).get(api('/company/employees')).set(auth);
    expect(dead.status).toBe(401);
    expect(dead.body.error.code).toBe('SESSION_REVOKED');
    const refresh = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: inCompany.refreshToken });
    expect(refresh.status).toBe(401);

    // Sigue pudiendo entrar a la otra empresa que conserva
    await switchCompany(app, session.accessToken, other.id);
    const gone = await request(app)
      .post(api('/auth/active-company'))
      .set(session.auth)
      .send({ companyId: company.id });
    expect(gone.status).toBe(404);
  });

  it('si suspenden la empresa activa pierde el acceso a ella, no a las demás', async () => {
    const { app } = createTestApp();
    const { auth: platform } = await platformAuth(app);
    const company = await createCompany(prisma);
    const other = await createCompany(prisma);
    const laura = await createMultiAdmin(prisma, { companyIds: [company.id, other.id] });
    const session = await multiAdminSession(app, laura);
    const auth = bearer((await switchCompany(app, session.accessToken, company.id)).accessToken);

    await request(app)
      .patch(api(`/platform/companies/${company.id}/status`))
      .set(platform)
      .send({ status: 'suspended' })
      .expect(200);

    const denied = await request(app).get(api('/company/employees')).set(auth);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('COMPANY_SUSPENDED');
    const pick = await request(app)
      .post(api('/auth/active-company'))
      .set(session.auth)
      .send({ companyId: company.id });
    expect(pick.status).toBe(403);
    expect(pick.body.error.code).toBe('COMPANY_SUSPENDED');

    await switchCompany(app, session.accessToken, other.id);
  });

  it('la membresía de una persona no sirve a otra', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma);
    await createMultiAdmin(prisma, { companyIds: [company.id] });
    const intruder = await createMultiAdmin(prisma);
    const session = await multiAdminSession(app, intruder);

    const res = await request(app)
      .post(api('/auth/active-company'))
      .set(session.auth)
      .send({ companyId: company.id });
    expect(res.status).toBe(404);
  });
});

describe('Crear empresas dentro del paquete', () => {
  it('crea la empresa con su admin, con el máximo de empleados del paquete, y se la asigna', async () => {
    const { app } = createTestApp();
    const laura = await createMultiAdmin(prisma, { maxCompanies: 2, maxEmployeesPerCompany: 15 });
    const session = await multiAdminSession(app, laura);
    const adminEmail = `${uuidv7()}@sucursal.com`;

    const res = await request(app)
      .post(api('/portfolio/companies'))
      .set(session.auth)
      .send(newOwnCompany({ admin: { email: adminEmail, firstName: 'Juan', lastName: 'Pérez' } }))
      .expect(201);

    const { company, temporaryPassword } = res.body.data;
    expect(company).toMatchObject({ name: 'Sucursal Norte', maxEmployees: 15, status: 'active' });
    expect(company.admin.email).toBe(adminEmail);
    expect(temporaryPassword).toHaveLength(16);

    const membership = await prisma.companyMembership.findMany({ where: { userId: laura.id } });
    expect(membership.map((m) => m.companyId)).toEqual([company.id]);
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    expect(stored).toMatchObject({ role: 'company_admin', companyId: company.id });
    expect(
      await eventTypes({
        userId: laura.id,
        companyId: company.id,
        type: 'multi_admin.company_assigned',
      }),
    ).toHaveLength(1);

    // La nueva empresa aparece en su lista y puede trabajar en ella
    const mine = await request(app).get(api('/portfolio/companies')).set(session.auth).expect(200);
    expect(mine.body.data.limits.usedCompanies).toBe(1);
    await switchCompany(app, session.accessToken, company.id);
  });

  it('no pasa de su máximo de empresas, contando las asignadas por el admin global', async () => {
    const { app } = createTestApp();
    const existing = await createCompany(prisma);
    const laura = await createMultiAdmin(prisma, { companyIds: [existing.id], maxCompanies: 2 });
    const session = await multiAdminSession(app, laura);
    const create = () =>
      request(app).post(api('/portfolio/companies')).set(session.auth).send(newOwnCompany());

    await create().expect(201);
    const over = await create();
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('MAX_COMPANIES_REACHED');
    expect(await prisma.company.count()).toBe(2);
    expect(await prisma.companyMembership.count({ where: { userId: laura.id } })).toBe(2);
  });

  it('dos altas a la vez no pasan del máximo', async () => {
    const { app } = createTestApp();
    const laura = await createMultiAdmin(prisma, { maxCompanies: 1 });
    const session = await multiAdminSession(app, laura);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app).post(api('/portfolio/companies')).set(session.auth).send(newOwnCompany()),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await prisma.company.count()).toBe(1);
  });

  it('un email ya registrado no deja una empresa a medias', async () => {
    const { app } = createTestApp();
    const laura = await createMultiAdmin(prisma);
    const session = await multiAdminSession(app, laura);
    const taken0 = await createCompany(prisma);
    await createUser(prisma, {
      role: Role.EMPLOYEE,
      companyId: taken0.id,
      email: 'ocupado@sucursal.com',
    });

    const res = await request(app)
      .post(api('/portfolio/companies'))
      .set(session.auth)
      .send(
        newOwnCompany({
          admin: { email: 'ocupado@sucursal.com', firstName: 'Juan', lastName: 'Pérez' },
        }),
      );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    // Solo queda la empresa que usa el fixture para ocupar el email
    expect(await prisma.company.count()).toBe(1);
    expect(await prisma.companyMembership.count()).toBe(0);
  });

  it('un admin de empresa o el admin global no pueden crear empresas por esta ruta', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma);
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    });
    const { auth } = await platformAuth(app);
    const adminSession = await login(app, companyAdmin.email, DEFAULT_PASSWORD);

    for (const headers of [bearer(adminSession.accessToken), auth]) {
      const res = await request(app)
        .post(api('/portfolio/companies'))
        .set(headers)
        .send(newOwnCompany());
      expect(res.status).toBe(403);
    }
  });
});

describe('Reglas de la base de datos', () => {
  async function expectRejected(operation: Promise<unknown>, text: string) {
    const error: unknown = await operation.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error, `se esperaba un rechazo con ${text}`).not.toBeNull();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).toContain(text);
  }

  it('solo un usuario multiempresa puede tener membresías o límites', async () => {
    const company = await createCompany(prisma);
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    });

    await expectRejected(
      prisma.companyMembership.create({ data: { userId: companyAdmin.id, companyId: company.id } }),
      'assert_multi_company_admin',
    );
    await expectRejected(
      prisma.multiCompanyAdmin.create({
        data: { userId: companyAdmin.id, maxCompanies: 1, maxEmployeesPerCompany: 1 },
      }),
      'assert_multi_company_admin',
    );
  });

  it('el rol decide si el usuario tiene empresa propia', async () => {
    const company = await createCompany(prisma);
    const data = { passwordHash: 'x', firstName: 'T', lastName: 'U' };

    await expectRejected(
      prisma.user.create({
        data: {
          id: uuidv7(),
          email: 'a@t.com',
          role: 'multi_company_admin',
          companyId: company.id,
          ...data,
        },
      }),
      'users_company_matches_role',
    );
    await expectRejected(
      prisma.user.create({
        data: { id: uuidv7(), email: 'b@t.com', role: 'company_admin', companyId: null, ...data },
      }),
      'users_company_matches_role',
    );
  });

  it('los límites del paquete tienen un rango válido', async () => {
    const user = await createUser(prisma, { role: 'multi_company_admin' });
    await expectRejected(
      prisma.multiCompanyAdmin.create({
        data: { userId: user.id, maxCompanies: 0, maxEmployeesPerCompany: 5 },
      }),
      'multi_company_admins_limits',
    );
  });
});
