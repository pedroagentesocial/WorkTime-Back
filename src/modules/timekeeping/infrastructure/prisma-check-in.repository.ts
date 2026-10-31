import type { Prisma } from '#generated/prisma/client.js';
import { toOffset, type Page, type PageRequest } from '#shared/application/pagination.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  CheckInFilter,
  CheckInRepository,
  CheckInView,
  NewCheckIn,
} from '../application/ports/check-in.repository.js';
import type { ClockZone } from '../domain/work-zone.js';

interface Deps {
  db: PrismaDb;
}

const SELECT = {
  id: true,
  checkedInAt: true,
  timezone: true,
  workDate: true,
  latitude: true,
  longitude: true,
  accuracyM: true,
  zone: true,
  siteId: true,
  distanceM: true,
  note: true,
  voidedAt: true,
  voidReason: true,
  site: { select: { name: true } },
  voidedBy: { select: { id: true, firstName: true, lastName: true } },
  employee: {
    select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.CheckInSelect;

type Row = Prisma.CheckInGetPayload<{ select: typeof SELECT }>;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

export class PrismaCheckInRepository implements CheckInRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async insert(checkIn: NewCheckIn): Promise<void> {
    await this.db.client.checkIn.create({
      data: {
        id: checkIn.id,
        companyId: checkIn.companyId,
        employeeId: checkIn.employeeId,
        checkedInAt: checkIn.checkedInAt,
        timezone: checkIn.timezone,
        workDate: toDbDate(checkIn.workDate),
        latitude: checkIn.location.latitude,
        longitude: checkIn.location.longitude,
        accuracyM: checkIn.location.accuracyMeters,
        zone: checkIn.zone?.status ?? null,
        siteId: checkIn.zone?.siteId ?? null,
        distanceM: checkIn.zone?.distanceMeters ?? null,
        note: checkIn.note,
      },
    });
  }

  countOn(employeeId: string, workDate: string): Promise<number> {
    return this.db.client.checkIn.count({ where: { employeeId, workDate: toDbDate(workDate) } });
  }

  async list(
    companyId: string,
    filter: CheckInFilter,
    page: PageRequest,
  ): Promise<Page<CheckInView>> {
    const where: Prisma.CheckInWhereInput = {
      companyId,
      voidedAt: filter.status === 'voided' ? { not: null } : null,
      ...(filter.employeeId && { employeeId: filter.employeeId }),
      ...(filter.location === 'outside' && { zone: 'outside' }),
      ...((filter.from ?? filter.to) && {
        workDate: {
          ...(filter.from && { gte: toDbDate(filter.from) }),
          ...(filter.to && { lte: toDbDate(filter.to) }),
        },
      }),
    };
    const [rows, total] = await Promise.all([
      this.db.client.checkIn.findMany({
        where,
        select: SELECT,
        orderBy: [{ checkedInAt: 'desc' }, { id: 'desc' }],
        ...toOffset(page),
      }),
      this.db.client.checkIn.count({ where }),
    ]);
    return { items: rows.map(toView), page: page.page, limit: page.limit, total };
  }

  async findViewById(companyId: string, id: string): Promise<CheckInView | null> {
    const row = await this.db.client.checkIn.findFirst({
      where: { id, companyId },
      select: SELECT,
    });
    return row ? toView(row) : null;
  }

  async voidIfActive(
    companyId: string,
    id: string,
    voiding: { at: Date; byId: string; reason: string },
  ): Promise<boolean> {
    const { count } = await this.db.client.checkIn.updateMany({
      where: { id, companyId, voidedAt: null },
      data: { voidedAt: voiding.at, voidedById: voiding.byId, voidReason: voiding.reason },
    });
    return count === 1;
  }
}

function toView(row: Row): CheckInView {
  const zone: ClockZone | null =
    (row.zone === 'inside' || row.zone === 'outside') &&
    row.siteId !== null &&
    row.distanceM !== null
      ? {
          status: row.zone,
          siteId: row.siteId,
          siteName: row.site?.name ?? '',
          distanceMeters: row.distanceM,
        }
      : null;
  return {
    id: row.id,
    employee: {
      id: row.employee.id,
      firstName: row.employee.user.firstName,
      lastName: row.employee.user.lastName,
      employeeCode: row.employee.employeeCode,
    },
    checkedInAt: row.checkedInAt,
    timezone: row.timezone,
    workDate: row.workDate.toISOString().slice(0, 10),
    location: { latitude: row.latitude, longitude: row.longitude, accuracyMeters: row.accuracyM },
    zone,
    note: row.note,
    voided:
      row.voidedAt && row.voidReason && row.voidedBy
        ? { at: row.voidedAt, reason: row.voidReason, by: row.voidedBy }
        : null,
  };
}
