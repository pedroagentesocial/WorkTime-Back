import { toOffset, type Page, type PageRequest } from '#shared/application/pagination.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type { Prisma } from '#generated/prisma/client.js';
import type {
  PortfolioDailyReportReader,
  PortfolioDailyReportView,
} from '../application/ports/portfolio-daily-report.reader.js';
import type { WorkDateRange } from '../domain/work-date-range.js';

interface Deps {
  db: PrismaDb;
}

const SELECT = {
  id: true,
  employeeId: true,
  workDate: true,
  content: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true, code: true } },
  employee: {
    select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true } } },
  },
  _count: { select: { revisions: true } },
} satisfies Prisma.DailyReportSelect;

type Row = Prisma.DailyReportGetPayload<{ select: typeof SELECT }>;

export class PrismaPortfolioDailyReportReader implements PortfolioDailyReportReader {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async list(
    companyIds: readonly string[],
    filter: WorkDateRange,
    page: PageRequest,
  ): Promise<Page<PortfolioDailyReportView>> {
    const where: Prisma.DailyReportWhereInput = {
      companyId: { in: [...companyIds] },
      ...((filter.from ?? filter.to) && {
        workDate: {
          ...(filter.from && { gte: toDbDate(filter.from) }),
          ...(filter.to && { lte: toDbDate(filter.to) }),
        },
      }),
    };
    const [rows, total] = await Promise.all([
      this.db.client.dailyReport.findMany({
        where,
        select: SELECT,
        orderBy: [{ workDate: 'desc' }, { company: { name: 'asc' } }, { id: 'desc' }],
        ...toOffset(page),
      }),
      this.db.client.dailyReport.count({ where }),
    ]);
    return { items: rows.map(toView), page: page.page, limit: page.limit, total };
  }
}

function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toView(row: Row): PortfolioDailyReportView {
  return {
    id: row.id,
    employeeId: row.employeeId,
    workDate: row.workDate.toISOString().slice(0, 10),
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    company: row.company,
    employee: {
      id: row.employee.id,
      firstName: row.employee.user.firstName,
      lastName: row.employee.user.lastName,
      employeeCode: row.employee.employeeCode,
    },
    revisions: row._count.revisions,
  };
}
