import { toOffset, type Page, type PageRequest } from '#shared/application/pagination.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import { Prisma } from '#generated/prisma/client.js';
import type {
  DailyReportFilter,
  DailyReportRecord,
  DailyReportRepository,
  DailyReportRevisionView,
  DailyReportView,
  DayWithoutReport,
  NewDailyReport,
} from '../application/ports/daily-report.repository.js';

interface Deps {
  db: PrismaDb;
}

const REPORT_SELECT = {
  id: true,
  employeeId: true,
  workDate: true,
  content: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DailyReportSelect;

const VIEW_SELECT = {
  ...REPORT_SELECT,
  employee: {
    select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true } } },
  },
  _count: { select: { revisions: true } },
} satisfies Prisma.DailyReportSelect;

type ReportRow = Prisma.DailyReportGetPayload<{ select: typeof REPORT_SELECT }>;
type ViewRow = Prisma.DailyReportGetPayload<{ select: typeof VIEW_SELECT }>;

export class PrismaDailyReportRepository implements DailyReportRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async findDaysWithoutReport(
    companyId: string,
    range: { from: string; to: string },
    employeeId?: string,
  ): Promise<DayWithoutReport[]> {
    const conditions = [
      Prisma.sql`t.company_id = ${companyId}::uuid`,
      Prisma.sql`t.voided_at IS NULL`,
      Prisma.sql`t.work_date >= ${range.from}::date`,
      Prisma.sql`t.work_date <= ${range.to}::date`,
    ];
    if (employeeId) conditions.push(Prisma.sql`t.employee_id = ${employeeId}::uuid`);

    const rows = await this.db.client.$queryRaw<{ employee_id: string; work_date: string }[]>`
      SELECT t.employee_id, to_char(t.work_date, 'YYYY-MM-DD') AS work_date
      FROM time_entries t
      WHERE ${Prisma.join(conditions, ' AND ')}
        AND NOT EXISTS (
          SELECT 1 FROM daily_reports r
          WHERE r.employee_id = t.employee_id AND r.work_date = t.work_date
        )
      GROUP BY t.employee_id, t.work_date
      HAVING COUNT(*) FILTER (WHERE t.clock_out_at IS NULL) = 0
      ORDER BY t.employee_id, t.work_date`;
    return rows.map((row) => ({ employeeId: row.employee_id, workDate: row.work_date }));
  }

  async find(employeeId: string, workDate: string): Promise<DailyReportRecord | null> {
    const row = await this.db.client.dailyReport.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: toDbDate(workDate) } },
      select: REPORT_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async save(report: NewDailyReport, previous: DailyReportRecord | null): Promise<void> {
    if (!previous) {
      await this.db.client.dailyReport.create({
        data: { ...report, workDate: toDbDate(report.workDate) },
      });
      return;
    }
    if (previous.content === report.content) return;

    await this.db.run(async () => {
      await this.db.client.dailyReportRevision.create({
        data: { companyId: report.companyId, reportId: previous.id, content: previous.content },
      });
      await this.db.client.dailyReport.updateMany({
        where: { id: previous.id, companyId: report.companyId },
        data: { content: report.content },
      });
    });
  }

  async findView(companyId: string, id: string): Promise<DailyReportView | null> {
    const row = await this.db.client.dailyReport.findFirst({
      where: { id, companyId },
      select: VIEW_SELECT,
    });
    return row ? toView(row) : null;
  }

  async list(
    companyId: string,
    filter: DailyReportFilter,
    page: PageRequest,
  ): Promise<Page<DailyReportView>> {
    const where: Prisma.DailyReportWhereInput = {
      companyId,
      ...(filter.employeeId && { employeeId: filter.employeeId }),
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
        select: VIEW_SELECT,
        orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
        ...toOffset(page),
      }),
      this.db.client.dailyReport.count({ where }),
    ]);
    return { items: rows.map(toView), page: page.page, limit: page.limit, total };
  }

  async listRevisions(companyId: string, reportId: string): Promise<DailyReportRevisionView[]> {
    return this.db.client.dailyReportRevision.findMany({
      where: { companyId, reportId },
      orderBy: [{ savedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, content: true, savedAt: true },
    });
  }
}

function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toRecord(row: ReportRow): DailyReportRecord {
  return { ...row, workDate: row.workDate.toISOString().slice(0, 10) };
}

function toView(row: ViewRow): DailyReportView {
  return {
    ...toRecord(row),
    employee: {
      id: row.employee.id,
      firstName: row.employee.user.firstName,
      lastName: row.employee.user.lastName,
      employeeCode: row.employee.employeeCode,
    },
    revisions: row._count.revisions,
  };
}
