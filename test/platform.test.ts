import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import {
  createCompany,
  createUser,
  DEFAULT_PASSWORD,
  employeeCodeFor,
} from './helpers/fixtures.js';
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

async function platformSession(app: Express) {
  const admin = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
  const session = await login(app, admin.email, DEFAULT_PASSWORD);
  return { admin, auth: bearer(session.accessToken) };
}

const newCompany = (overrides: Record<string, unknown> = {}) => ({
  name: 'Taller Pérez',
  timezone: 'America/Denver',
  maxEmployees: 5,
  admin: { email: 'Juan@TallerPerez.com', firstName: 'Juan', lastName: 'Pérez' },
  ...overrides,
});

async function addActiveEmployees(companyId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const user = await createUser(prisma, { role: Role.EMPLOYEE, companyId });
    await prisma.employee.create({
      data: {
        id: uuidv7(),
        companyId,
        userId: user.id,
        employeeCode: await employeeCodeFor(prisma, companyId),
      },
    });
  }
}

describe('Acceso a /platform', () => {
  it('solo el admin global puede usarlo', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma);
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    });
    const employee = await createUser(prisma, { role: Role.EMPLOYEE, companyId: company.id });

    for (const user of [companyAdmin, employee]) {
      const session = await login(app, user.email, DEFAULT_PASSWORD);
      const res = await request(app)
        .get(api('/platform/companies'))
        .set(bearer(session.accessToken));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    await request(app).get(api('/platform/companies')).expect(401);
  });
});

describe('POST /platform/companies', () => {
  it('crea la empresa con su admin, que puede entrar con la contraseña temporal', async () => {
    const { app, clock } = createTestApp();
    const { admin: platformAdmin, auth } = await platformSession(app);

    const res = await request(app)
      .post(api('/platform/companies'))
      .set(auth)
      .send(newCompany({ name: '  Taller   Pérez ' }))
      .expect(201);

    const { company, temporaryPassword, temporaryPasswordExpiresAt } = res.body.data;
    expect(company).toMatchObject({
      name: 'Taller Pérez',
      timezone: 'America/Denver',
      maxEmployees: 5,
      activeEmployees: 0,
      status: 'active',
      admin: {
        email: 'juan@tallerperez.com',
        firstName: 'Juan',
        status: 'active',
        lastLoginAt: null,
      },
    });
    expect(temporaryPassword).toHaveLength(16);
    expect(new Date(temporaryPasswordExpiresAt).getTime()).toBe(
      clock.now().getTime() + 72 * 3_600_000,
    );

    const session = await login(app, 'juan@tallerperez.com', temporaryPassword);
    expect(session.user.mustChangePassword).toBe(true);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: 'juan@tallerperez.com' },
    });
    expect(stored.passwordHash).not.toContain(temporaryPassword);
    expect(stored.role).toBe('company_admin');

    const event = await prisma.securityEvent.findFirst({ where: { type: 'company.created' } });
    expect(event).toMatchObject({ userId: platformAdmin.id, companyId: company.id });
  });

  it('la contraseña temporal vence a las 72 horas', async () => {
    const { app, clock } = createTestApp();
    const { auth } = await platformSession(app);
    const res = await request(app).post(api('/platform/companies')).set(auth).send(newCompany());

    clock.advance(73 * 3_600_000);
    const attempt = await request(app)
      .post(api('/auth/login'))
      .send({ email: 'juan@tallerperez.com', password: res.body.data.temporaryPassword });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.code).toBe('TEMPORARY_PASSWORD_EXPIRED');
  });

  it('rechaza un email ya registrado sin crear la empresa', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    await request(app).post(api('/platform/companies')).set(auth).send(newCompany()).expect(201);

    const res = await request(app)
      .post(api('/platform/companies'))
      .set(auth)
      .send(newCompany({ name: 'Otra empresa' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(await prisma.company.count()).toBe(1);
  });

  it('sin zona horaria usa America/Denver (Salt Lake City, Utah)', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const body: Record<string, unknown> = newCompany();
    delete body.timezone;

    const res = await request(app).post(api('/platform/companies')).set(auth).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.company.timezone).toBe('America/Denver');
  });

  it('rechaza una zona horaria inválida', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const res = await request(app)
      .post(api('/platform/companies'))
      .set(auth)
      .send(newCompany({ timezone: 'Mexico/Inventada' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIMEZONE');
  });

  it('valida el cuerpo: campos obligatorios, límites y campos extra', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const post = (body: object) =>
      request(app).post(api('/platform/companies')).set(auth).send(body);

    await post({ name: 'X' }).expect(400);
    await post(newCompany({ maxEmployees: 0 })).expect(400);
    await post(newCompany({ status: 'suspended' })).expect(400);
    await post(
      newCompany({
        admin: { email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'platform_admin' },
      }),
    ).expect(400);
  });
});

