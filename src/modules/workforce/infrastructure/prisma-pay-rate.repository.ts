import type { PayKind } from '#shared/domain/pay-rules.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  NewPayRate,
  PayRateRepository,
  PayRateView,
} from '../application/ports/pay-rate.repository.js';

interface Deps {
  db: PrismaDb;
}

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

function toView(row: {
  id: string;
  kind: string;
  amountCents: bigint;
  effectiveFrom: Date;
  changedById: string;
  createdAt: Date;
  updatedAt: Date;
}): PayRateView {
  return {
    id: row.id,
    kind: row.kind as PayKind,
    amountCents: Number(row.amountCents),
    effectiveFrom: toDay(row.effectiveFrom),
    changedById: row.changedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaPayRateRepository implements PayRateRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async list(companyId: string, employeeId: string): Promise<PayRateView[]> {
    const rows = await this.db.client.employeePayRate.findMany({
      where: { companyId, employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rows.map(toView);
  }

  async find(companyId: string, employeeId: string, rateId: string): Promise<PayRateView | null> {
    const row = await this.db.client.employeePayRate.findFirst({
      where: { id: rateId, companyId, employeeId },
    });
    return row ? toView(row) : null;
  }

  async remove(companyId: string, rateId: string): Promise<void> {
    await this.db.client.employeePayRate.deleteMany({ where: { id: rateId, companyId } });
  }

  async lastClosedDay(companyId: string): Promise<string | null> {
    const last = await this.db.client.payPeriodClosure.findFirst({
      where: { companyId },
      orderBy: { periodEnd: 'desc' },
      select: { periodEnd: true },
    });
    return last ? toDay(last.periodEnd) : null;
  }

  async save(companyId: string, employeeId: string, rate: NewPayRate): Promise<void> {
    const data = {
      kind: rate.kind,
      amountCents: BigInt(rate.amountCents),
      changedById: rate.changedById,
    };
    await this.db.client.employeePayRate.upsert({
      where: {
        employeeId_effectiveFrom: { employeeId, effectiveFrom: toDate(rate.effectiveFrom) },
      },
      create: {
        id: rate.id,
        companyId,
        employeeId,
        effectiveFrom: toDate(rate.effectiveFrom),
        ...data,
      },
      update: data,
    });
  }

  async lockAndLastClosedDay(companyId: string): Promise<string | null> {
    // Mismo candado compartido que usan los cambios de horas frente al cierre
    await this.db.client
      .$queryRaw`SELECT id FROM companies WHERE id = ${companyId}::uuid FOR SHARE`;
    return this.lastClosedDay(companyId);
  }

  async currencyOf(companyId: string): Promise<string | null> {
    const company = await this.db.client.company.findUnique({
      where: { id: companyId },
      select: { currency: true },
    });
    return company?.currency ?? null;
  }
}
