import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { PageRequest } from '#shared/application/pagination.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { buildCompanyTimesheet, type CompanyTimesheet } from '../domain/company-timesheet.js';
import {
  nextPayPeriodStart,
  payPeriodOf,
  previousPayPeriodStart,
  type PayPeriod,
} from '../domain/pay-period.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import type {
  PeriodClosureRepository,
  PeriodClosureView,
} from './ports/period-closure.repository.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  periodClosureRepository: PeriodClosureRepository;
  employeeDirectory: EmployeeDirectory;
  clock: Clock;
}

export interface CompanyTimesheetInput {
  readonly actor: Actor;
  readonly date?: string | undefined;
  readonly search?: string | undefined;
}

export interface CompanyTimesheetResult extends CompanyTimesheet {
  readonly period: PayPeriod;
  readonly previousPeriodStart: string;
  readonly nextPeriodStart: string;
  readonly closure: PeriodClosureView | null;
}

export interface CompanyTimesheetPageInput extends CompanyTimesheetInput {
  readonly page: PageRequest;
}

export interface CompanyTimesheetPage extends CompanyTimesheetResult {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

type TimesheetBodyDeps = Pick<Deps, 'timeEntryRepository' | 'employeeDirectory'>;

// Filas y totales de una empresa en un periodo; lo comparten la hoja de la empresa y las vistas consolidadas
export async function timesheetBodyOf(
  deps: TimesheetBodyDeps,
  companyId: string,
  period: PayPeriod,
  search?: string,
): Promise<CompanyTimesheet> {
  const range = { from: period.start, to: period.end };
  const [employees, totals] = await Promise.all([
    deps.employeeDirectory.listForTimesheet(companyId, range, search),
    deps.timeEntryRepository.periodTotals(companyId, range),
  ]);
  return buildCompanyTimesheet(period, employees, totals);
}

async function timesheetOf(
  deps: Deps,
  { actor, date, search }: CompanyTimesheetInput,
): Promise<CompanyTimesheetResult> {
  const companyId = companyIdOf(actor);
  const timezone = (await deps.employeeDirectory.companyTimezone(companyId)) ?? 'UTC';
  const period = payPeriodOf(date ?? localDateOf(deps.clock.now(), timezone));

  const [body, closure] = await Promise.all([
    timesheetBodyOf(deps, companyId, period, search),
    deps.periodClosureRepository.find(companyId, period.start),
  ]);

  return {
    ...body,
    period,
    previousPeriodStart: previousPayPeriodStart(period),
    nextPeriodStart: nextPayPeriodStart(period),
    closure,
  };
}

export class GetCompanyTimesheetUseCase implements UseCase<
  CompanyTimesheetPageInput,
  CompanyTimesheetPage
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CompanyTimesheetPageInput): Promise<CompanyTimesheetPage> {
    const sheet = await timesheetOf(this.deps, input);
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

export class ExportCompanyTimesheetUseCase implements UseCase<
  CompanyTimesheetInput,
  CompanyTimesheetResult
> {
  constructor(private readonly deps: Deps) {}

  execute(input: CompanyTimesheetInput): Promise<CompanyTimesheetResult> {
    return timesheetOf(this.deps, input);
  }
}
