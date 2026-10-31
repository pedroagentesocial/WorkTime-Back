import { toOffset, type PageRequest } from '#shared/application/pagination.js';
import { DailyLimit } from '#shared/domain/daily-limit.js';
import { resolveTimezone } from '#shared/domain/timezone.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type { Prisma } from '#generated/prisma/client.js';
import type {
  EmployeeDirectory,
  EmployeeProfile,
  ReportPolicy,
  RosterEmployee,
  RosterFilter,
  RosterPage,
} from '../application/ports/employee-directory.js';
import type { TimesheetEmployee } from '../domain/company-timesheet.js';
import type { ClockZone } from '../domain/work-zone.js';

interface Deps {
  db: PrismaDb;
}

const ROSTER_SELECT = {
  id: true,
  employeeCode: true,
  timezone: true,
  dailyLimitMinutes: true,
  company: { select: { timezone: true, dailyLimitMinutes: true } },
  user: { select: { firstName: true, lastName: true } },
  timeEntries: {
    where: { clockOutAt: null, voidedAt: null },
    select: {
      id: true,
      clockInAt: true,
      workDate: true,
      dailyLimitWaived: true,
      clockInLatitude: true,
      clockInLongitude: true,
      clockInAccuracyM: true,
      clockInZone: true,
      clockInSiteId: true,
      clockInDistanceM: true,
      clockInSite: { select: { name: true } },
    },
    take: 1,
  },
} satisfies Prisma.EmployeeSelect;

const ROSTER_ORDER = [
  { user: { lastName: 'asc' } },
  { user: { firstName: 'asc' } },
  { id: 'asc' },
] satisfies Prisma.EmployeeOrderByWithRelationInput[];

