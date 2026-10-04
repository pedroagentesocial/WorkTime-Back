import { toOffset, type Page, type PageRequest } from '#shared/application/pagination.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type { Prisma } from '#generated/prisma/client.js';
import {
  ATTENDANCE_ACTIVITY_TYPES,
  type AttendanceActivityDetails,
  type AttendanceActivityFilter,
  type AttendanceActivityReader,
  type AttendanceActivityType,
  type AttendanceActivityView,
} from '../application/ports/attendance-activity.reader.js';
import type { EmployeeSummary } from '../application/ports/time-entry.repository.js';

interface Deps {
  db: PrismaDb;
}

const TEXT_KEYS = [
  'timeEntryId',
  'reason',
  'clockInAt',
  'previousClockInAt',
  'periodStart',
  'periodEnd',
] as const;
const NULLABLE_TEXT_KEYS = ['clockOutAt', 'previousClockOutAt'] as const;

function detailsOf(metadata: Prisma.JsonValue): AttendanceActivityDetails {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const source = metadata as Record<string, unknown>;
  const details: Record<string, string | boolean | number | null> = {};
  for (const key of TEXT_KEYS) {
    if (typeof source[key] === 'string') details[key] = source[key];
  }
  for (const key of NULLABLE_TEXT_KEYS) {
    if (typeof source[key] === 'string' || source[key] === null) details[key] = source[key];
  }
  if (typeof source.totalHours === 'number') details.totalHours = source.totalHours;
  if (typeof source.overrideDailyLimit === 'boolean') {
    details.overrideDailyLimit = source.overrideDailyLimit;
  }
  return details;
}

function employeeIdOf(metadata: Prisma.JsonValue): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).employeeId;
  return typeof value === 'string' ? value : null;
}

export class PrismaAttendanceActivityReader implements AttendanceActivityReader {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async list(
    companyId: string,
    filter: AttendanceActivityFilter,
    page: PageRequest,
  ): Promise<Page<AttendanceActivityView>> {
    const where: Prisma.SecurityEventWhereInput = {
      companyId,
      type: filter.type ?? { in: [...ATTENDANCE_ACTIVITY_TYPES] },
      ...((filter.from ?? filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
      ...(filter.employeeId && { metadata: { path: ['employeeId'], equals: filter.employeeId } }),
    };

    const [rows, total] = await Promise.all([
      this.db.client.securityEvent.findMany({
        where,
        select: {
          id: true,
          type: true,
          createdAt: true,
          metadata: true,
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toOffset(page),
      }),
      this.db.client.securityEvent.count({ where }),
    ]);

    const employeeIds = [
      ...new Set(rows.map((row) => employeeIdOf(row.metadata)).filter((id) => id !== null)),
    ];
    const employees = new Map<string, EmployeeSummary>();
    if (employeeIds.length > 0) {
      const found = await this.db.client.employee.findMany({
        where: { companyId, id: { in: employeeIds } },
        select: {
          id: true,
          employeeCode: true,
          user: { select: { firstName: true, lastName: true } },
        },
      });
      for (const employee of found) {
        employees.set(employee.id, {
          id: employee.id,
          firstName: employee.user.firstName,
          lastName: employee.user.lastName,
          employeeCode: employee.employeeCode,
        });
      }
    }

    const items = rows.map((row) => ({
      id: row.id,
      type: row.type as AttendanceActivityType,
      occurredAt: row.createdAt,
      actor: row.user,
      employee: employees.get(employeeIdOf(row.metadata) ?? '') ?? null,
      details: detailsOf(row.metadata),
    }));
    return { items, page: page.page, limit: page.limit, total };
  }
}
