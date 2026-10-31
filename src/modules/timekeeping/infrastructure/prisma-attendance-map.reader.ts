import type { Prisma } from '#generated/prisma/client.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  AttendanceMapFilter,
  AttendanceMapPoint,
  AttendanceMapReader,
  AttendanceMapResult,
} from '../application/ports/attendance-map.reader.js';
import type { ClockZone } from '../domain/work-zone.js';

interface Deps {
  db: PrismaDb;
}

const SELECT = {
  id: true,
  workDate: true,
  clockInAt: true,
  clockOutAt: true,
  timezone: true,
  clockInLatitude: true,
  clockInLongitude: true,
  clockInAccuracyM: true,
  clockInZone: true,
  clockInSiteId: true,
  clockInDistanceM: true,
  clockInSite: { select: { name: true } },
  company: { select: { id: true, name: true, code: true } },
  employee: {
    select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.TimeEntrySelect;

type Row = Prisma.TimeEntryGetPayload<{ select: typeof SELECT }>;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

export class PrismaAttendanceMapReader implements AttendanceMapReader {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async list(
    companyIds: readonly string[],
    filter: AttendanceMapFilter,
    limit: number,
  ): Promise<AttendanceMapResult> {
    const where: Prisma.TimeEntryWhereInput = {
      companyId: { in: [...companyIds] },
      voidedAt: null,
      clockInLatitude: { not: null },
      ...(filter.employeeId && { employeeId: filter.employeeId }),
      ...((filter.from ?? filter.to) && {
        workDate: {
          ...(filter.from && { gte: toDbDate(filter.from) }),
          ...(filter.to && { lte: toDbDate(filter.to) }),
        },
      }),
    };
    const rows = await this.db.client.timeEntry.findMany({
      where,
      select: SELECT,
      orderBy: [{ clockInAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return {
      points: rows.slice(0, limit).flatMap((row) => toPoint(row)),
      truncated: rows.length > limit,
    };
  }
}

function toPoint(row: Row): AttendanceMapPoint[] {
  if (
    row.clockInLatitude === null ||
    row.clockInLongitude === null ||
    row.clockInAccuracyM === null
  ) {
    return [];
  }
  const zone: ClockZone | null =
    (row.clockInZone === 'inside' || row.clockInZone === 'outside') &&
    row.clockInSiteId !== null &&
    row.clockInDistanceM !== null
      ? {
          status: row.clockInZone,
          siteId: row.clockInSiteId,
          siteName: row.clockInSite?.name ?? '',
          distanceMeters: row.clockInDistanceM,
        }
      : null;
  return [
    {
      id: row.id,
      company: row.company,
      employee: {
        id: row.employee.id,
        firstName: row.employee.user.firstName,
        lastName: row.employee.user.lastName,
        employeeCode: row.employee.employeeCode,
      },
      workDate: row.workDate.toISOString().slice(0, 10),
      clockInAt: row.clockInAt,
      timezone: row.timezone,
      open: row.clockOutAt === null,
      clockInLocation: {
        latitude: row.clockInLatitude,
        longitude: row.clockInLongitude,
        accuracyMeters: row.clockInAccuracyM,
      },
      clockInZone: zone,
    },
  ];
}
