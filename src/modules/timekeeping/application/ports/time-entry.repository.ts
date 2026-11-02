import type { Page, PageRequest } from '#shared/application/pagination.js';
import type {
  TimeEntry,
  TimeEntryCloseSource,
  TimeEntrySource,
  TimeRange,
} from '../../domain/time-entry.js';
import type { ClockLocation } from '../../domain/clock-location.js';
import type { ClockZone } from '../../domain/work-zone.js';
import type { EmployeeDayTotal } from '../../domain/company-timesheet.js';
import type { DailyTotal } from '../../domain/timesheet.js';
import type { WorkDateRange } from '../../domain/work-date-range.js';

export interface EmployeeSummary {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly employeeCode: string | null;
}

export interface TimeEntryView {
  readonly id: string;
  readonly employee: EmployeeSummary;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly timezone: string;
  readonly workDate: string;
  readonly source: TimeEntrySource;
  readonly closeSource: TimeEntryCloseSource | null;
  readonly corrections: number;
  readonly createdReason: string | null;
  readonly clockInLocation: ClockLocation | null;
  readonly clockInZone: ClockZone | null;
  readonly voided: {
    readonly at: Date;
    readonly reason: string;
    readonly by: { readonly id: string; readonly firstName: string; readonly lastName: string };
  } | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TimeEntryFilter extends WorkDateRange {
  readonly employeeId?: string | undefined;
  readonly status?: 'open' | 'closed' | 'voided' | undefined;
  // without: sin ubicacion guardada; outside: marcados fuera de una zona de trabajo
  readonly location?: 'without' | 'outside' | undefined;
}

export interface TimeEntryPage extends Page<TimeEntryView> {
  readonly totalCentihours: number;
}

export interface OpenEntryBlocker {
  readonly timeEntryId: string;
  readonly employee: EmployeeSummary;
  readonly workDate: string;
}

export interface OverLimitEntry {
  readonly id: string;
  readonly employeeId: string;
  readonly limitMinutes: number;
}

export interface NewCorrection {
  readonly id: string;
  readonly companyId: string;
  readonly timeEntryId: string;
  readonly correctedById: string;
  readonly previousClockInAt: Date;
  readonly previousClockOutAt: Date | null;
  readonly newClockInAt: Date;
  readonly newClockOutAt: Date | null;
  readonly reason: string;
}

export interface CorrectionView {
  readonly id: string;
  readonly correctedBy: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
  };
  readonly previousClockInAt: Date;
  readonly previousClockOutAt: Date | null;
  readonly newClockInAt: Date;
  readonly newClockOutAt: Date | null;
  readonly reason: string;
  readonly createdAt: Date;
}

// Todo acceso por id exige companyId para aislar empresas
export interface TimeEntryRepository {
  findOpenByEmployee(employeeId: string): Promise<TimeEntry | null>;
  // No devuelve registros anulados
  findById(companyId: string, id: string): Promise<TimeEntry | null>;
  insert(entry: TimeEntry): Promise<void>;
  // Solo si la entrada sigue como se leyo: una correccion simultanea de la hora de entrada la deja abierta
  closeIfOpen(
    companyId: string,
    id: string,
    at: Date,
    closeSource: TimeEntryCloseSource,
    expectedClockInAt: Date,
  ): Promise<boolean>;
  findOpenUpTo(companyId: string, workDate: string, limit: number): Promise<OpenEntryBlocker[]>;
  findOpenOfInactiveEmployees(
    limit: number,
  ): Promise<{ id: string; employeeId: string; companyId: string }[]>;
  voidIfActive(
    companyId: string,
    id: string,
    voided: { at: Date; byId: string; reason: string },
  ): Promise<boolean>;
  hasEntriesOn(employeeId: string, workDate: string): Promise<boolean>;
  closedSecondsOn(employeeId: string, workDate: string): Promise<number>;
  closedSecondsByEmployeeAndDay(
    employeeIds: readonly string[],
    workDates: readonly string[],
  ): Promise<Map<string, number>>;
  findOverLimit(now: Date): Promise<OverLimitEntry[]>;
  update(entry: TimeEntry, expected: TimeRange): Promise<boolean>;
  lockEmployee(companyId: string, employeeId: string): Promise<void>;
  hasOverlap(
    employeeId: string,
    range: { from: Date; to: Date | null },
    exceptId: string,
  ): Promise<boolean>;

  addCorrection(correction: NewCorrection): Promise<void>;
  listCorrections(companyId: string, timeEntryId: string): Promise<CorrectionView[]>;

  findViewById(companyId: string, id: string): Promise<TimeEntryView | null>;
  list(companyId: string, filter: TimeEntryFilter, page: PageRequest): Promise<TimeEntryPage>;
  listOpen(companyId: string): Promise<TimeEntryView[]>;
  dailyTotals(
    companyId: string,
    employeeId: string,
    range: { from: string; to: string },
  ): Promise<DailyTotal[]>;
  periodTotals(companyId: string, range: { from: string; to: string }): Promise<EmployeeDayTotal[]>;
}
