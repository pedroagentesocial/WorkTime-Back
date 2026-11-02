import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { createCompany, createUser, DEFAULT_PASSWORD } from './helpers/fixtures.js';
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();
const NEW_PASSWORD = 'Mi-Clave-Personal-2026';

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

async function setup() {
  const test = createTestApp();
  const company = await createCompany(prisma, { maxEmployees: 10 });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const auth = bearer((await login(test.app, admin.email, DEFAULT_PASSWORD)).accessToken);
  return { ...test, company, auth };
}

const createEmployee = (app: Express, auth: Record<string, string>, body: object) =>
  request(app)
    .post(api('/company/employees'))
    .set(auth)
    .send({ firstName: 'Ana', lastName: 'López', ...body });

const confirm = (app: Express, token: string) =>
  request(app).post(api('/auth/password-reset/confirm')).send({ token, newPassword: NEW_PASSWORD });

describe('Acceso de cuentas nuevas por correo', () => {
  it('al dar de alta, le llega un correo para crear su contraseña y nadie ve una temporal', async () => {
    const { app, auth, emails } = await setup();

    const res = await createEmployee(app, auth, { email: 'ana@acme.com' }).expect(201);
    expect(res.body.data).toMatchObject({
      delivery: 'email',
      emailSent: true,
      temporaryPassword: null,
    });
    expect(emails.sent[0]).toMatchObject({
      to: 'ana@acme.com',
      subject: 'Te damos la bienvenida a WorkTime',
    });
    expect(emails.sent[0]?.text).toContain('https://app.worktime.dev/crear-contrasena?token=');

    await confirm(app, emails.resetTokenFor('ana@acme.com')).expect(204);
    await login(app, 'ana@acme.com', NEW_PASSWORD);
  });

  it('con un correo de pruebas o si el admin la pide, usa la contraseña temporal', async () => {
    const { app, auth, emails } = await setup();

    const reserved = await createEmployee(app, auth, { email: 'beto@acme.test' }).expect(201);
    expect(reserved.body.data).toMatchObject({ delivery: 'temporary_password', emailSent: false });
    expect(reserved.body.data.temporaryPassword).toHaveLength(16);

    const chosen = await createEmployee(app, auth, {
      email: 'carla@acme.com',
      delivery: 'temporary_password',
    }).expect(201);
    expect(chosen.body.data.delivery).toBe('temporary_password');
    await login(app, 'carla@acme.com', chosen.body.data.temporaryPassword as string);
    expect(emails.sent).toHaveLength(0);
  });

  it('si el correo no sale lo avisa, y se puede reenviar con restablecer', async () => {
    const { app, auth, emails } = await setup();

    emails.failNext = true;
    const res = await createEmployee(app, auth, { email: 'dana@acme.com' }).expect(201);
    expect(res.body.data).toMatchObject({ delivery: 'email', emailSent: false });

    const id = res.body.data.employee.id as string;
    const again = await request(app)
      .post(api(`/company/employees/${id}/reset-password`))
      .set(auth)
      .expect(200);
    expect(again.body.data).toMatchObject({ delivery: 'email', emailSent: true });
    expect(emails.sent[0]?.text).toContain('/restablecer-contrasena?token=');
    await confirm(app, emails.resetTokenFor('dana@acme.com')).expect(204);
  });

  it('restablecer por correo deja sin servir la contraseña de antes', async () => {
    const { app, auth, emails } = await setup();
    const created = await createEmployee(app, auth, {
      email: 'eva@acme.com',
      delivery: 'temporary_password',
    }).expect(201);
    const first = created.body.data.temporaryPassword as string;

    await request(app)
      .post(api(`/company/employees/${created.body.data.employee.id as string}/reset-password`))
      .set(auth)
      .expect(200);
    const old = await request(app)
      .post(api('/auth/login'))
      .send({ email: 'eva@acme.com', password: first });
    expect(old.status).toBe(401);
    expect(emails.sent[0]?.subject).toBe('Tu administrador restableció tu contraseña de WorkTime');
  });

  it('el admin global invita por correo al admin de una empresa nueva y a un multiempresa', async () => {
    const { app, emails } = createTestApp();
    const platform = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    const auth = bearer((await login(app, platform.email, DEFAULT_PASSWORD)).accessToken);

    const company = await request(app)
      .post(api('/platform/companies'))
      .set(auth)
      .send({
        name: 'Taller Pérez',
        maxEmployees: 5,
        admin: { email: 'juan@taller.com', firstName: 'Juan', lastName: 'Pérez' },
      })
      .expect(201);
    expect(company.body.data).toMatchObject({ delivery: 'email', emailSent: true });

    const multi = await request(app)
      .post(api('/platform/multi-admins'))
      .set(auth)
      .send({
        email: 'laura@grupo.com',
        firstName: 'Laura',
        lastName: 'Gómez',
        maxCompanies: 2,
        maxEmployeesPerCompany: 10,
      })
      .expect(201);
    expect(multi.body.data).toMatchObject({ delivery: 'email', emailSent: true });
    expect(emails.sent.map((email) => email.to)).toEqual(['juan@taller.com', 'laura@grupo.com']);
  });
});
