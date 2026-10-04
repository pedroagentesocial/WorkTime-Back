import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { companyIdentifiers, employeeCodeFor } from './helpers/fixtures.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';

// La BD es la ultima linea de defensa: estas reglas se cumplen aunque la app tenga un bug

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

async function expectViolation(operation: Promise<unknown>, constraint: string): Promise<void> {
  const error: unknown = await operation.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `se esperaba violar ${constraint}`).not.toBeNull();
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).toContain(constraint);
}

async function createCompany(name = 'Empresa') {
  return prisma.company.create({
    data: {
      ...companyIdentifiers(),
      id: uuidv7(),
      name,
      timezone: 'America/Denver',
      maxEmployees: 10,
    },
  });
}

async function createUser(
  companyId: string | null,
  role: 'platform_admin' | 'company_admin' | 'employee',
  email = `${uuidv7()}@test.com`,
) {
  return prisma.user.create({
    data: {
      id: uuidv7(),
      companyId,
      email,
      passwordHash: 'x',
      role,
      firstName: 'Test',
      lastName: 'User',
    },
  });
}

async function createEmployee(companyId: string) {
  const user = await createUser(companyId, 'employee');
  return prisma.employee.create({
    data: {
      id: uuidv7(),
      companyId,
      userId: user.id,
      employeeCode: await employeeCodeFor(prisma, companyId),
    },
  });
}

describe('Restricciones de la base de datos', () => {
  describe('empresas', () => {
    it('max_employees debe ser mayor a 0', async () => {
      await expectViolation(
        prisma.company.create({
          data: {
            ...companyIdentifiers(),
            id: uuidv7(),
            name: 'X',
            timezone: 'UTC',
            maxEmployees: 0,
          },
        }),
        'companies_max_employees_positive',
      );
    });
  });

  describe('usuarios', () => {
    it('solo el admin global puede existir sin empresa', async () => {
      const company = await createCompany();
      await expectViolation(createUser(null, 'employee'), 'users_company_matches_role');
      await expectViolation(createUser(company.id, 'platform_admin'), 'users_company_matches_role');
      await expect(createUser(null, 'platform_admin')).resolves.toBeDefined();
    });

    it('el email se guarda en minúsculas y es único', async () => {
      const company = await createCompany();
      await expectViolation(
        createUser(company.id, 'employee', 'Ana@Test.com'),
        'users_email_lowercase',
      );
      await createUser(company.id, 'employee', 'ana@test.com');
      await expectViolation(createUser(company.id, 'employee', 'ana@test.com'), 'email');
    });

    it('una empresa solo puede tener un admin', async () => {
      const [a, b] = [await createCompany('A'), await createCompany('B')];
      await createUser(a.id, 'company_admin');
      await expect(createUser(b.id, 'company_admin')).resolves.toBeDefined();
      await expectViolation(
        createUser(a.id, 'company_admin'),
        'users_one_company_admin_per_company',
      );
    });
  });

  describe('aislamiento entre empresas', () => {
    it('un empleado no puede vincularse a un usuario de otra empresa', async () => {
      const [a, b] = [await createCompany('A'), await createCompany('B')];
      const userOfB = await createUser(b.id, 'employee');
      await expectViolation(
        prisma.employee.create({
          data: { id: uuidv7(), companyId: a.id, userId: userOfB.id, employeeCode: 'ZZZ-0001' },
        }),
        'employees_company_id_user_id_fkey',
      );
    });

    it('un registro de asistencia no puede apuntar a un empleado de otra empresa', async () => {
      const [a, b] = [await createCompany('A'), await createCompany('B')];
      const employeeOfB = await createEmployee(b.id);
      await expectViolation(
        prisma.timeEntry.create({
          data: {
            id: uuidv7(),
            companyId: a.id,
            employeeId: employeeOfB.id,
            clockInAt: new Date(),
            source: 'web',
            timezone: 'America/Denver',
            workDate: new Date('2026-01-01'),
          },
        }),
        'time_entries_company_id_employee_id_fkey',
      );
    });
  });

  describe('asistencia', () => {
    it('un empleado no puede tener dos entradas abiertas, pero sí varias cerradas', async () => {
      const company = await createCompany();
      const employee = await createEmployee(company.id);
      const entry = (clockOutAt: Date | null) =>
        prisma.timeEntry.create({
          data: {
            id: uuidv7(),
            companyId: company.id,
            employeeId: employee.id,
            clockInAt: new Date('2026-01-01T08:00:00Z'),
            clockOutAt,
            source: 'web',
            timezone: 'America/Denver',
            workDate: new Date('2026-01-01'),
          },
        });

      await entry(new Date('2026-01-01T12:00:00Z'));
      await entry(new Date('2026-01-01T17:00:00Z'));
      await entry(null);
      await expectViolation(entry(null), 'time_entries_one_open_per_employee');
    });

    it('dos marcajes simultáneos solo crean una entrada abierta', async () => {
      const company = await createCompany();
      const employee = await createEmployee(company.id);
      const clockIn = () =>
        prisma.timeEntry.create({
          data: {
            id: uuidv7(),
            companyId: company.id,
            employeeId: employee.id,
            clockInAt: new Date(),
            source: 'web',
            timezone: 'America/Denver',
            workDate: new Date('2026-01-01'),
          },
        });

      const results = await Promise.allSettled([clockIn(), clockIn(), clockIn()]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.timeEntry.count({ where: { clockOutAt: null } })).toBe(1);
    });

    it('la salida no puede ser anterior a la entrada', async () => {
      const company = await createCompany();
      const employee = await createEmployee(company.id);
      await expectViolation(
        prisma.timeEntry.create({
          data: {
            id: uuidv7(),
            companyId: company.id,
            employeeId: employee.id,
            clockInAt: new Date('2026-01-01T10:00:00Z'),
            clockOutAt: new Date('2026-01-01T09:00:00Z'),
            source: 'web',
            timezone: 'America/Denver',
            workDate: new Date('2026-01-01'),
          },
        }),
        'time_entries_clock_out_after_clock_in',
      );
    });

    it('una corrección exige motivo', async () => {
      const company = await createCompany();
      const admin = await createUser(company.id, 'company_admin');
      const employee = await createEmployee(company.id);
      const entry = await prisma.timeEntry.create({
        data: {
          id: uuidv7(),
          companyId: company.id,
          employeeId: employee.id,
          clockInAt: new Date('2026-01-01T08:00:00Z'),
          source: 'web',
          timezone: 'America/Denver',
          workDate: new Date('2026-01-01'),
        },
      });
      await expectViolation(
        prisma.timeEntryCorrection.create({
          data: {
            id: uuidv7(),
            companyId: company.id,
            timeEntryId: entry.id,
            correctedById: admin.id,
            previousClockInAt: entry.clockInAt,
            newClockInAt: entry.clockInAt,
            reason: '   ',
          },
        }),
        'time_entry_corrections_reason_not_blank',
      );
    });
  });

  describe('historial', () => {
    it('no se puede borrar una empresa con datos (sin cascadas)', async () => {
      const company = await createCompany();
      await createEmployee(company.id);
      await expect(prisma.company.delete({ where: { id: company.id } })).rejects.toThrow();
      expect(await prisma.company.count()).toBe(1);
    });
  });
});
