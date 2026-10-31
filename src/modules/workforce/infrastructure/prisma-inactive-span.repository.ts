import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  InactiveSpanRepository,
  InactiveSpanView,
} from '../application/ports/inactive-span.repository.js';

interface Deps {
  db: PrismaDb;
}

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

export class PrismaInactiveSpanRepository implements InactiveSpanRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async list(companyId: string, employeeId: string): Promise<InactiveSpanView[]> {
    const rows = await this.db.client.employeeInactiveSpan.findMany({
      where: { companyId, employeeId },
      orderBy: { fromDay: 'asc' },
      select: { fromDay: true, toDay: true },
    });
    return rows.map((row) => ({
      fromDay: toDay(row.fromDay),
      toDay: row.toDay ? toDay(row.toDay) : null,
    }));
  }

  async start(companyId: string, employeeId: string, fromDay: string): Promise<void> {
    await this.db.client.employeeInactiveSpan.create({
      data: { companyId, employeeId, fromDay: toDate(fromDay) },
    });
  }

  async end(companyId: string, employeeId: string, fromDay: string, toDay: string): Promise<void> {
    await this.db.client.employeeInactiveSpan.updateMany({
      where: { companyId, employeeId, fromDay: toDate(fromDay) },
      data: { toDay: toDate(toDay) },
    });
  }

  async remove(companyId: string, employeeId: string, fromDay: string): Promise<void> {
    await this.db.client.employeeInactiveSpan.deleteMany({
      where: { companyId, employeeId, fromDay: toDate(fromDay) },
    });
  }
}
