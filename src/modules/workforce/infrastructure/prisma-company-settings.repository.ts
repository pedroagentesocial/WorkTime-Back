import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type {
  CompanySettingsPatch,
  CompanySettingsRepository,
  CompanySettingsView,
} from '../application/ports/company-settings.repository.js';

interface Deps {
  db: PrismaDb;
}

export class PrismaCompanySettingsRepository implements CompanySettingsRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async findById(companyId: string): Promise<CompanySettingsView | null> {
    const row = await this.db.client.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        code: true,
        employeeCodePrefix: true,
        name: true,
        timezone: true,
        status: true,
        dailyLimitMinutes: true,
        requireDailyReport: true,
        enforceWorkSites: true,
        allowCheckIns: true,
        selfEditDays: true,
        currency: true,
        maxEmployees: true,
        _count: { select: { employees: { where: { user: { status: 'active' } } } } },
      },
    });
    if (!row) return null;
    const { _count, ...company } = row;
    return { ...company, activeEmployees: _count.employees };
  }

  async update(companyId: string, patch: CompanySettingsPatch): Promise<void> {
    await this.db.client.company.update({
      where: { id: companyId },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.timezone !== undefined && { timezone: patch.timezone }),
        ...(patch.requireDailyReport !== undefined && {
          requireDailyReport: patch.requireDailyReport,
        }),
        ...(patch.enforceWorkSites !== undefined && {
          enforceWorkSites: patch.enforceWorkSites,
        }),
        ...(patch.allowCheckIns !== undefined && { allowCheckIns: patch.allowCheckIns }),
        ...(patch.currency !== undefined && { currency: patch.currency }),
        ...(patch.selfEditDays !== undefined && { selfEditDays: patch.selfEditDays }),
        ...(patch.dailyLimitMinutes !== undefined && {
          dailyLimitMinutes: patch.dailyLimitMinutes,
        }),
        ...(patch.dailyReportRequiredSince !== undefined && {
          dailyReportRequiredSince: new Date(`${patch.dailyReportRequiredSince}T00:00:00.000Z`),
        }),
      },
    });
  }
}
