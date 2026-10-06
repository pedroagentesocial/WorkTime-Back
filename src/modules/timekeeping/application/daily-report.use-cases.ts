import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { assertValidWorkDateRange } from '../domain/work-date-range.js';
import { saveDailyReport, type DailyReportWriterDeps } from './daily-report-writer.js';
import type {
  DailyReportFilter,
  DailyReportRevisionView,
  DailyReportView,
} from './ports/daily-report.repository.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps extends DailyReportWriterDeps {
  employeeDirectory: EmployeeDirectory;
  transactions: TransactionRunner;
  clock: Clock;
}

export interface SaveMyDailyReportInput {
  readonly actor: Actor;
  readonly workDate: string;
  readonly content: string;
}

export class SaveMyDailyReportUseCase implements UseCase<SaveMyDailyReportInput, DailyReportView> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, workDate, content }: SaveMyDailyReportInput): Promise<DailyReportView> {
    const profile = await this.deps.employeeDirectory.findByUser(companyIdOf(actor), actor.userId);
    if (!profile) throw TimekeepingErrors.employeeProfileNotFound();

    await this.deps.transactions.run(() =>
      saveDailyReport(this.deps, profile, workDate, content, this.deps.clock.now()),
    );

    const saved = await this.deps.dailyReportRepository.find(profile.employeeId, workDate);
    const view = saved
      ? await this.deps.dailyReportRepository.findView(profile.companyId, saved.id)
      : null;
    if (!view) throw TimekeepingErrors.dailyReportNotFound();
    return view;
  }
}

export interface ListDailyReportsInput {
  readonly actor: Actor;
  readonly filter: DailyReportFilter;
  readonly page: PageRequest;
}

type ListDeps = Pick<Deps, 'dailyReportRepository' | 'employeeDirectory'>;

export class ListMyDailyReportsUseCase implements UseCase<
  ListDailyReportsInput,
  Page<DailyReportView>
> {
  constructor(private readonly deps: ListDeps) {}

  async execute({ actor, filter, page }: ListDailyReportsInput): Promise<Page<DailyReportView>> {
    assertValidWorkDateRange(filter);
    const companyId = companyIdOf(actor);
    const profile = await this.deps.employeeDirectory.findByUser(companyId, actor.userId);
    if (!profile) throw TimekeepingErrors.employeeProfileNotFound();
    return this.deps.dailyReportRepository.list(
      companyId,
      { ...filter, employeeId: profile.employeeId },
      page,
    );
  }
}

export class ListCompanyDailyReportsUseCase implements UseCase<
  ListDailyReportsInput,
  Page<DailyReportView>
> {
  constructor(private readonly deps: ListDeps) {}

  async execute({ actor, filter, page }: ListDailyReportsInput): Promise<Page<DailyReportView>> {
    assertValidWorkDateRange(filter);
    const companyId = companyIdOf(actor);
    if (
      filter.employeeId &&
      !(await this.deps.employeeDirectory.exists(companyId, filter.employeeId))
    ) {
      throw TimekeepingErrors.employeeNotFound();
    }
    return this.deps.dailyReportRepository.list(companyId, filter, page);
  }
}

export const MAX_REPORT_EXPORT_ROWS = 5000;
const EXPORT_PAGE_SIZE = 100;

export interface ExportDailyReportsInput {
  readonly actor: Actor;
  readonly filter: DailyReportFilter;
}

export class ExportCompanyDailyReportsUseCase implements UseCase<
  ExportDailyReportsInput,
  DailyReportView[]
> {
  constructor(private readonly deps: ListDeps) {}

  async execute({ actor, filter }: ExportDailyReportsInput): Promise<DailyReportView[]> {
    assertValidWorkDateRange(filter);
    const companyId = companyIdOf(actor);
    if (
      filter.employeeId &&
      !(await this.deps.employeeDirectory.exists(companyId, filter.employeeId))
    ) {
      throw TimekeepingErrors.employeeNotFound();
    }

    const reports: DailyReportView[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.deps.dailyReportRepository.list(companyId, filter, {
        page,
        limit: EXPORT_PAGE_SIZE,
      });
      if (result.total > MAX_REPORT_EXPORT_ROWS) {
        throw TimekeepingErrors.exportTooLarge(MAX_REPORT_EXPORT_ROWS);
      }
      reports.push(...result.items);
      if (result.items.length === 0 || reports.length >= result.total) return reports;
    }
  }
}

export interface DailyReportByIdInput {
  readonly actor: Actor;
  readonly reportId: string;
}

export class ListDailyReportRevisionsUseCase implements UseCase<
  DailyReportByIdInput,
  DailyReportRevisionView[]
> {
  constructor(private readonly deps: Pick<Deps, 'dailyReportRepository'>) {}

  async execute({ actor, reportId }: DailyReportByIdInput): Promise<DailyReportRevisionView[]> {
    const companyId = companyIdOf(actor);
    if (!(await this.deps.dailyReportRepository.findView(companyId, reportId))) {
      throw TimekeepingErrors.dailyReportNotFound();
    }
    return this.deps.dailyReportRepository.listRevisions(companyId, reportId);
  }
}
