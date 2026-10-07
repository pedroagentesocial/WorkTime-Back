import { toOffset, type Page, type PageRequest } from '#shared/application/pagination.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type { Prisma } from '#generated/prisma/client.js';
import type { EmployeeListFilter } from '../application/ports/employee.repository.js';
import type {
  PortfolioEmployeeReader,
  PortfolioEmployeeView,
} from '../application/ports/portfolio-employee.reader.js';
import { EMPLOYEE_SELECT, toView } from './prisma-employee.repository.js';

interface Deps {
  db: PrismaDb;
}

const SELECT = {
  ...EMPLOYEE_SELECT,
  company: {
    select: { ...EMPLOYEE_SELECT.company.select, id: true, name: true, code: true },
  },
} satisfies Prisma.EmployeeSelect;

export class PrismaPortfolioEmployeeReader implements PortfolioEmployeeReader {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async list(
    companyIds: readonly string[],
    filter: EmployeeListFilter,
    page: PageRequest,
  ): Promise<Page<PortfolioEmployeeView>> {
    const contains = filter.search
      ? { contains: filter.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.EmployeeWhereInput = {
      companyId: { in: [...companyIds] },
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
        select: SELECT,
        orderBy: [
          { company: { name: 'asc' } },
          { user: { lastName: 'asc' } },
          { user: { firstName: 'asc' } },
          { id: 'asc' },
        ],
        ...toOffset(page),
      }),
      this.db.client.employee.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        ...toView(row),
        company: { id: row.company.id, name: row.company.name, code: row.company.code },
      })),
      page: page.page,
      limit: page.limit,
      total,
    };
  }
}
