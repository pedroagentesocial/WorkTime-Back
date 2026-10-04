import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  NewPeriodClosure,
  PeriodClosureRepository,
  PeriodClosureView,
} from '../application/ports/period-closure.repository.js';
import { Prisma } from '#generated/prisma/client.js';
import { TimekeepingErrors } from '../application/timekeeping-errors.js';

interface Deps {
  db: PrismaDb;
}

const SELECT = {
  id: true,
  periodStart: true,
  periodEnd: true,
  totalCentihours: true,
  closedAt: true,
  closedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PayPeriodClosureSelect;

type Row = Prisma.PayPeriodClosureGetPayload<{ select: typeof SELECT }>;

const toDbDate = (date: string): Date => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date): string => date.toISOString().slice(0, 10);

function toView(row: Row): PeriodClosureView {
  return {
    id: row.id,
    periodStart: fromDbDate(row.periodStart),
    periodEnd: fromDbDate(row.periodEnd),
    totalCentihours: Number(row.totalCentihours),
    closedAt: row.closedAt,
    closedBy: row.closedBy,
  };
}

export class PrismaPeriodClosureRepository implements PeriodClosureRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async find(companyId: string, periodStart: string): Promise<PeriodClosureView | null> {
    const row = await this.db.client.payPeriodClosure.findFirst({
      where: { companyId, periodStart: toDbDate(periodStart) },
      select: SELECT,
    });
    return row ? toView(row) : null;
  }

  async findCovering(companyId: string, workDate: string): Promise<PeriodClosureView | null> {
    const day = toDbDate(workDate);
    const row = await this.db.client.payPeriodClosure.findFirst({
      where: { companyId, periodStart: { lte: day }, periodEnd: { gte: day } },
      select: SELECT,
    });
    return row ? toView(row) : null;
  }

  async insert(closure: NewPeriodClosure): Promise<void> {
    try {
      await this.db.client.payPeriodClosure.create({
        data: {
          id: closure.id,
          companyId: closure.companyId,
          periodStart: toDbDate(closure.periodStart),
          periodEnd: toDbDate(closure.periodEnd),
          totalCentihours: BigInt(closure.totalCentihours),
          closedById: closure.closedById,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw TimekeepingErrors.periodAlreadyClosed();
      }
      throw error;
    }
  }

  async lockForChanges(companyId: string): Promise<void> {
    await this.db.client
      .$queryRaw`SELECT id FROM companies WHERE id = ${companyId}::uuid FOR SHARE`;
  }

  async lockForClosing(companyId: string): Promise<void> {
    await this.db.client
      .$queryRaw`SELECT id FROM companies WHERE id = ${companyId}::uuid FOR NO KEY UPDATE`;
  }
}
