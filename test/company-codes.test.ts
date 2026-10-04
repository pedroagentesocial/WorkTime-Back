import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import {
  companyIdentifiers,
  createCompany,
  createEmployee,
  createUser,
  DEFAULT_PASSWORD,
} from './helpers/fixtures.js';
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

const COMPANY_CODE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const PREFIX = /^[A-Z]{3}$/;

async function platformAuth(app: Express) {
  const admin = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
  return bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
}

const newCompany = (name = 'Taller Pérez') => ({
  name,
  maxEmployees: 20,
  admin: { email: `${uuidv7()}@taller.com`, firstName: 'Juan', lastName: 'Pérez' },
});

const createCompanyVia = (app: Express, auth: Record<string, string>, name?: string) =>
  request(app).post(api('/platform/companies')).set(auth).send(newCompany(name));

async function companyAdminOf(app: Express) {
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const auth = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  return { company, auth };
}

const addEmployee = (app: Express, auth: Record<string, string>, extra: object = {}) =>
  request(app)
    .post(api('/company/employees'))
    .set(auth)
    .send({ email: `${uuidv7()}@empresa.com`, firstName: 'Ana', lastName: 'López', ...extra });

describe('código de la empresa', () => {
  it('se genera al crear la empresa y trae el formato esperado', async () => {
    const { app } = createTestApp();
    const auth = await platformAuth(app);

    const res = await createCompanyVia(app, auth);
    expect(res.status).toBe(201);
    expect(res.body.data.company.code).toMatch(COMPANY_CODE);
    expect(res.body.data.company.employeeCodePrefix).toMatch(PREFIX);

    const id = res.body.data.company.id as string;
    const detail = await request(app)
      .get(api(`/platform/companies/${id}`))
      .set(auth);
    expect(detail.body.data.code).toBe(res.body.data.company.code);
    const list = await request(app).get(api('/platform/companies')).set(auth);
    expect(list.body.data[0]).toMatchObject({
      code: res.body.data.company.code,
      employeeCodePrefix: res.body.data.company.employeeCodePrefix,
    });
  });

  it('cada empresa recibe un código y un prefijo distintos', async () => {
    const { app } = createTestApp();
    const auth = await platformAuth(app);
    for (let i = 0; i < 6; i += 1) {
      expect((await createCompanyVia(app, auth, `Empresa ${i}`)).status).toBe(201);
    }

    const rows = await prisma.company.findMany({
      select: { code: true, employeeCodePrefix: true },
    });
    expect(new Set(rows.map((r) => r.code)).size).toBe(6);
    expect(new Set(rows.map((r) => r.employeeCodePrefix)).size).toBe(6);
  });

  it('el admin global la encuentra buscando por código, en mayúsculas o minúsculas, o por prefijo', async () => {
    const { app } = createTestApp();
    const auth = await platformAuth(app);
    const a = (await createCompanyVia(app, auth, 'Alfa')).body.data.company;
    await createCompanyVia(app, auth, 'Beta');

    for (const search of [a.code, (a.code as string).toLowerCase(), a.employeeCodePrefix, 'Alf']) {
      const res = await request(app)
        .get(api(`/platform/companies?search=${encodeURIComponent(search as string)}`))
        .set(auth);
      const found = res.body.data as { id: string }[];
      expect(
        found.map((c) => c.id),
        search,
      ).toEqual([a.id]);
    }
  });

  it('el admin de la empresa y sus empleados la ven en su perfil y en los ajustes', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminOf(app);
    const { user } = await createEmployee(prisma, company.id);
    const asEmployee = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);

    const settings = await request(app).get(api('/company')).set(auth);
    expect(settings.body.data).toMatchObject({
      code: company.code,
      employeeCodePrefix: company.employeeCodePrefix,
    });
    for (const as of [auth, asEmployee]) {
      const me = await request(app).get(api('/auth/me')).set(as);
      expect(me.body.data.company).toMatchObject({ id: company.id, code: company.code });
    }
  });

  it('no se puede cambiar desde la API ni con PATCH /company', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminOf(app);
    for (const body of [{ code: 'AAAA-2222' }, { employeeCodePrefix: 'ZZZ' }]) {
      const res = await request(app).patch(api('/company')).set(auth).send(body);
      expect(res.status).toBe(400);
    }
    const platform = await platformAuth(app);
    const res = await request(app)
      .patch(api(`/platform/companies/${company.id}`))
      .set(platform)
      .send({ code: 'AAAA-2222' });
    expect(res.status).toBe(400);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).code).toBe(
      company.code,
    );
  });
});

