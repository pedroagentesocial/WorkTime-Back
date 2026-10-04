import { toOffset, type Page, type PageRequest } from '#shared/application/pagination.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import { Prisma } from '#generated/prisma/client.js';
import type {
  CompanyAdminSummary,
  CompanyListFilter,
  CompanyPatch,
  CompanyRepository,
  CompanyView,
  NewCompanyWithAdmin,
} from '../application/ports/company.repository.js';
import { PlatformErrors } from '../application/platform-errors.js';
import type { CompanyStatus } from '#shared/domain/company-rules.js';

interface Deps {
  db: PrismaDb;
}

const ADMIN_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

const COMPANY_SELECT = {
  id: true,
  code: true,
  employeeCodePrefix: true,
  name: true,
  timezone: true,
  maxEmployees: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  users: { where: { role: 'company_admin' }, select: ADMIN_SELECT, take: 1 },
  _count: { select: { employees: { where: { user: { status: 'active' } } } } },
} satisfies Prisma.CompanySelect;

type CompanyRow = Prisma.CompanyGetPayload<{ select: typeof COMPANY_SELECT }>;

export class PrismaCompanyRepository implements CompanyRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async createWithAdmin({ company, admin }: NewCompanyWithAdmin): Promise<void> {
    try {
      await this.db.client.company.create({
        data: {
          ...company,
          users: {
            create: {
              id: admin.id,
              email: admin.email,
              firstName: admin.firstName,
              lastName: admin.lastName,
              passwordHash: admin.passwordHash,
              role: 'company_admin',
              mustChangePassword: true,
              temporaryPasswordExpiresAt: admin.temporaryPasswordExpiresAt,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const detail = JSON.stringify(error.meta ?? {}) + error.message;
        throw detail.includes('email')
          ? PlatformErrors.emailTaken()
          : PlatformErrors.identifierTaken();
      }
      throw error;
    }
  }

  async lockActiveEmployees(companyId: string): Promise<number | null> {
    const rows = await this.db.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    return this.db.client.employee.count({ where: { companyId, user: { status: 'active' } } });
  }

  async emailExists(email: string): Promise<boolean> {
    return (await this.db.client.user.count({ where: { email } })) > 0;
  }

  async findById(id: string): Promise<CompanyView | null> {
    const row = await this.db.client.company.findUnique({ where: { id }, select: COMPANY_SELECT });
    return row ? toView(row) : null;
  }

  async list(filter: CompanyListFilter, page: PageRequest): Promise<Page<CompanyView>> {
    const where: Prisma.CompanyWhereInput = {
      ...(filter.status && { status: filter.status }),
      ...(filter.search && {
        OR: [
          { name: { contains: filter.search, mode: 'insensitive' } },
          { code: { contains: filter.search, mode: 'insensitive' } },
          { employeeCodePrefix: { contains: filter.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.db.client.company.findMany({
        where,
        select: COMPANY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toOffset(page),
      }),
      this.db.client.company.count({ where }),
    ]);
    return { items: rows.map(toView), page: page.page, limit: page.limit, total };
  }

  async update(id: string, patch: CompanyPatch): Promise<void> {
    await this.db.client.company.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.timezone !== undefined && { timezone: patch.timezone }),
        ...(patch.maxEmployees !== undefined && { maxEmployees: patch.maxEmployees }),
      },
    });
  }

  async setStatus(id: string, status: CompanyStatus): Promise<void> {
    await this.db.client.company.update({ where: { id }, data: { status } });
  }

  async resetAdminPassword(
    companyId: string,
    password: { passwordHash: string; expiresAt: Date },
  ): Promise<CompanyAdminSummary | null> {
    const admin = await this.db.client.user.findFirst({
      where: { companyId, role: 'company_admin' },
      select: { id: true },
    });
    if (!admin) return null;

    return this.db.client.user.update({
      where: { id: admin.id },
      data: {
        passwordHash: password.passwordHash,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: password.expiresAt,
        failedLoginAttempts: 0,
        lockedUntil: null,
        tokenVersion: { increment: 1 },
      },
      select: ADMIN_SELECT,
    });
  }
}

function toView(row: CompanyRow): CompanyView {
  return {
    id: row.id,
    code: row.code,
    employeeCodePrefix: row.employeeCodePrefix,
    name: row.name,
    timezone: row.timezone,
    maxEmployees: row.maxEmployees,
    status: row.status,
    activeEmployees: row._count.employees,
    admin: row.users[0] ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
