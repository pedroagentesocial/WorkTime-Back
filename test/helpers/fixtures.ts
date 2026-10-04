import { v7 as uuidv7 } from 'uuid';
import { Identifiers } from '#shared/domain/identifiers.js';
import type { Role } from '#shared/domain/permissions.js';
import { Argon2PasswordHasher } from '#shared/infrastructure/argon2-password-hasher.js';
import type { PrismaClient } from '#shared/infrastructure/prisma/prisma-client.js';

const hasher = new Argon2PasswordHasher();

// Codigos unicos y predecibles dentro del proceso: los aleatorios podrian chocar entre si en un test
let identifierCounter = 0;
const DIGITS = '23456789';
const LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ';
const encode = (value: number, length: number) =>
  Array.from({ length }, (_, i) => DIGITS.charAt(Math.floor(value / 8 ** i) % 8))
    .reverse()
    .join('');

export function companyIdentifiers() {
  identifierCounter += 1;
  const n = identifierCounter;
  return {
    code: `${encode(n, 4)}-${encode(n * 7 + 3, 4)}`,
    employeeCodePrefix: [Math.floor(n / 484) % 22, Math.floor(n / 22) % 22, n % 22]
      .map((i) => LETTERS.charAt(i))
      .join(''),
  };
}

export async function employeeCodeFor(prisma: PrismaClient, companyId: string) {
  const company = await prisma.company.update({
    where: { id: companyId },
    data: { employeeSequence: { increment: 1 } },
    select: { employeeSequence: true, employeeCodePrefix: true },
  });
  return Identifiers.employeeCode(company.employeeCodePrefix, company.employeeSequence);
}

export const DEFAULT_PASSWORD = 'una-contraseña-segura';

export async function createCompany(
  prisma: PrismaClient,
  overrides: {
    name?: string;
    status?: 'active' | 'suspended';
    maxEmployees?: number;
    requireDailyReport?: boolean;
  } = {},
) {
  return prisma.company.create({
    data: {
      ...companyIdentifiers(),
      id: uuidv7(),
      name: overrides.name ?? 'Empresa de prueba',
      timezone: 'America/Denver',
      maxEmployees: overrides.maxEmployees ?? 10,
      status: overrides.status ?? 'active',
      requireDailyReport: overrides.requireDailyReport ?? false,
      dailyReportRequiredSince: new Date('2000-01-01T00:00:00.000Z'),
    },
  });
}

export interface UserFixture {
  role: Role;
  companyId?: string | null;
  email?: string;
  password?: string;
  status?: 'active' | 'inactive';
  mustChangePassword?: boolean;
  temporaryPasswordExpiresAt?: Date | null;
}

export async function createUser(prisma: PrismaClient, fixture: UserFixture) {
  const password = fixture.password ?? DEFAULT_PASSWORD;
  const user = await prisma.user.create({
    data: {
      id: uuidv7(),
      companyId: fixture.companyId ?? null,
      email: fixture.email ?? `${uuidv7()}@test.com`,
      passwordHash: await hasher.hash(password),
      role: fixture.role,
      status: fixture.status ?? 'active',
      firstName: 'Test',
      lastName: 'User',
      mustChangePassword: fixture.mustChangePassword ?? false,
      temporaryPasswordExpiresAt: fixture.temporaryPasswordExpiresAt ?? null,
    },
  });
  return { ...user, password };
}

export async function createEmployee(
  prisma: PrismaClient,
  companyId: string,
  options: { timezone?: string | null; firstName?: string; status?: 'active' | 'inactive' } = {},
) {
  const user = await createUser(prisma, {
    role: 'employee',
    companyId,
    ...(options.status && { status: options.status }),
  });
  if (options.firstName) {
    await prisma.user.update({ where: { id: user.id }, data: { firstName: options.firstName } });
  }
  const employee = await prisma.employee.create({
    data: {
      id: uuidv7(),
      companyId,
      userId: user.id,
      employeeCode: await employeeCodeFor(prisma, companyId),
      timezone: options.timezone ?? null,
    },
  });
  return { user, employee };
}
