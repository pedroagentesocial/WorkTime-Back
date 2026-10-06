import { toOffset, type Page, type PageRequest } from '#shared/application/pagination.js';
import { DailyLimit } from '#shared/domain/daily-limit.js';
import { resolveTimezone } from '#shared/domain/timezone.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import { Prisma } from '#generated/prisma/client.js';
import type {
  CompanyCapacity,
  EmployeeListFilter,
  EmployeePatch,
  EmployeeRepository,
  EmployeeView,
  NewEmployee,
} from '../application/ports/employee.repository.js';
import { WorkforceErrors } from '../application/workforce-errors.js';
import { Identifiers } from '#shared/domain/identifiers.js';
import type { EmployeeStatus } from '../domain/employee-rules.js';

interface Deps {
  db: PrismaDb;
}

const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  phone: true,
  hiredAt: true,
  timezone: true,
  dailyLimitMinutes: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { timezone: true, dailyLimitMinutes: true } },
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      mustChangePassword: true,
      lastLoginAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.EmployeeSelect;

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

export class PrismaEmployeeRepository implements EmployeeRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async lockCompanyCapacity(companyId: string): Promise<CompanyCapacity | null> {
    // FOR UPDATE: otra transaccion sobre la misma empresa espera a que esta termine
    const rows = await this.db.client.$queryRaw<{ max_employees: number; timezone: string }[]>`
      SELECT max_employees, timezone FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
    const company = rows[0];
    if (!company) return null;

    const activeEmployees = await this.db.client.employee.count({
      where: { companyId, user: { status: 'active' } },
    });
    return { timezone: company.timezone, maxEmployees: company.max_employees, activeEmployees };
  }

  async emailExists(email: string): Promise<boolean> {
    return (await this.db.client.user.count({ where: { email } })) > 0;
  }

  async nextEmployeeCode(companyId: string): Promise<string> {
    // El consecutivo solo sube: un numero nunca se reutiliza, ni siquiera si el empleado se desactiva
    const rows = await this.db.client.$queryRaw<
      { employee_sequence: number; employee_code_prefix: string }[]
    >`
      UPDATE companies SET employee_sequence = employee_sequence + 1
      WHERE id = ${companyId}::uuid
      RETURNING employee_sequence, employee_code_prefix`;
    const row = rows[0];
    if (!row) throw WorkforceErrors.companyNotFound();
    return Identifiers.employeeCode(row.employee_code_prefix, row.employee_sequence);
  }

  async create(employee: NewEmployee): Promise<void> {
    try {
      await this.db.run(async () => {
        await this.db.client.user.create({
          data: {
            id: employee.userId,
            companyId: employee.companyId,
            email: employee.email,
            firstName: employee.firstName,
            lastName: employee.lastName,
            passwordHash: employee.passwordHash,
            role: 'employee',
            mustChangePassword: true,
            temporaryPasswordExpiresAt: employee.temporaryPasswordExpiresAt,
          },
        });
        await this.db.client.employee.create({
          data: {
            id: employee.employeeId,
            companyId: employee.companyId,
            userId: employee.userId,
            employeeCode: employee.employeeCode,
            phone: employee.phone,
            hiredAt: toDbDate(employee.hiredAt),
            timezone: employee.timezone,
          },
        });
      });
    } catch (error) {
      throw translateUniqueViolation(error);
    }
  }

  async findById(companyId: string, employeeId: string): Promise<EmployeeView | null> {
    const row = await this.db.client.employee.findFirst({
      where: { id: employeeId, companyId },
      select: EMPLOYEE_SELECT,
    });
    return row ? toView(row) : null;
  }

  async list(
    companyId: string,
    filter: EmployeeListFilter,
    page: PageRequest,
  ): Promise<Page<EmployeeView>> {
    const contains = filter.search
      ? { contains: filter.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      ...(filter.status && { user: { status: filter.status } }),
      ...(contains && {
        OR: [
          { employeeCode: contains },
          { user: { firstName: contains } },
          { user: { lastName: contains } },
          { user: { email: contains } },
        ],
      }),
    };

    const [rows, total] = await Promise.all([
      this.db.client.employee.findMany({
        where,
        select: EMPLOYEE_SELECT,
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }, { id: 'asc' }],
        ...toOffset(page),
      }),
      this.db.client.employee.count({ where }),
    ]);
    return { items: rows.map(toView), page: page.page, limit: page.limit, total };
  }

  async update(companyId: string, employeeId: string, patch: EmployeePatch): Promise<void> {
    try {
      await this.db.run(async () => {
        const userId = await this.userIdOf(companyId, employeeId);
        if (patch.firstName !== undefined || patch.lastName !== undefined) {
          await this.db.client.user.updateMany({
            where: { id: userId, companyId },
            data: {
              ...(patch.firstName !== undefined && { firstName: patch.firstName }),
              ...(patch.lastName !== undefined && { lastName: patch.lastName }),
            },
          });
        }
        await this.db.client.employee.updateMany({
          where: { id: employeeId, companyId },
          data: {
            ...(patch.phone !== undefined && { phone: patch.phone }),
            ...(patch.hiredAt !== undefined && { hiredAt: toDbDate(patch.hiredAt) }),
            ...(patch.timezone !== undefined && { timezone: patch.timezone }),
            ...(patch.dailyLimitMinutes !== undefined && {
              dailyLimitMinutes: patch.dailyLimitMinutes,
            }),
          },
        });
      });
    } catch (error) {
      throw translateUniqueViolation(error);
    }
  }

  async setStatus(companyId: string, employeeId: string, status: EmployeeStatus): Promise<void> {
    const userId = await this.userIdOf(companyId, employeeId);
    await this.db.client.user.updateMany({
      where: { id: userId, companyId },
      data: {
        status,
        ...(status === 'inactive' && { tokenVersion: { increment: 1 } }),
      },
    });
  }

  async lockEmployee(companyId: string, employeeId: string): Promise<void> {
    await this.db.client.$queryRaw`
      SELECT id FROM employees WHERE id = ${employeeId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
  }

