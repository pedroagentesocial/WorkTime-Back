import type { Actor } from '#shared/application/actor.js';
import type { Page, PageRequest } from '#shared/application/pagination.js';
import { companiesInScope, type PortfolioScope } from '#shared/application/portfolio-scope.js';
import type { UseCase } from '#shared/application/use-case.js';
import { assertValidWorkDateRange, type WorkDateRange } from '../domain/work-date-range.js';
import { MAX_REPORT_EXPORT_ROWS } from './daily-report.use-cases.js';
import type {
  PortfolioDailyReportReader,
  PortfolioDailyReportView,
} from './ports/portfolio-daily-report.reader.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  portfolioScope: PortfolioScope;
  portfolioDailyReportReader: PortfolioDailyReportReader;
}

export interface PortfolioDailyReportsFilter extends WorkDateRange {
  readonly companyId?: string | undefined;
}

export interface ListPortfolioDailyReportsInput {
  readonly actor: Actor;
  readonly filter: PortfolioDailyReportsFilter;
  readonly page: PageRequest;
}

export class ListPortfolioDailyReportsUseCase implements UseCase<
  ListPortfolioDailyReportsInput,
  Page<PortfolioDailyReportView>
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    filter,
    page,
  }: ListPortfolioDailyReportsInput): Promise<Page<PortfolioDailyReportView>> {
    assertValidWorkDateRange(filter);
    const companies = await companiesInScope(this.deps.portfolioScope, actor, filter.companyId);
    return this.deps.portfolioDailyReportReader.list(
      companies.map((company) => company.id),
      filter,
      page,
    );
  }
}

const EXPORT_PAGE_SIZE = 100;

export interface ExportPortfolioDailyReportsInput {
  readonly actor: Actor;
  readonly filter: PortfolioDailyReportsFilter;
}

export class ExportPortfolioDailyReportsUseCase implements UseCase<
  ExportPortfolioDailyReportsInput,
  PortfolioDailyReportView[]
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    filter,
  }: ExportPortfolioDailyReportsInput): Promise<PortfolioDailyReportView[]> {
    assertValidWorkDateRange(filter);
    const companies = await companiesInScope(this.deps.portfolioScope, actor, filter.companyId);
    const companyIds = companies.map((company) => company.id);

    const reports: PortfolioDailyReportView[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.deps.portfolioDailyReportReader.list(companyIds, filter, {
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
