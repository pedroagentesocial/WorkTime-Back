import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  NewWorkSite,
  WorkSitePatch,
  WorkSiteRepository,
  WorkSiteView,
} from '../application/ports/work-site.repository.js';

interface Deps {
  db: PrismaDb;
}

const SELECT = {
  id: true,
  name: true,
  latitude: true,
  longitude: true,
  radiusM: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface Row {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toView({ radiusM, ...row }: Row): WorkSiteView {
  return { ...row, radiusMeters: radiusM };
}

export class PrismaWorkSiteRepository implements WorkSiteRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async list(companyId: string): Promise<WorkSiteView[]> {
    const rows = await this.db.client.workSite.findMany({
      where: { companyId },
      select: SELECT,
      orderBy: [{ active: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toView);
  }

  async findById(companyId: string, id: string): Promise<WorkSiteView | null> {
    const row = await this.db.client.workSite.findFirst({
      where: { id, companyId },
      select: SELECT,
    });
    return row ? toView(row) : null;
  }

  async insert(companyId: string, site: NewWorkSite): Promise<WorkSiteView> {
    const row = await this.db.client.workSite.create({
      data: {
        id: site.id,
        companyId,
        name: site.name,
        latitude: site.latitude,
        longitude: site.longitude,
        radiusM: site.radiusMeters,
      },
      select: SELECT,
    });
    return toView(row);
  }

  async update(companyId: string, id: string, patch: WorkSitePatch): Promise<void> {
    await this.db.client.workSite.updateMany({
      where: { id, companyId },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.latitude !== undefined && { latitude: patch.latitude }),
        ...(patch.longitude !== undefined && { longitude: patch.longitude }),
        ...(patch.radiusMeters !== undefined && { radiusM: patch.radiusMeters }),
        ...(patch.active !== undefined && { active: patch.active }),
      },
    });
  }

  async lockAndCount(companyId: string): Promise<{ total: number; active: number } | null> {
    const rows = await this.db.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    const [total, active] = await Promise.all([
      this.db.client.workSite.count({ where: { companyId } }),
      this.db.client.workSite.count({ where: { companyId, active: true } }),
    ]);
    return { total, active };
  }
}