  async hasHistory(companyId: string, employeeId: string): Promise<boolean> {
    const rows = await this.db.client.$queryRaw<{ found: boolean }[]>`
      SELECT (
        EXISTS (SELECT 1 FROM time_entries WHERE employee_id = ${employeeId}::uuid AND company_id = ${companyId}::uuid)
        OR EXISTS (SELECT 1 FROM daily_reports WHERE employee_id = ${employeeId}::uuid AND company_id = ${companyId}::uuid)
      ) AS found`;
    return rows[0]?.found === true;
  }

  async deleteAccount(companyId: string, employeeId: string): Promise<void> {
    const userId = await this.userIdOf(companyId, employeeId);
    await this.db.client.refreshToken.deleteMany({ where: { userId } });
    await this.db.client.securityEvent.deleteMany({ where: { userId } });
    await this.db.client.employee.deleteMany({ where: { id: employeeId, companyId } });
    await this.db.client.user.deleteMany({ where: { id: userId, companyId } });
  }

  async revokeSessions(companyId: string, employeeId: string): Promise<void> {
    const userId = await this.userIdOf(companyId, employeeId);
    await this.db.client.user.updateMany({
      where: { id: userId, companyId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async resetPassword(
    companyId: string,
    employeeId: string,
    password: { passwordHash: string; expiresAt: Date },
  ): Promise<void> {
    const userId = await this.userIdOf(companyId, employeeId);
    await this.db.client.user.updateMany({
      where: { id: userId, companyId },
      data: {
        passwordHash: password.passwordHash,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: password.expiresAt,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lockLevel: 0,
        tokenVersion: { increment: 1 },
      },
    });
  }

  private async userIdOf(companyId: string, employeeId: string): Promise<string> {
    const employee = await this.db.client.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { userId: true },
    });
    if (!employee) throw WorkforceErrors.employeeNotFound();
    return employee.userId;
  }
}

function toDbDate(date: string | null | undefined): Date | null {
  return date ? new Date(`${date}T00:00:00.000Z`) : null;
}

function fromDbDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function toView(row: EmployeeRow): EmployeeView {
  const latestUpdate = row.user.updatedAt > row.updatedAt ? row.user.updatedAt : row.updatedAt;
  return {
    id: row.id,
    userId: row.user.id,
    email: row.user.email,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
    employeeCode: row.employeeCode,
    phone: row.phone,
    hiredAt: fromDbDate(row.hiredAt),
    timezone: row.timezone,
    effectiveTimezone: resolveTimezone(row.timezone, row.company.timezone),
    dailyLimitMinutes: row.dailyLimitMinutes,
    effectiveDailyLimitMinutes: DailyLimit.resolve(
      row.dailyLimitMinutes,
      row.company.dailyLimitMinutes,
    ),
    status: row.user.status,
    mustChangePassword: row.user.mustChangePassword,
    lastLoginAt: row.user.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: latestUpdate,
  };
}

function translateUniqueViolation(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return WorkforceErrors.emailTaken();
  }
  return error;
}
