import { toOffset, type Page, type PageRequest } from '#shared/application/pagination.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import { Prisma } from '#generated/prisma/client.js';
import { PlatformErrors } from '../application/platform-errors.js';
import type {
  MultiAdminLimits,
  MultiAdminListFilter,
  MultiAdminPatch,
  MultiAdminRepository,
  MultiAdminView,
  NewMultiAdmin,
} from '../application/ports/multi-admin.repository.js';

interface Deps {
  db: PrismaDb;
}

const MULTI_ADMIN_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  multiCompanyAdmin: { select: { maxCompanies: true, maxEmployeesPerCompany: true } },
  _count: { select: { memberships: true } },
} satisfies Prisma.UserSelect;

type MultiAdminRow = Prisma.UserGetPayload<{ select: typeof MULTI_ADMIN_SELECT }>;

const IS_MULTI_ADMIN = { role: 'multi_company_admin' } as const;

export class PrismaMultiAdminRepository implements MultiAdminRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async createWithLimits(input: NewMultiAdmin): Promise<void> {
    try {
      await this.db.client.user.create({
        data: {
          id: input.id,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash: input.passwordHash,
          role: 'multi_company_admin',
          mustChangePassword: true,
          temporaryPasswordExpiresAt: input.temporaryPasswordExpiresAt,
          multiCompanyAdmin: {
            create: {
              maxCompanies: input.maxCompanies,
              maxEmployeesPerCompany: input.maxEmployeesPerCompany,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw PlatformErrors.emailTaken();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<MultiAdminView | null> {
    const row = await this.db.client.user.findFirst({
      where: { id, ...IS_MULTI_ADMIN },
      select: MULTI_ADMIN_SELECT,
    });
    return row ? toView(row) : null;
  }

  async list(filter: MultiAdminListFilter, page: PageRequest): Promise<Page<MultiAdminView>> {
    const where: Prisma.UserWhereInput = {
      ...IS_MULTI_ADMIN,
      ...(filter.status && { status: filter.status }),
      ...(filter.search && {
        OR: [
          { email: { contains: filter.search, mode: 'insensitive' } },
          { firstName: { contains: filter.search, mode: 'insensitive' } },
          { lastName: { contains: filter.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.db.client.user.findMany({
        where,
        select: MULTI_ADMIN_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toOffset(page),
      }),
      this.db.client.user.count({ where }),
    ]);
    return { items: rows.map(toView), page: page.page, limit: page.limit, total };
  }

  async update(id: string, patch: MultiAdminPatch): Promise<void> {
    await this.db.client.user.update({
      where: { id },
      data: {
        ...(patch.firstName !== undefined && { firstName: patch.firstName }),
        ...(patch.lastName !== undefined && { lastName: patch.lastName }),
        multiCompanyAdmin: {
          update: {
            ...(patch.maxCompanies !== undefined && { maxCompanies: patch.maxCompanies }),
            ...(patch.maxEmployeesPerCompany !== undefined && {
              maxEmployeesPerCompany: patch.maxEmployeesPerCompany,
            }),
          },
        },
      },
    });
  }

  // Al desactivar suben tokenVersion y se anulan todas sus sesiones al instante
  async setStatus(id: string, status: 'active' | 'inactive'): Promise<void> {
    await this.db.client.user.update({
      where: { id },
      data: { status, ...(status === 'inactive' && { tokenVersion: { increment: 1 } }) },
    });
  }

  async resetPassword(
    id: string,
    password: { passwordHash: string; expiresAt: Date },
  ): Promise<MultiAdminView | null> {
    const exists = await this.db.client.user.count({ where: { id, ...IS_MULTI_ADMIN } });
    if (exists === 0) return null;

    const row = await this.db.client.user.update({
      where: { id },
      data: {
        passwordHash: password.passwordHash,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: password.expiresAt,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lockLevel: 0,
        tokenVersion: { increment: 1 },
      },
      select: MULTI_ADMIN_SELECT,
    });
    return toView(row);
  }

  async lockLimits(userId: string): Promise<MultiAdminLimits | null> {
    const rows = await this.db.client.$queryRaw<
      { max_companies: number; max_employees_per_company: number }[]
    >`
      SELECT max_companies, max_employees_per_company
      FROM multi_company_admins WHERE user_id = ${userId}::uuid FOR UPDATE`;
    const limits = rows[0];
    if (!limits) return null;

    const companyCount = await this.db.client.companyMembership.count({ where: { userId } });
    return {
      maxCompanies: limits.max_companies,
      maxEmployeesPerCompany: limits.max_employees_per_company,
      companyCount,
    };
  }

  async hasMembership(userId: string, companyId: string): Promise<boolean> {
    const count = await this.db.client.companyMembership.count({ where: { userId, companyId } });
    return count > 0;
  }

  async addMembership(userId: string, companyId: string): Promise<void> {
    await this.db.client.companyMembership.create({ data: { userId, companyId } });
  }

  async removeMembership(userId: string, companyId: string): Promise<boolean> {
    const { count } = await this.db.client.companyMembership.deleteMany({
      where: { userId, companyId },
    });
    return count === 1;
  }
}

function toView(row: MultiAdminRow): MultiAdminView {
  const limits = row.multiCompanyAdmin;
  if (!limits) throw new Error(`El usuario ${row.id} es admin multiempresa sin limites`);
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status,
    lastLoginAt: row.lastLoginAt,
    maxCompanies: limits.maxCompanies,
    maxEmployeesPerCompany: limits.maxEmployeesPerCompany,
    companyCount: row._count.memberships,
    createdAt: row.createdAt,
  };
}