describe('código de empleado', () => {
  it('es el prefijo de la empresa más un consecutivo que sube de uno en uno', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminOf(app);

    const codes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await addEmployee(app, auth);
      expect(res.status).toBe(201);
      codes.push(res.body.data.employee.employeeCode as string);
    }
    const stored = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(stored.employeeSequence).toBe(3);
    expect(codes).toEqual([
      `${company.employeeCodePrefix}-0001`,
      `${company.employeeCodePrefix}-0002`,
      `${company.employeeCodePrefix}-0003`,
    ]);
  });

  it('un número nunca se reutiliza, aunque el empleado se desactive', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminOf(app);
    await addEmployee(app, auth);
    const second = await addEmployee(app, auth);
    await request(app)
      .patch(api(`/company/employees/${second.body.data.employee.id}/status`))
      .set(auth)
      .send({ status: 'inactive' });

    const third = await addEmployee(app, auth);
    expect(third.body.data.employee.employeeCode).toBe(`${company.employeeCodePrefix}-0003`);
  });

  it('un alta que falla no gasta un número', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminOf(app);
    const first = await addEmployee(app, auth);
    const duplicated = await addEmployee(app, auth, { email: first.body.data.employee.email });
    expect(duplicated.status).toBe(409);

    const next = await addEmployee(app, auth);
    expect(next.body.data.employee.employeeCode).toBe(`${company.employeeCodePrefix}-0002`);
  });

  it('cada empresa lleva su propia cuenta', async () => {
    const { app } = createTestApp();
    const a = await companyAdminOf(app);
    const b = await companyAdminOf(app);
    await addEmployee(app, a.auth);
    await addEmployee(app, a.auth);

    const ofB = await addEmployee(app, b.auth);
    expect(ofB.body.data.employee.employeeCode).toBe(`${b.company.employeeCodePrefix}-0001`);
    expect(a.company.employeeCodePrefix).not.toBe(b.company.employeeCodePrefix);
  });

  it('altas simultáneas reciben números distintos y seguidos, sin huecos', async () => {
    const { app } = createTestApp();
    const { company, auth } = await companyAdminOf(app);

    const results = await Promise.all(Array.from({ length: 5 }, () => addEmployee(app, auth)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const codes = results.map((r) => r.body.data.employee.employeeCode as string).sort();
    expect(codes).toEqual([1, 2, 3, 4, 5].map((n) => `${company.employeeCodePrefix}-000${n}`));
  });

  it('no se puede mandar ni cambiar desde la API', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminOf(app);
    expect((await addEmployee(app, auth, { employeeCode: 'EMP-001' })).status).toBe(400);

    const created = await addEmployee(app, auth);
    const id = created.body.data.employee.id as string;
    const code = created.body.data.employee.employeeCode as string;
    const res = await request(app)
      .patch(api(`/company/employees/${id}`))
      .set(auth)
      .send({ employeeCode: 'EMP-001' });
    expect(res.status).toBe(400);
    const detail = await request(app)
      .get(api(`/company/employees/${id}`))
      .set(auth);
    expect(detail.body.data.employeeCode).toBe(code);
  });

  it('se puede buscar por código', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminOf(app);
    await addEmployee(app, auth);
    const second = await addEmployee(app, auth);
    const code = second.body.data.employee.employeeCode as string;

    const res = await request(app)
      .get(api(`/company/employees?search=${code.toLowerCase()}`))
      .set(auth);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(second.body.data.employee.id);
  });

  it('el código sale en la hoja de tiempo exportada', async () => {
    const { app } = createTestApp();
    const { auth } = await companyAdminOf(app);
    const created = await addEmployee(app, auth);

    const csv = await request(app).get(api('/company/timesheet/export')).set(auth);
    expect(csv.text).toContain(created.body.data.employee.employeeCode);
  });
});

describe('la base de datos protege los identificadores', () => {
  it('el código y el prefijo de una empresa no cambian', async () => {
    const company = await createCompany(prisma);
    await expect(
      prisma.company.update({ where: { id: company.id }, data: { code: 'AAAA-2222' } }),
    ).rejects.toThrow(/companies_identifiers_immutable/);
    await expect(
      prisma.company.update({ where: { id: company.id }, data: { employeeCodePrefix: 'ZZZ' } }),
    ).rejects.toThrow(/companies_identifiers_immutable/);
    await expect(
      prisma.company.update({ where: { id: company.id }, data: { name: 'Otro nombre' } }),
    ).resolves.toBeTruthy();
  });

  it('el consecutivo solo sube', async () => {
    const company = await createCompany(prisma);
    await prisma.company.update({ where: { id: company.id }, data: { employeeSequence: 5 } });
    await expect(
      prisma.company.update({ where: { id: company.id }, data: { employeeSequence: 4 } }),
    ).rejects.toThrow(/companies_identifiers_immutable/);
  });

  it('el código de un empleado no cambia', async () => {
    const company = await createCompany(prisma);
    const { employee } = await createEmployee(prisma, company.id);
    await expect(
      prisma.employee.update({ where: { id: employee.id }, data: { employeeCode: 'ZZZ-0099' } }),
    ).rejects.toThrow(/employees_code_immutable/);
    await expect(
      prisma.employee.update({ where: { id: employee.id }, data: { phone: '8015550199' } }),
    ).resolves.toBeTruthy();
  });

  it('rechaza formatos inválidos y repetidos', async () => {
    const company = await createCompany(prisma);
    const other = {
      ...companyIdentifiers(),
      id: uuidv7(),
      name: 'X',
      timezone: 'UTC',
      maxEmployees: 1,
    };

    await expect(prisma.company.create({ data: { ...other, code: 'abcd-1234' } })).rejects.toThrow(
      /companies_code_format/,
    );
    await expect(
      prisma.company.create({ data: { ...other, employeeCodePrefix: 'AB1' } }),
    ).rejects.toThrow(/companies_employee_code_prefix_format/);
    await expect(
      prisma.company.create({ data: { ...other, code: company.code } }),
    ).rejects.toThrow();
    await expect(
      prisma.company.create({ data: { ...other, employeeCodePrefix: company.employeeCodePrefix } }),
    ).rejects.toThrow();

    const user = await createUser(prisma, { role: Role.EMPLOYEE, companyId: company.id });
    await expect(
      prisma.employee.create({
        data: { id: uuidv7(), companyId: company.id, userId: user.id, employeeCode: 'EMP-1' },
      }),
    ).rejects.toThrow(/employees_employee_code_format/);
  });
});
