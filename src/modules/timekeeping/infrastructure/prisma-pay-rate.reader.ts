import type { PayKind } from '#shared/domain/pay-rules.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type { PayRateReader } from '../application/ports/pay-rate.reader.js';
import type { CompanyPaySetup, InactiveSpan, PayRate } from '../domain/pay.js';

interface Deps {
  db: PrismaDb;
}

const toDay = (date: Date) => date.toISOString().slice(0, 10);

export class PrismaPayRateReader implements PayRateReader {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async setupOf(companyId: string, until: string): Promise<CompanyPaySetup | null> {
    const company = await this.db.client.company.findUnique({
      where: { id: companyId },
      select: { currency: true },
    });
    if (!company) return null;

    const rates = await this.db.client.employeePayRate.findMany({
      where: { companyId, effectiveFrom: { lte: new Date(`${until}T00:00:00.000Z`) } },
      select: { employeeId: true, kind: true, amountCents: true, effectiveFrom: true },
    });
    const spans = await this.db.client.employeeInactiveSpan.findMany({
      where: { companyId, fromDay: { lte: new Date(`${until}T00:00:00.000Z`) } },
      select: { employeeId: true, fromDay: true, toDay: true },
    });

    const ratesByEmployee = new Map<string, PayRate[]>();
    for (const rate of rates) {
      const list = ratesByEmployee.get(rate.employeeId) ?? [];
      list.push({
        kind: rate.kind as PayKind,
        amountCents: Number(rate.amountCents),
        effectiveFrom: toDay(rate.effectiveFrom),
      });
      ratesByEmployee.set(rate.employeeId, list);
    }
    const inactiveSpansByEmployee = new Map<string, InactiveSpan[]>();
    for (const span of spans) {
      const list = inactiveSpansByEmployee.get(span.employeeId) ?? [];
      list.push({ from: toDay(span.fromDay), to: span.toDay ? toDay(span.toDay) : null });
      inactiveSpansByEmployee.set(span.employeeId, list);
    }
    return { currency: company.currency, ratesByEmployee, inactiveSpansByEmployee };
  }
}
