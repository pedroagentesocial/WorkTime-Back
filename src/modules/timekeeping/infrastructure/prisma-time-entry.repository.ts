import { toOffset, type PageRequest } from '#shared/application/pagination.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import { Prisma } from '#generated/prisma/client.js';
import type { EmployeeDayTotal } from '../domain/company-timesheet.js';
import type { DailyTotal } from '../domain/timesheet.js';
import type {
  CorrectionView,
  NewCorrection,
  TimeEntryFilter,
  OpenEntryBlocker,
  OverLimitEntry,
  TimeEntryPage,
  TimeEntryRepository,
  TimeEntryView,
} from '../application/ports/time-entry.repository.js';
import { TimekeepingErrors } from '../application/timekeeping-errors.js';
import type { ClockLocation } from '../domain/clock-location.js';
import type { ClockZone } from '../domain/work-zone.js';
import { TimeEntry, type TimeEntryCloseSource, type TimeRange } from '../domain/time-entry.js';

interface Deps {
  db: PrismaDb;
}

const ENTRY_SELECT = {
  id: true,
  companyId: true,
  employeeId: true,
  clockInAt: true,
  clockOutAt: true,
  timezone: true,
  workDate: true,
  source: true,
  closeSource: true,
  dailyLimitWaived: true,
  createdReason: true,
  clockInLatitude: true,
  clockInLongitude: true,
  clockInAccuracyM: true,
  clockInZone: true,
  clockInSiteId: true,
  clockInDistanceM: true,
  clockInSite: { select: { name: true } },
} satisfies Prisma.TimeEntrySelect;

const VIEW_SELECT = {
  id: true,
  clockInAt: true,
  clockOutAt: true,
  timezone: true,
  workDate: true,
  source: true,
  closeSource: true,
  createdReason: true,
  clockInLatitude: true,
  clockInLongitude: true,
  clockInAccuracyM: true,
  clockInZone: true,
  clockInSiteId: true,
  clockInDistanceM: true,
  clockInSite: { select: { name: true } },
  voidedAt: true,
  voidReason: true,
  voidedBy: { select: { id: true, firstName: true, lastName: true } },
  createdAt: true,
  updatedAt: true,
  employee: {
    select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true } } },
  },
  _count: { select: { corrections: true } },
} satisfies Prisma.TimeEntrySelect;

type EntryRow = Prisma.TimeEntryGetPayload<{ select: typeof ENTRY_SELECT }>;
type ViewRow = Prisma.TimeEntryGetPayload<{ select: typeof VIEW_SELECT }>;

