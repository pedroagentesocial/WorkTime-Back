import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type { WorkSiteReader } from '../application/ports/work-site.reader.js';
import type { WorkSiteRef } from '../domain/work-zone.js';

interface Deps {
  db: PrismaDb;
}

export class PrismaWorkSiteReader implements WorkSiteReader {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async listActive(companyId: string): Promise<WorkSiteRef[]> {
    const rows = await this.db.client.workSite.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, latitude: true, longitude: true, radiusM: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(({ radiusM, ...site }) => ({ ...site, radiusMeters: radiusM }));
  }
}
