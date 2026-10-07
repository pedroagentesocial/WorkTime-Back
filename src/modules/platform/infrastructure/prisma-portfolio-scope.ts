import type { PortfolioCompany, PortfolioScope } from '#shared/application/portfolio-scope.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';

interface Deps {
  db: PrismaDb;
}

export class PrismaPortfolioScope implements PortfolioScope {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async activeCompaniesOf(userId: string): Promise<PortfolioCompany[]> {
    const rows = await this.db.client.company.findMany({
      where: { status: 'active', memberships: { some: { userId } } },
      select: { id: true, name: true, code: true, timezone: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows;
  }
}
