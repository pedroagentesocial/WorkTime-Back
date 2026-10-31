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
  totalsByCurrency,
  type CurrencyTotal,
  type PortfolioTimesheet,
} from '../domain/portfolio-timesheet.js';
import {
  pageOf,
  paidTimesheetOf,
  type CompanyTimesheetPayRow,
} from './company-timesheet.use-cases.js';
import { mapInBatches } from './portfolio-batches.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import type { PayRateReader } from './ports/pay-rate.reader.js';
import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

export interface Deps {
  portfolioScope: PortfolioScope;
  timeEntryRepository: TimeEntryRepository;
  employeeDirectory: EmployeeDirectory;
  payRateReader: PayRateReader;
  periodClosureRepository: PeriodClosureRepository;
  clock: Clock;
}

export interface PortfolioTimesheetInput {
  readonly actor: Actor;
  readonly date?: string | undefined;
  readonly search?: string | undefined;
  readonly companyId?: string | undefined;
}

export interface PortfolioTimesheetPayRow extends CompanyTimesheetPayRow {
  // Moneda del pago de la fila: la de su empresa; null si no hay pago que mostrar
  readonly currency: string | null;
}

export interface PortfolioTimesheetResult extends PortfolioTimesheet<PortfolioTimesheetPayRow> {
  // Un total por moneda; null si no se pidio el pago
  readonly payTotals: CurrencyTotal[] | null;
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

export async function portfolioTimesheetOf(
  deps: Deps,
  { actor, date, search, companyId }: PortfolioTimesheetInput,
  withPay: boolean,
): Promise<PortfolioTimesheetResult> {
  const companies = await companiesInScope(deps.portfolioScope, actor, companyId);
  const period = payPeriodOf(
    date ??
      portfolioPeriodDate(
        deps.clock.now(),
        companies.map((company) => company.timezone),
      ),
  );

  const sheets = await mapInBatches(companies, async (company) => {
    const closure = withPay
      ? await deps.periodClosureRepository.find(company.id, period.start)
      : null;
    const sheet = await paidTimesheetOf(deps, withPay, company.id, period, search, closure);
    const currency = sheet.pay?.currency ?? null;
    return {
      company: { id: company.id, name: company.name, code: company.code },
      sheet: { ...sheet, rows: sheet.rows.map((row) => ({ ...row, currency })) },
    };
  });

  return {
    ...mergeCompanyTimesheets(period, sheets),
    payTotals: withPay ? totalsByCurrency(sheets.map(({ sheet }) => sheet.pay)) : null,
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
    return pageOf(await portfolioTimesheetOf(this.deps, input, false), input.page);
  }
}

export class ExportPortfolioTimesheetUseCase implements UseCase<
  PortfolioTimesheetInput,
  PortfolioTimesheetResult
> {
  constructor(private readonly deps: Deps) {}

  execute(input: PortfolioTimesheetInput): Promise<PortfolioTimesheetResult> {
    return portfolioTimesheetOf(this.deps, input, false);
  }
}