describe('GET /platform/companies', () => {
  it('lista con paginación, búsqueda y filtro de estado', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    await createCompany(prisma, { name: 'Panadería Sol' });
    await createCompany(prisma, { name: 'Taller Luna' });
    await createCompany(prisma, { name: 'Panadería Luna', status: 'suspended' });

    const all = await request(app).get(api('/platform/companies?limit=2')).set(auth).expect(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const search = await request(app).get(api('/platform/companies?search=panader')).set(auth);
    const names = (search.body.data as { name: string }[]).map((c) => c.name);
    expect(names.sort()).toEqual(['Panadería Luna', 'Panadería Sol']);

    const suspended = await request(app).get(api('/platform/companies?status=suspended')).set(auth);
    expect(suspended.body.meta.total).toBe(1);
  });

  it('cuenta solo los empleados activos', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const company = await createCompany(prisma);
    await addActiveEmployees(company.id, 2);
    const inactive = await createUser(prisma, {
      role: Role.EMPLOYEE,
      companyId: company.id,
      status: 'inactive',
    });
    await prisma.employee.create({
      data: {
        id: uuidv7(),
        companyId: company.id,
        userId: inactive.id,
        employeeCode: await employeeCodeFor(prisma, company.id),
      },
    });

    const res = await request(app)
      .get(api(`/platform/companies/${company.id}`))
      .set(auth);
    expect(res.body.data.activeEmployees).toBe(2);
  });

  it('empresa inexistente → 404; id mal formado → 400', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const missing = await request(app)
      .get(api(`/platform/companies/${uuidv7()}`))
      .set(auth);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('COMPANY_NOT_FOUND');
    await request(app).get(api('/platform/companies/123')).set(auth).expect(400);
  });
});

describe('PATCH /platform/companies/:id', () => {
  it('actualiza solo los campos enviados', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const company = await createCompany(prisma, { name: 'Original' });

    const res = await request(app)
      .patch(api(`/platform/companies/${company.id}`))
      .set(auth)
      .send({ maxEmployees: 50 })
      .expect(200);
    expect(res.body.data).toMatchObject({ name: 'Original', maxEmployees: 50 });
  });

  it('no permite bajar el límite por debajo de los empleados activos', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const company = await createCompany(prisma, { maxEmployees: 10 });
    await addActiveEmployees(company.id, 3);

    const res = await request(app)
      .patch(api(`/platform/companies/${company.id}`))
      .set(auth)
      .send({ maxEmployees: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MAX_EMPLOYEES_BELOW_ACTIVE');

    await request(app)
      .patch(api(`/platform/companies/${company.id}`))
      .set(auth)
      .send({ maxEmployees: 3 })
      .expect(200);
  });

  it('exige al menos un campo', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const company = await createCompany(prisma);
    await request(app)
      .patch(api(`/platform/companies/${company.id}`))
      .set(auth)
      .send({})
      .expect(400);
  });
});

describe('PATCH /platform/companies/:id/status', () => {
  it('suspender corta el acceso de sus usuarios al instante; reactivar lo devuelve', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const company = await createCompany(prisma);
    const employee = await createUser(prisma, { role: Role.EMPLOYEE, companyId: company.id });
    const session = await login(app, employee.email, DEFAULT_PASSWORD);

    await request(app)
      .patch(api(`/platform/companies/${company.id}/status`))
      .set(auth)
      .send({ status: 'suspended' })
      .expect(200);

    const blocked = await request(app).get(api('/auth/me')).set(bearer(session.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('COMPANY_SUSPENDED');

    await request(app)
      .patch(api(`/platform/companies/${company.id}/status`))
      .set(auth)
      .send({ status: 'active' })
      .expect(200);
    await request(app).get(api('/auth/me')).set(bearer(session.accessToken)).expect(200);

    const types = (await prisma.securityEvent.findMany({ where: { companyId: company.id } })).map(
      (e) => e.type,
    );
    expect(types).toEqual(expect.arrayContaining(['company.suspended', 'company.reactivated']));
  });

  it('es idempotente', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const company = await createCompany(prisma);
    for (let i = 0; i < 2; i++) {
      await request(app)
        .patch(api(`/platform/companies/${company.id}/status`))
        .set(auth)
        .send({ status: 'active' })
        .expect(200);
    }
    expect(await prisma.securityEvent.count({ where: { companyId: company.id } })).toBe(0);
  });
});

describe('POST /platform/companies/:id/admin/reset-password', () => {
  it('genera una temporal nueva, cierra las sesiones del admin y lo desbloquea', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const company = await createCompany(prisma);
    const companyAdmin = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    });
    const oldSession = await login(app, companyAdmin.email, DEFAULT_PASSWORD);
    await prisma.user.update({
      where: { id: companyAdmin.id },
      data: { lockedUntil: new Date('2099-01-01') },
    });

    const res = await request(app)
      .post(api(`/platform/companies/${company.id}/admin/reset-password`))
      .set(auth)
      .expect(200);
    const { temporaryPassword, admin } = res.body.data;
    expect(admin.id).toBe(companyAdmin.id);

    await request(app).get(api('/auth/me')).set(bearer(oldSession.accessToken)).expect(401);
    await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: oldSession.refreshToken })
      .expect(401);

    await request(app)
      .post(api('/auth/login'))
      .send({ email: companyAdmin.email, password: DEFAULT_PASSWORD })
      .expect(401);
    const fresh = await login(app, companyAdmin.email, temporaryPassword);
    expect(fresh.user.mustChangePassword).toBe(true);
  });

  it('empresa sin admin → 404 COMPANY_ADMIN_NOT_FOUND', async () => {
    const { app } = createTestApp();
    const { auth } = await platformSession(app);
    const company = await createCompany(prisma);
    const res = await request(app)
      .post(api(`/platform/companies/${company.id}/admin/reset-password`))
      .set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMPANY_ADMIN_NOT_FOUND');
  });
});
