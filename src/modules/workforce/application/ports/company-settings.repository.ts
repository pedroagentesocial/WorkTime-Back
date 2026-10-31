import type { CompanyStatus } from '#shared/domain/company-rules.js';

export interface CompanySettingsView {
  readonly id: string;
  readonly code: string;
  readonly employeeCodePrefix: string;
  readonly name: string;
  readonly timezone: string;
  readonly status: CompanyStatus;
  readonly dailyLimitMinutes: number | null;
  readonly requireDailyReport: boolean;
  readonly enforceWorkSites: boolean;
  readonly allowCheckIns: boolean;
  // Dias hacia atras en que el empleado con permiso puede corregir sus horas
  readonly selfEditDays: number;
  readonly currency: string;
  readonly maxEmployees: number;
  readonly activeEmployees: number;
}

export interface CompanySettingsPatch {
  readonly name?: string | undefined;
  readonly timezone?: string | undefined;
  readonly dailyLimitMinutes?: number | null | undefined;
  readonly requireDailyReport?: boolean | undefined;
  readonly enforceWorkSites?: boolean | undefined;
  readonly allowCheckIns?: boolean | undefined;
  readonly selfEditDays?: number | undefined;
  readonly currency?: string | undefined;
  readonly dailyReportRequiredSince?: string | undefined;
}

export interface CompanySettingsRepository {
  findById(companyId: string): Promise<CompanySettingsView | null>;
  update(companyId: string, patch: CompanySettingsPatch): Promise<void>;
}
