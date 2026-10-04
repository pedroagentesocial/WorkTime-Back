import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { WorkDateRange } from '../../domain/work-date-range.js';
import type { EmployeeSummary } from './time-entry.repository.js';

export interface DailyReportRecord {
  readonly id: string;
  readonly employeeId: string;
  readonly workDate: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DailyReportView extends DailyReportRecord {
  readonly employee: EmployeeSummary;
  readonly revisions: number;
}

export interface DailyReportRevisionView {
  readonly id: string;
  readonly content: string;
  readonly savedAt: Date;
}

export interface DailyReportFilter extends WorkDateRange {
  readonly employeeId?: string | undefined;
}

export interface NewDailyReport {
  readonly id: string;
  readonly companyId: string;
  readonly employeeId: string;
  readonly workDate: string;
  readonly content: string;
}

export interface DayWithoutReport {
  readonly employeeId: string;
  readonly workDate: string;
}

export interface DailyReportRepository {
  findDaysWithoutReport(
    companyId: string,
    range: { from: string; to: string },
    employeeId?: string,
  ): Promise<DayWithoutReport[]>;
  find(employeeId: string, workDate: string): Promise<DailyReportRecord | null>;
  save(report: NewDailyReport, previous: DailyReportRecord | null): Promise<void>;
  findView(companyId: string, id: string): Promise<DailyReportView | null>;
  list(
    companyId: string,
    filter: DailyReportFilter,
    page: PageRequest,
  ): Promise<Page<DailyReportView>>;
  listRevisions(companyId: string, reportId: string): Promise<DailyReportRevisionView[]>;
}
