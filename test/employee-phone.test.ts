import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
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
  const auth = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  return { app, company, auth };
}

const body = (extra: Record<string, unknown> = {}) => ({
  email: `${uuidv7()}@empresa.com`,
  firstName: 'Ana',
  lastName: 'López',
  ...extra,
});

const create = (app: Express, auth: Record<string, string>, payload: object) =>
  request(app).post(api('/company/employees')).set(auth).send(payload);
const update = (app: Express, auth: Record<string, string>, id: string, payload: object) =>
  request(app)
    .patch(api(`/company/employees/${id}`))
    .set(auth)
    .send(payload);

describe('teléfono del empleado', () => {
  it('es opcional: un empleado sin teléfono lo trae en null', async () => {
    const { app, auth } = await setup();
    const res = await create(app, auth, body());
    expect(res.status).toBe(201);
    expect(res.body.data.employee.phone).toBeNull();
  });

  it('se guarda al crear, se ve en el detalle y en la lista, y se puede cambiar y quitar', async () => {
    const { app, auth } = await setup();
    const created = await create(app, auth, body({ phone: '  +52 (33) 1234-5678  ' }));
    expect(created.status).toBe(201);
    const id = created.body.data.employee.id as string;
    expect(created.body.data.employee.phone).toBe('+52 (33) 1234-5678');

    const detail = await request(app)
      .get(api(`/company/employees/${id}`))
      .set(auth);
    expect(detail.body.data.phone).toBe('+52 (33) 1234-5678');
    const list = await request(app).get(api('/company/employees')).set(auth);
    expect(list.body.data[0].phone).toBe('+52 (33) 1234-5678');

    const changed = await update(app, auth, id, { phone: '801.555.0199' });
    expect(changed.body.data.phone).toBe('801.555.0199');

    const nulled = await update(app, auth, id, { phone: null });
    expect(nulled.body.data.phone).toBeNull();
    await update(app, auth, id, { phone: '8015550199' });
    const cleared = await update(app, auth, id, { phone: '   ' });
    expect(cleared.body.data.phone).toBeNull();
  });

  it('no pisa el teléfono cuando se actualiza otro campo', async () => {
    const { app, auth } = await setup();
    const created = await create(app, auth, body({ phone: '8015550199' }));
    const id = created.body.data.employee.id as string;

    const res = await update(app, auth, id, { firstName: 'Mariana' });
    expect(res.body.data).toMatchObject({ firstName: 'Mariana', phone: '8015550199' });
  });

  it('rechaza teléfonos inválidos: letras, muy corto, muy largo o con símbolos raros', async () => {
    const { app, auth } = await setup();
    const created = await create(app, auth, body());
    const id = created.body.data.employee.id as string;

    for (const phone of [
      'llamar luego',
      '12345',
      'x'.repeat(31),
      '801-555-0199; DROP',
      '<b>8015550199</b>',
      '+++---...',
      '1'.repeat(31),
    ]) {
      expect((await create(app, auth, body({ phone }))).status, phone).toBe(400);
      expect((await update(app, auth, id, { phone })).status, phone).toBe(400);
    }
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect(stored.phone).toBeNull();
  });

  it('el código de error es estable', async () => {
    const { app, auth } = await setup();
    const res = await create(app, auth, body({ phone: 'abc' }));
    expect(res.body.error.code).toBe('INVALID_PHONE');
  });

  it('el mismo teléfono puede repetirse entre empleados', async () => {
    const { app, auth } = await setup();
    expect((await create(app, auth, body({ phone: '8015550199' }))).status).toBe(201);
    expect((await create(app, auth, body({ phone: '8015550199' }))).status).toBe(201);
  });

  it('la base de datos también limita el largo', async () => {
    const { company } = await setup();
    const { employee } = await createEmployee(prisma, company.id);
    await expect(
      prisma.employee.update({ where: { id: employee.id }, data: { phone: '123' } }),
    ).rejects.toThrow(/employees_phone_length/);
    await expect(
      prisma.employee.update({ where: { id: employee.id }, data: { phone: '1234567' } }),
    ).resolves.toBeTruthy();
  });

  it('un empleado de otra empresa no se toca', async () => {
    const { app, auth } = await setup();
    const other = await createCompany(prisma, { name: 'Otra' });
    const { employee: foreign } = await createEmployee(prisma, other.id);
    const res = await update(app, auth, foreign.id, { phone: '8015550199' });
    expect(res.status).toBe(404);
    expect(
      (await prisma.employee.findUniqueOrThrow({ where: { id: foreign.id } })).phone,
    ).toBeNull();
  });
});
