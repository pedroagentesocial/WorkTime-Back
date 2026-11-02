import type { PageRequest } from '#shared/application/pagination.js';
import type { ClockLocation } from '../../domain/clock-location.js';
import type { ClockZone } from '../../domain/work-zone.js';
import type { TimesheetEmployee } from '../../domain/company-timesheet.js';

export interface EmployeeProfile {
  readonly employeeId: string;
  readonly userId: string;
  readonly companyId: string;
  readonly effectiveTimezone: string;
  readonly dailyLimitMinutes: number | null;
  readonly active: boolean;
  readonly requireDailyReport: boolean;
  readonly dailyReportRequiredSince: string;
  // Si la empresa solo deja marcar la entrada dentro de una zona de trabajo
  readonly enforceWorkSites: boolean;
  // Si puede registrar llegadas sin marcar entrada: lo suyo manda y, si no tiene, lo de la empresa
  readonly allowCheckIns: boolean;
  // Permiso del admin para corregir sus horas: cuando vence y cuantos dias hacia atras
  readonly selfEdit: {
    readonly allowed: boolean;
    readonly until: string | null;
    readonly days: number;
  };
}

export interface RosterEmployee {
  readonly employeeId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly employeeCode: string | null;
  readonly effectiveTimezone: string;
  readonly dailyLimitMinutes: number | null;
  readonly openEntry: {
    readonly id: string;
    readonly clockInAt: Date;
    readonly workDate: string;
    readonly dailyLimitWaived: boolean;
    readonly clockInLocation: ClockLocation | null;
    readonly clockInZone: ClockZone | null;
  } | null;
}

export interface RosterFilter {
  readonly search?: string | undefined;
  readonly status?: 'in' | 'out' | undefined;
}

export interface RosterPage {
  readonly items: readonly RosterEmployee[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface ReportPolicy {
  readonly required: boolean;
  readonly since: string;
}

export interface EmployeeDirectory {
  listActive(companyId: string): Promise<RosterEmployee[]>;
  reportPolicy(companyId: string): Promise<ReportPolicy | null>;
  companyTimezone(companyId: string): Promise<string | null>;
  listForTimesheet(
    companyId: string,
    range: { from: string; to: string },
    search: string | undefined,
  ): Promise<TimesheetEmployee[]>;
  listRoster(companyId: string, filter: RosterFilter, page: PageRequest): Promise<RosterPage>;
  findByUser(companyId: string, userId: string): Promise<EmployeeProfile | null>;
  exists(companyId: string, employeeId: string): Promise<boolean>;
  findByEmployee(companyId: string, employeeId: string): Promise<EmployeeProfile | null>;
}
