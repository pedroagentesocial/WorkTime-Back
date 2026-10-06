import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DomainEvent } from '#shared/domain/domain-event.js';
import { Role } from '#shared/domain/permissions.js';
import { WorkforceEvents } from '#modules/workforce/domain/events.js';
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

async function companyAdminSession(app: Express, options: { maxEmployees?: number } = {}) {
  const company = await createCompany(prisma, { maxEmployees: options.maxEmployees ?? 10 });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const session = await login(app, admin.email, DEFAULT_PASSWORD);
  return { company, admin, auth: bearer(session.accessToken) };
}

const newEmployee = (overrides: Record<string, unknown> = {}) => ({
  email: `${uuidv7()}@empresa.com`,
  firstName: 'Ana',
  lastName: 'López',
  ...overrides,
});

async function createEmployeeVia(
  app: Express,
  auth: Record<string, string>,
  body: object = newEmployee(),
) {
  const res = await request(app).post(api('/company/employees')).set(auth).send(body);
  if (res.status !== 201)
    throw new Error(`alta falló (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as {
    employee: { id: string; userId: string; email: string; employeeCode: string };
    temporaryPassword: string;
  };
}

describe('Acceso a /company', () => {
  it('solo el admin de empresa; el empleado y el admin global reciben 403', async () => {
    const { app } = createTestApp();
    const { company } = await companyAdminSession(app);
    const employee = await createUser(prisma, { role: Role.EMPLOYEE, companyId: company.id });
    const platform = await createUser(prisma, { role: Role.PLATFORM_ADMIN });

    for (const user of [employee, platform]) {
      const session = await login(app, user.email, DEFAULT_PASSWORD);
      for (const path of ['/company', '/company/employees']) {
        const res = await request(app).get(api(path)).set(bearer(session.accessToken));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
  });
});

describe('/company (configuración)', () => {
  it('muestra los datos de SU empresa', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminSession(app);
    const res = await request(app).get(api('/company')).set(auth).expect(200);
    expect(res.body.data).toEqual({
      id: company.id,
      code: company.code,
      employeeCodePrefix: company.employeeCodePrefix,
      name: company.name,
      timezone: 'America/Denver',
      status: 'active',
      dailyLimitMinutes: null,
      requireDailyReport: false,
      maxEmployees: 10,
      activeEmployees: 0,
    });
  });

  it('puede cambiar nombre y zona horaria, pero NO el límite ni el estado', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);

    const res = await request(app)
      .patch(api('/company'))
      .set(auth)
      .send({ name: 'Nuevo Nombre', timezone: 'America/Mexico_City' })
      .expect(200);
    expect(res.body.data).toMatchObject({ name: 'Nuevo Nombre', timezone: 'America/Mexico_City' });

    await request(app).patch(api('/company')).set(auth).send({ maxEmployees: 999 }).expect(400);
    await request(app).patch(api('/company')).set(auth).send({ status: 'active' }).expect(400);
    const bad = await request(app).patch(api('/company')).set(auth).send({ timezone: 'Utah' });
    expect(bad.body.error.code).toBe('INVALID_TIMEZONE');
  });
});

describe('POST /company/employees', () => {
  it('crea el empleado; entra con la contraseña temporal y hereda la zona de la empresa', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminSession(app);

    const res = await request(app)
      .post(api('/company/employees'))
      .set(auth)
      .send(newEmployee({ email: ' Ana@Empresa.com ', hiredAt: '2026-05-04' }))
      .expect(201);

    const { employee, temporaryPassword } = res.body.data;
    expect(employee).toMatchObject({
      email: 'ana@empresa.com',
      firstName: 'Ana',
      employeeCode: expect.stringMatching(/^[A-Z]{3}-0001$/),
      hiredAt: '2026-05-04',
      timezone: null,
      effectiveTimezone: 'America/Denver',
      status: 'active',
      mustChangePassword: true,
    });

    const session = await login(app, 'ana@empresa.com', temporaryPassword);
    expect(session.user.mustChangePassword).toBe(true);
    const me = await request(app).get(api('/auth/me')).set(bearer(session.accessToken));
    expect(me.body.data).toMatchObject({ role: 'employee', company: { id: company.id } });
  });

  it('un empleado en Guadalajara tiene su propia zona', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const { employee } = await createEmployeeVia(
      app,
      auth,
      newEmployee({ timezone: 'America/Mexico_City' }),
    );
    const res = await request(app)
      .get(api(`/company/employees/${employee.id}`))
      .set(auth);
    expect(res.body.data).toMatchObject({
      timezone: 'America/Mexico_City',
      effectiveTimezone: 'America/Mexico_City',
    });
  });

  it('respeta el límite de empleados activos', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app, { maxEmployees: 2 });
    await createEmployeeVia(app, auth);
    await createEmployeeVia(app, auth);

    const res = await request(app).post(api('/company/employees')).set(auth).send(newEmployee());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'EMPLOYEE_LIMIT_REACHED',
      details: { maxEmployees: 2, activeEmployees: 2 },
    });
  });

  it('altas simultáneas NO pueden rebasar el límite', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminSession(app, { maxEmployees: 2 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(api('/company/employees')).set(auth).send(newEmployee()),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await prisma.employee.count({ where: { companyId: company.id } })).toBe(2);
  });

  it('email repetido (aunque sea de otra empresa) → 409 EMAIL_TAKEN', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const other = await createCompany(prisma);
    await createUser(prisma, { role: Role.EMPLOYEE, companyId: other.id, email: 'usado@x.com' });

    const res = await request(app)
      .post(api('/company/employees'))
      .set(auth)
      .send(newEmployee({ email: 'usado@x.com' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('valida zona horaria, fecha y campos no permitidos', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const post = (body: object) =>
      request(app).post(api('/company/employees')).set(auth).send(body);

    expect((await post(newEmployee({ timezone: 'Sinaloa' }))).body.error.code).toBe(
      'INVALID_TIMEZONE',
    );
    await post(newEmployee({ employeeCode: 'EMP-001' })).expect(400);
    await post(newEmployee({ hiredAt: '04/05/2026' })).expect(400);
    await post(newEmployee({ role: 'company_admin' })).expect(400);
    await post(newEmployee({ companyId: uuidv7() })).expect(400);
  });
});

describe('Aislamiento entre empresas', () => {
  it('un admin no puede ver, editar, desactivar ni resetear empleados de otra empresa', async () => {
    const { app } = createTestApp();
    const a = await companyAdminSession(app);
    const b = await companyAdminSession(app);
    const { employee: ofB } = await createEmployeeVia(app, b.auth);

    const attempts = [
      request(app)
        .get(api(`/company/employees/${ofB.id}`))
        .set(a.auth),
      request(app)
        .patch(api(`/company/employees/${ofB.id}`))
        .set(a.auth)
        .send({ firstName: 'X' }),
      request(app)
        .patch(api(`/company/employees/${ofB.id}/status`))
        .set(a.auth)
        .send({ status: 'inactive' }),
      request(app)
        .post(api(`/company/employees/${ofB.id}/reset-password`))
        .set(a.auth),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
    }

    const list = await request(app).get(api('/company/employees')).set(a.auth);
    expect(list.body.meta.total).toBe(0);

    const intact = await prisma.user.findUniqueOrThrow({ where: { id: ofB.userId } });
    expect(intact).toMatchObject({ firstName: 'Ana', status: 'active' });
  });
});

describe('GET /company/employees', () => {
  it('lista con búsqueda (nombre, email, código), filtro de estado y paginación', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    await createEmployeeVia(app, auth, newEmployee({ firstName: 'Carlos', lastName: 'Ruiz' }));
    await createEmployeeVia(app, auth, newEmployee({ firstName: 'Beatriz', lastName: 'Álvarez' }));
    const { employee } = await createEmployeeVia(
      app,
      auth,
      newEmployee({ firstName: 'Daniel', lastName: 'Soto' }),
    );
    await request(app)
      .patch(api(`/company/employees/${employee.id}/status`))
      .set(auth)
      .send({ status: 'inactive' });

    const page1 = await request(app).get(api('/company/employees?limit=2')).set(auth);
    expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const code = (employee as { employeeCode: string }).employeeCode;
    const byCode = await request(app)
      .get(api(`/company/employees?search=${code.toLowerCase()}`))
      .set(auth);
    expect(byCode.body.data).toHaveLength(1);

    const active = await request(app).get(api('/company/employees?status=active')).set(auth);
    expect(active.body.meta.total).toBe(2);
  });
});

describe('PATCH /company/employees/:id', () => {
  it('edita solo lo enviado; timezone null vuelve a heredar la de la empresa', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const { employee } = await createEmployeeVia(
      app,
      auth,
      newEmployee({ timezone: 'America/Mazatlan' }),
    );

    const res = await request(app)
      .patch(api(`/company/employees/${employee.id}`))
      .set(auth)
      .send({ lastName: 'Pérez', timezone: null })
      .expect(200);
    expect(res.body.data).toMatchObject({
      firstName: 'Ana',
      lastName: 'Pérez',
      timezone: null,
      effectiveTimezone: 'America/Denver',
    });
  });

  it('no permite cambiar el email ni el estado por aquí', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const { employee } = await createEmployeeVia(app, auth);
    for (const body of [{ email: 'otro@x.com' }, { status: 'inactive' }, {}]) {
      await request(app)
        .patch(api(`/company/employees/${employee.id}`))
        .set(auth)
        .send(body)
        .expect(400);
    }
  });
});

describe('PATCH /company/employees/:id/status', () => {
  it('desactivar corta el acceso al instante, publica el evento y conserva el historial', async () => {
    const { app, container } = createTestApp();
    const published: DomainEvent[] = [];
    container.cradle.eventBus.subscribe(WorkforceEvents.EMPLOYEE_DEACTIVATED, async (event) => {
      published.push(event);
    });

    const { company, auth } = await companyAdminSession(app);
    const { employee, temporaryPassword } = await createEmployeeVia(app, auth);
    const session = await login(app, employee.email, temporaryPassword);

    await request(app)
      .patch(api(`/company/employees/${employee.id}/status`))
      .set(auth)
      .send({ status: 'inactive' })
      .expect(200);

    await request(app).get(api('/auth/me')).set(bearer(session.accessToken)).expect(401);
    const refresh = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(403);
    expect(refresh.body.error.code).toBe('USER_INACTIVE');
    const relogin = await request(app)
      .post(api('/auth/login'))
      .send({ email: employee.email, password: temporaryPassword });
    expect(relogin.body.error.code).toBe('USER_INACTIVE');

    expect(published).toHaveLength(1);
    expect(published[0]!.payload).toEqual({
      companyId: company.id,
      employeeId: employee.id,
      userId: employee.userId,
      deactivatedBy: expect.any(String),
    });
    expect(await prisma.employee.count({ where: { id: employee.id } })).toBe(1);
  });

  it('reactivar solo si hay lugar dentro del límite', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app, { maxEmployees: 1 });
    const { employee: first } = await createEmployeeVia(app, auth);
    await request(app)
      .patch(api(`/company/employees/${first.id}/status`))
      .set(auth)
      .send({ status: 'inactive' });
    await createEmployeeVia(app, auth);

    const res = await request(app)
      .patch(api(`/company/employees/${first.id}/status`))
      .set(auth)
      .send({ status: 'active' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMPLOYEE_LIMIT_REACHED');
  });

  it('un empleado reactivado puede volver a entrar', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const { employee, temporaryPassword } = await createEmployeeVia(app, auth);
    const setStatus = (status: string) =>
      request(app)
        .patch(api(`/company/employees/${employee.id}/status`))
        .set(auth)
        .send({ status })
        .expect(200);

    await setStatus('inactive');
    await setStatus('active');
    await login(app, employee.email, temporaryPassword);
  });
});

describe('POST /company/employees/:id/reset-password', () => {
  it('nueva temporal: la vieja deja de servir y se cierran sus sesiones', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const { employee, temporaryPassword: first } = await createEmployeeVia(app, auth);
    const oldSession = await login(app, employee.email, first);

    const res = await request(app)
      .post(api(`/company/employees/${employee.id}/reset-password`))
      .set(auth)
      .expect(200);
    const second = res.body.data.temporaryPassword as string;
    expect(second).not.toBe(first);

    await request(app).get(api('/auth/me')).set(bearer(oldSession.accessToken)).expect(401);
    await request(app)
      .post(api('/auth/login'))
      .send({ email: employee.email, password: first })
      .expect(401);
    await login(app, employee.email, second);
  });
});

describe('fecha de ingreso automática', () => {
  it('sin hiredAt se registra el día del alta en la zona horaria del empleado', async () => {
    const { app, clock } = createTestApp();
    clock.advance(new Date('2026-10-08T03:00:00Z').getTime() - clock.now().getTime());
    const { auth } = await companyAdminSession(app);

    const inherited = await createEmployeeVia(app, auth);
    const madrid = await createEmployeeVia(app, auth, newEmployee({ timezone: 'Europe/Madrid' }));

    const get = async (id: string) =>
      (
        await request(app)
          .get(api(`/company/employees/${id}`))
          .set(auth)
          .expect(200)
      ).body.data;
    expect((await get(inherited.employee.id)).hiredAt).toBe('2026-10-07');
    expect((await get(madrid.employee.id)).hiredAt).toBe('2026-10-08');
  });

  it('una fecha explícita sigue mandando', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminSession(app);
    const created = await createEmployeeVia(app, auth, newEmployee({ hiredAt: '2024-02-29' }));
    expect(created.employee).toMatchObject({ hiredAt: '2024-02-29' });
  });
});