export class PrismaTimeEntryRepository implements TimeEntryRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async findOpenByEmployee(employeeId: string): Promise<TimeEntry | null> {
    const row = await this.db.client.timeEntry.findFirst({
      where: { employeeId, clockOutAt: null, voidedAt: null },
      select: ENTRY_SELECT,
    });
    return row ? toDomain(row) : null;
  }

  async findById(companyId: string, id: string): Promise<TimeEntry | null> {
    const row = await this.db.client.timeEntry.findFirst({
      where: { id, companyId, voidedAt: null },
      select: ENTRY_SELECT,
    });
    return row ? toDomain(row) : null;
  }

  async insert(entry: TimeEntry): Promise<void> {
    const { clockInLocation, clockInZone, ...data } = entry.snapshot();
    try {
      await this.db.client.timeEntry.create({
        data: {
          ...data,
          workDate: toDbDate(data.workDate),
          clockInLatitude: clockInLocation?.latitude ?? null,
          clockInLongitude: clockInLocation?.longitude ?? null,
          clockInAccuracyM: clockInLocation?.accuracyMeters ?? null,
          clockInZone: clockInZone?.status ?? null,
          clockInSiteId: clockInZone?.siteId ?? null,
          clockInDistanceM: clockInZone?.distanceMeters ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw TimekeepingErrors.alreadyClockedIn();
      }
      throw error;
    }
  }

  async closeIfOpen(
    companyId: string,
    id: string,
    at: Date,
    closeSource: TimeEntryCloseSource,
  ): Promise<boolean> {
    const { count } = await this.db.client.timeEntry.updateMany({
      where: { id, companyId, clockOutAt: null, voidedAt: null },
      data: { clockOutAt: at, closeSource },
    });
    return count === 1;
  }

  async voidIfActive(
    companyId: string,
    id: string,
    voided: { at: Date; byId: string; reason: string },
  ): Promise<boolean> {
    const { count } = await this.db.client.timeEntry.updateMany({
      where: { id, companyId, voidedAt: null },
      data: { voidedAt: voided.at, voidedById: voided.byId, voidReason: voided.reason },
    });
    return count === 1;
  }

  async findOpenUpTo(
    companyId: string,
    workDate: string,
    limit: number,
  ): Promise<OpenEntryBlocker[]> {
    const rows = await this.db.client.timeEntry.findMany({
      where: { companyId, clockOutAt: null, voidedAt: null, workDate: { lte: toDbDate(workDate) } },
      select: {
        id: true,
        workDate: true,
        employee: {
          select: {
            id: true,
            employeeCode: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((row) => ({
      timeEntryId: row.id,
      workDate: fromDbDate(row.workDate),
      employee: {
        id: row.employee.id,
        firstName: row.employee.user.firstName,
        lastName: row.employee.user.lastName,
        employeeCode: row.employee.employeeCode,
      },
    }));
  }

  async findOpenOfInactiveEmployees(
    limit: number,
  ): Promise<{ id: string; employeeId: string; companyId: string }[]> {
    return this.db.client.timeEntry.findMany({
      where: {
        clockOutAt: null,
        voidedAt: null,
        employee: { user: { status: 'inactive' } },
      },
      select: { id: true, employeeId: true, companyId: true },
      orderBy: { clockInAt: 'asc' },
      take: limit,
    });
  }

  async hasEntriesOn(employeeId: string, workDate: string): Promise<boolean> {
    const count = await this.db.client.timeEntry.count({
      where: { employeeId, workDate: toDbDate(workDate), voidedAt: null },
    });
    return count > 0;
  }

  async closedSecondsOn(employeeId: string, workDate: string): Promise<number> {
    const [row] = await this.db.client.$queryRaw<{ seconds: bigint | number | null }[]>`
      SELECT COALESCE(SUM(FLOOR(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at)))), 0)::bigint AS seconds
      FROM time_entries
      WHERE employee_id = ${employeeId}::uuid
        AND work_date = ${workDate}::date
        AND clock_out_at IS NOT NULL
        AND voided_at IS NULL`;
    return Number(row?.seconds ?? 0);
  }

  async closedSecondsByEmployeeAndDay(
    employeeIds: readonly string[],
    workDates: readonly string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (employeeIds.length === 0 || workDates.length === 0) return result;

    const rows = await this.db.client.$queryRaw<
      { employee_id: string; work_date: string; seconds: bigint | number }[]
    >`
      SELECT employee_id, to_char(work_date, 'YYYY-MM-DD') AS work_date,
             SUM(FLOOR(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at))))::bigint AS seconds
      FROM time_entries
      WHERE employee_id = ANY(${[...employeeIds]}::uuid[])
        AND work_date = ANY(${[...workDates]}::date[])
        AND clock_out_at IS NOT NULL
        AND voided_at IS NULL
      GROUP BY employee_id, work_date`;
    for (const row of rows) result.set(`${row.employee_id}|${row.work_date}`, Number(row.seconds));
    return result;
  }

  async findOverLimit(now: Date): Promise<OverLimitEntry[]> {
    const rows = await this.db.client.$queryRaw<
      { id: string; employee_id: string; limit_minutes: number }[]
    >`
      SELECT t.id, t.employee_id, l.minutes AS limit_minutes
      FROM time_entries t
      JOIN employees e ON e.company_id = t.company_id AND e.id = t.employee_id
      JOIN companies c ON c.id = t.company_id
      CROSS JOIN LATERAL (SELECT COALESCE(e.daily_limit_minutes, c.daily_limit_minutes) AS minutes) l
      WHERE t.clock_out_at IS NULL
        AND t.voided_at IS NULL
        AND NOT t.daily_limit_waived
        AND l.minutes IS NOT NULL
        AND (
          SELECT COALESCE(SUM(FLOOR(EXTRACT(EPOCH FROM (x.clock_out_at - x.clock_in_at)))), 0)
          FROM time_entries x
          WHERE x.employee_id = t.employee_id AND x.work_date = t.work_date AND x.clock_out_at IS NOT NULL AND x.voided_at IS NULL
        ) + FLOOR(EXTRACT(EPOCH FROM (${now}::timestamptz - t.clock_in_at))) >= l.minutes * 60`;
    return rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      limitMinutes: row.limit_minutes,
    }));
  }

  async update(entry: TimeEntry, expected: TimeRange): Promise<boolean> {
    const { count } = await this.db.client.timeEntry.updateMany({
      where: {
        id: entry.id,
        companyId: entry.companyId,
        clockInAt: expected.clockInAt,
        clockOutAt: expected.clockOutAt,
        voidedAt: null,
      },
      data: {
        clockInAt: entry.clockInAt,
        clockOutAt: entry.clockOutAt,
        workDate: toDbDate(entry.workDate),
      },
    });
    return count === 1;
  }

  async lockEmployee(companyId: string, employeeId: string): Promise<void> {
    await this.db.client.$queryRaw`
      SELECT id FROM employees WHERE id = ${employeeId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
  }

  async hasOverlap(
    employeeId: string,
    range: { from: Date; to: Date | null },
    exceptId: string,
  ): Promise<boolean> {
    const count = await this.db.client.timeEntry.count({
      where: {
        employeeId,
        voidedAt: null,
        id: { not: exceptId },
        ...(range.to && { clockInAt: { lt: range.to } }),
        OR: [{ clockOutAt: null }, { clockOutAt: { gt: range.from } }],
      },
    });
    return count > 0;
  }

  async addCorrection(correction: NewCorrection): Promise<void> {
    await this.db.client.timeEntryCorrection.create({ data: correction });
  }

  async listCorrections(companyId: string, timeEntryId: string): Promise<CorrectionView[]> {
    const rows = await this.db.client.timeEntryCorrection.findMany({
      where: { companyId, timeEntryId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        previousClockInAt: true,
        previousClockOutAt: true,
        newClockInAt: true,
        newClockOutAt: true,
        reason: true,
        createdAt: true,
        correctedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return rows;
  }

  async findViewById(companyId: string, id: string): Promise<TimeEntryView | null> {
    const row = await this.db.client.timeEntry.findFirst({
      where: { id, companyId },
      select: VIEW_SELECT,
    });
    return row ? toView(row) : null;
  }

  async list(
    companyId: string,
    filter: TimeEntryFilter,
    page: PageRequest,
  ): Promise<TimeEntryPage> {
    const where: Prisma.TimeEntryWhereInput = {
      companyId,
      ...(filter.employeeId && { employeeId: filter.employeeId }),
      ...(filter.location === 'without' && { clockInLatitude: null }),
      ...(filter.location === 'outside' && { clockInZone: 'outside' }),
      ...((filter.from ?? filter.to) && {
        workDate: {
          ...(filter.from && { gte: toDbDate(filter.from) }),
          ...(filter.to && { lte: toDbDate(filter.to) }),
        },
      }),
      voidedAt: filter.status === 'voided' ? { not: null } : null,
      ...(filter.status === 'open' && { clockOutAt: null }),
      ...(filter.status === 'closed' && { clockOutAt: { not: null } }),
    };

    const [rows, total, totalCentihours] = await Promise.all([
      this.db.client.timeEntry.findMany({
        where,
        select: VIEW_SELECT,
        orderBy: [{ clockInAt: 'desc' }, { id: 'desc' }],
        ...toOffset(page),
      }),
      this.db.client.timeEntry.count({ where }),
      this.sumClosedCentihours(companyId, filter),
    ]);

    return { items: rows.map(toView), page: page.page, limit: page.limit, total, totalCentihours };
  }

  async listOpen(companyId: string): Promise<TimeEntryView[]> {
    const rows = await this.db.client.timeEntry.findMany({
      where: {
        companyId,
        clockOutAt: null,
        voidedAt: null,
        employee: { user: { status: 'active' } },
      },
      select: VIEW_SELECT,
      orderBy: [{ clockInAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toView);
  }

  async dailyTotals(
    companyId: string,
    employeeId: string,
    range: { from: string; to: string },
  ): Promise<DailyTotal[]> {
    const rows = await this.db.client.$queryRaw<
      {
        work_date: string;
        entries: number;
        open_entries: number;
        centihours: bigint | number;
        has_report: boolean;
      }[]
    >`
      SELECT to_char(work_date, 'YYYY-MM-DD') AS work_date,
             COUNT(*)::int AS entries,
             (COUNT(*) FILTER (WHERE clock_out_at IS NULL))::int AS open_entries,
             COALESCE(SUM(FLOOR((FLOOR(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at))) + 18) / 36)), 0)::bigint AS centihours,
             EXISTS (
               SELECT 1 FROM daily_reports r
               WHERE r.employee_id = ${employeeId}::uuid AND r.work_date = time_entries.work_date
             ) AS has_report
      FROM time_entries
      WHERE company_id = ${companyId}::uuid
        AND employee_id = ${employeeId}::uuid
        AND voided_at IS NULL
        AND work_date >= ${range.from}::date
        AND work_date <= ${range.to}::date
      GROUP BY work_date
      ORDER BY work_date`;
    return rows.map((row) => ({
      workDate: row.work_date,
      entries: row.entries,
      openEntries: row.open_entries,
      centihours: Number(row.centihours),
      hasReport: row.has_report,
    }));
  }

  async periodTotals(
    companyId: string,
    range: { from: string; to: string },
  ): Promise<EmployeeDayTotal[]> {
    const rows = await this.db.client.$queryRaw<
      {
        employee_id: string;
        work_date: string;
        open_entries: number;
        centihours: bigint | number;
      }[]
    >`
      SELECT employee_id,
             to_char(work_date, 'YYYY-MM-DD') AS work_date,
             (COUNT(*) FILTER (WHERE clock_out_at IS NULL))::int AS open_entries,
             COALESCE(SUM(FLOOR((FLOOR(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at))) + 18) / 36)), 0)::bigint AS centihours
      FROM time_entries
      WHERE company_id = ${companyId}::uuid
        AND voided_at IS NULL
        AND work_date >= ${range.from}::date
        AND work_date <= ${range.to}::date
      GROUP BY employee_id, work_date`;
    return rows.map((row) => ({
      employeeId: row.employee_id,
      workDate: row.work_date,
      openEntries: row.open_entries,
      centihours: Number(row.centihours),
    }));
  }

  private async sumClosedCentihours(companyId: string, filter: TimeEntryFilter): Promise<number> {
    if (filter.status === 'open' || filter.status === 'voided') return 0;

    const conditions = [
      Prisma.sql`company_id = ${companyId}::uuid`,
      Prisma.sql`clock_out_at IS NOT NULL`,
      Prisma.sql`voided_at IS NULL`,
    ];
    if (filter.employeeId) conditions.push(Prisma.sql`employee_id = ${filter.employeeId}::uuid`);
    if (filter.from) conditions.push(Prisma.sql`work_date >= ${filter.from}::date`);
    if (filter.to) conditions.push(Prisma.sql`work_date <= ${filter.to}::date`);

    // Misma formula que toCentihours del dominio, floor de segundos mas 18 entre 36
    const [row] = await this.db.client.$queryRaw<{ centihours: bigint | number | null }[]>`
      SELECT COALESCE(SUM(FLOOR((FLOOR(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at))) + 18) / 36)), 0)::bigint AS centihours
      FROM time_entries
      WHERE ${Prisma.join(conditions, ' AND ')}`;
    return Number(row?.centihours ?? 0);
  }
}

function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type LocationColumns = Pick<EntryRow, 'clockInLatitude' | 'clockInLongitude' | 'clockInAccuracyM'>;

function locationOf(row: LocationColumns): ClockLocation | null {
  if (row.clockInLatitude === null || row.clockInLongitude === null) return null;
  return {
    latitude: row.clockInLatitude,
    longitude: row.clockInLongitude,
    accuracyMeters: row.clockInAccuracyM ?? 0,
  };
}

type ZoneColumns = Pick<
  EntryRow,
  'clockInZone' | 'clockInSiteId' | 'clockInDistanceM' | 'clockInSite'
>;

function zoneOf(row: ZoneColumns): ClockZone | null {
  if (
    (row.clockInZone !== 'inside' && row.clockInZone !== 'outside') ||
    row.clockInSiteId === null ||
    row.clockInDistanceM === null
  ) {
    return null;
  }
  return {
    status: row.clockInZone,
    siteId: row.clockInSiteId,
    siteName: row.clockInSite?.name ?? '',
    distanceMeters: row.clockInDistanceM,
  };
}

function toDomain(row: EntryRow): TimeEntry {
  const {
    clockInLatitude,
    clockInLongitude,
    clockInAccuracyM,
    clockInZone,
    clockInSiteId,
    clockInDistanceM,
    clockInSite,
    ...rest
  } = row;
  return TimeEntry.restore({
    ...rest,
    workDate: fromDbDate(row.workDate),
    clockInLocation: locationOf({ clockInLatitude, clockInLongitude, clockInAccuracyM }),
    clockInZone: zoneOf({ clockInZone, clockInSiteId, clockInDistanceM, clockInSite }),
  });
}

function toView(row: ViewRow): TimeEntryView {
  return {
    id: row.id,
    employee: {
      id: row.employee.id,
      firstName: row.employee.user.firstName,
      lastName: row.employee.user.lastName,
      employeeCode: row.employee.employeeCode,
    },
    clockInAt: row.clockInAt,
    clockOutAt: row.clockOutAt,
    timezone: row.timezone,
    workDate: fromDbDate(row.workDate),
    source: row.source,
    closeSource: row.closeSource,
    corrections: row._count.corrections,
    createdReason: row.createdReason,
    clockInLocation: locationOf(row),
    clockInZone: zoneOf(row),
    voided:
      row.voidedAt && row.voidReason && row.voidedBy
        ? { at: row.voidedAt, reason: row.voidReason, by: row.voidedBy }
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
