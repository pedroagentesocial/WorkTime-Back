import type { Actor } from '#shared/application/actor.js';
import type { PageRequest } from '#shared/application/pagination.js';
import { companiesInScope, type PortfolioScope } from '#shared/application/portfolio-scope.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import {
  nextPayPeriodStart,
  payPeriodOf,
  previousPayPeriodStart,
  type PayPeriod,
} from '../domain/pay-period.js';
import {
  mergeCompanyTimesheets,
  portfolioPeriodDate,
  type PortfolioTimesheet,
} from '../domain/portfolio-timesheet.js';
import { timesheetBodyOf } from './company-timesheet.use-cases.js';
import { mapInBatches } from './portfolio-batches.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

interface Deps {
  portfolioScope: PortfolioScope;
  timeEntryRepository: TimeEntryRepository;
  employeeDirectory: EmployeeDirectory;
  clock: Clock;
}

export interface PortfolioTimesheetInput {
  readonly actor: Actor;
  readonly date?: string | undefined;
  readonly search?: string | undefined;
  readonly companyId?: string | undefined;
}

export interface PortfolioTimesheetResult extends PortfolioTimesheet {
  readonly period: PayPeriod;
  readonly previousPeriodStart: string;
  readonly nextPeriodStart: string;
}

export interface PortfolioTimesheetPageInput extends PortfolioTimesheetInput {
  readonly page: PageRequest;
}

export interface PortfolioTimesheetPage extends PortfolioTimesheetResult {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

async function portfolioTimesheetOf(
  deps: Deps,
  { actor, date, search, companyId }: PortfolioTimesheetInput,
): Promise<PortfolioTimesheetResult> {
  const companies = await companiesInScope(deps.portfolioScope, actor, companyId);
  const period = payPeriodOf(
    date ??
      portfolioPeriodDate(
        deps.clock.now(),
        companies.map((company) => company.timezone),
      ),
  );

  const sheets = await mapInBatches(companies, async (company) => ({
    company: { id: company.id, name: company.name, code: company.code },
    sheet: await timesheetBodyOf(deps, company.id, period, search),
  }));

  return {
    ...mergeCompanyTimesheets(period, sheets),
    period,
    previousPeriodStart: previousPayPeriodStart(period),
    nextPeriodStart: nextPayPeriodStart(period),
  };
}

// Horas de todos los empleados de todas las empresas de la persona, con la empresa de cada uno
export class GetPortfolioTimesheetUseCase implements UseCase<
  PortfolioTimesheetPageInput,
  PortfolioTimesheetPage
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: PortfolioTimesheetPageInput): Promise<PortfolioTimesheetPage> {
    const sheet = await portfolioTimesheetOf(this.deps, input);
    const { page, limit } = input.page;
    return {
      ...sheet,
      rows: sheet.rows.slice((page - 1) * limit, page * limit),
      page,
      limit,
      total: sheet.rows.length,
    };
  }
}

export class ExportPortfolioTimesheetUseCase implements UseCase<
  PortfolioTimesheetInput,
  PortfolioTimesheetResult
> {
  constructor(private readonly deps: Deps) {}

  execute(input: PortfolioTimesheetInput): Promise<PortfolioTimesheetResult> {
    return portfolioTimesheetOf(this.deps, input);
  }
}