function zoneOf(row: {
  clockInZone: string | null;
  clockInSiteId: string | null;
  clockInDistanceM: number | null;
  clockInSite: { name: string } | null;
}): ClockZone | null {
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

function toRosterEmployee(row: Prisma.EmployeeGetPayload<{ select: typeof ROSTER_SELECT }>) {
  const open = row.timeEntries[0];
  return {
    employeeId: row.id,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
    employeeCode: row.employeeCode,
    effectiveTimezone: resolveTimezone(row.timezone, row.company.timezone),
    dailyLimitMinutes: DailyLimit.resolve(row.dailyLimitMinutes, row.company.dailyLimitMinutes),
    openEntry: open
      ? {
          id: open.id,
          clockInAt: open.clockInAt,
          workDate: open.workDate.toISOString().slice(0, 10),
          dailyLimitWaived: open.dailyLimitWaived,
          clockInLocation:
            open.clockInLatitude !== null && open.clockInLongitude !== null
              ? {
                  latitude: open.clockInLatitude,
                  longitude: open.clockInLongitude,
                  accuracyMeters: open.clockInAccuracyM ?? 0,
                }
              : null,
          clockInZone: zoneOf(open),
        }
      : null,
  };
}

export class PrismaEmployeeDirectory implements EmployeeDirectory {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async listForTimesheet(
    companyId: string,
    range: { from: string; to: string },
    search: string | undefined,
  ): Promise<TimesheetEmployee[]> {
    const contains = search ? { contains: search, mode: 'insensitive' as const } : undefined;
    const rows = await this.db.client.employee.findMany({
      where: {
        companyId,
        OR: [
          { user: { status: 'active' } },
          // Dado de baja durante o despues del periodo: aunque no marco, puede tener sueldo fijo
          { inactiveSpans: { some: { fromDay: { gt: new Date(`${range.from}T00:00:00.000Z`) } } } },
          {
            timeEntries: {
              some: {
                voidedAt: null,
                workDate: {
                  gte: new Date(`${range.from}T00:00:00.000Z`),
                  lte: new Date(`${range.to}T00:00:00.000Z`),
                },
              },
            },
          },
        ],
        ...(contains && {
          AND: [
            {
              OR: [
                { employeeCode: contains },
                { user: { firstName: contains } },
                { user: { lastName: contains } },
                { user: { email: contains } },
              ],
            },
          ],
        }),
      },
      select: {
        id: true,
        employeeCode: true,
        user: { select: { firstName: true, lastName: true, status: true } },
      },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      employeeCode: row.employeeCode,
      active: row.user.status === 'active',
    }));
  }

  async listActive(companyId: string): Promise<RosterEmployee[]> {
    const rows = await this.db.client.employee.findMany({
      where: { companyId, user: { status: 'active' } },
      select: ROSTER_SELECT,
      orderBy: ROSTER_ORDER,
    });
    return rows.map(toRosterEmployee);
  }

  async companyTimezone(companyId: string): Promise<string | null> {
    const row = await this.db.client.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    return row?.timezone ?? null;
  }

  async reportPolicy(companyId: string): Promise<ReportPolicy | null> {
    const row = await this.db.client.company.findUnique({
      where: { id: companyId },
      select: { requireDailyReport: true, dailyReportRequiredSince: true },
    });
    return row
      ? {
          required: row.requireDailyReport,
          since: row.dailyReportRequiredSince.toISOString().slice(0, 10),
        }
      : null;
  }

  async listRoster(
    companyId: string,
    filter: RosterFilter,
    page: PageRequest,
  ): Promise<RosterPage> {
    const contains = filter.search
      ? { contains: filter.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      user: { status: 'active' },
      ...(filter.status === 'in' && {
        timeEntries: { some: { clockOutAt: null, voidedAt: null } },
      }),
      ...(filter.status === 'out' && {
        timeEntries: { none: { clockOutAt: null, voidedAt: null } },
      }),
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
        select: ROSTER_SELECT,
        orderBy: ROSTER_ORDER,
        ...toOffset(page),
      }),
      this.db.client.employee.count({ where }),
    ]);

    const items = rows.map(toRosterEmployee);
    return { items, page: page.page, limit: page.limit, total };
  }

  async findByUser(companyId: string, userId: string): Promise<EmployeeProfile | null> {
    return this.findProfile({ companyId, userId, user: { status: 'active' } });
  }

  async findByEmployee(companyId: string, employeeId: string): Promise<EmployeeProfile | null> {
    return this.findProfile({ companyId, id: employeeId });
  }

  private async findProfile(where: Prisma.EmployeeWhereInput): Promise<EmployeeProfile | null> {
    const row = await this.db.client.employee.findFirst({
      where,
      select: {
        id: true,
        userId: true,
        companyId: true,
        timezone: true,
        dailyLimitMinutes: true,
        allowCheckIns: true,
        allowSelfEdit: true,
        selfEditUntil: true,
        user: { select: { status: true } },
        company: {
          select: {
            timezone: true,
            dailyLimitMinutes: true,
            requireDailyReport: true,
            dailyReportRequiredSince: true,
            enforceWorkSites: true,
            allowCheckIns: true,
            selfEditDays: true,
          },
        },
      },
    });
    if (!row) return null;
    return {
      employeeId: row.id,
      userId: row.userId,
      companyId: row.companyId,
      effectiveTimezone: resolveTimezone(row.timezone, row.company.timezone),
      dailyLimitMinutes: DailyLimit.resolve(row.dailyLimitMinutes, row.company.dailyLimitMinutes),
      active: row.user.status === 'active',
      requireDailyReport: row.company.requireDailyReport,
      dailyReportRequiredSince: row.company.dailyReportRequiredSince.toISOString().slice(0, 10),
      enforceWorkSites: row.company.enforceWorkSites,
      allowCheckIns: row.allowCheckIns ?? row.company.allowCheckIns,
      selfEdit: {
        allowed: row.allowSelfEdit,
        until: row.selfEditUntil ? row.selfEditUntil.toISOString().slice(0, 10) : null,
        days: row.company.selfEditDays,
      },
    };
  }

  async exists(companyId: string, employeeId: string): Promise<boolean> {
    return (await this.db.client.employee.count({ where: { id: employeeId, companyId } })) > 0;
  }
}
