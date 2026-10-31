import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { PageRequest } from '#shared/application/pagination.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import {
  buildCompanyTimesheet,
  type CompanyTimesheet,
  type CompanyTimesheetRow,
  type EmployeeDayTotal,
  type TimesheetEmployee,
} from '../domain/company-timesheet.js';
import { periodPay, type EmployeePay, type PeriodPay } from '../domain/pay.js';
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
import type { PayRateReader } from './ports/pay-rate.reader.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

export interface Deps {
  timeEntryRepository: TimeEntryRepository;
  periodClosureRepository: PeriodClosureRepository;
  employeeDirectory: EmployeeDirectory;
  payRateReader: PayRateReader;
  clock: Clock;
}

export interface CompanyTimesheetInput {
  readonly actor: Actor;
  readonly date?: string | undefined;
  readonly search?: string | undefined;
}

export interface CompanyTimesheetPayRow extends CompanyTimesheetRow {
  // null si quien consulta no puede ver sueldos
  readonly pay: EmployeePay | null;
}

export interface PayTotal {
  readonly currency: string;
  readonly totalCents: number;
}

export interface PaidTimesheet extends Omit<CompanyTimesheet, 'rows'> {
  readonly rows: CompanyTimesheetPayRow[];
  // null si quien consulta no puede ver sueldos o el periodo se cerro antes de que existieran
  readonly pay: PayTotal | null;
}

export interface CompanyTimesheetResult extends PaidTimesheet {
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
  const { employees, totals } = await timesheetDataOf(deps, companyId, period, search);
  return buildCompanyTimesheet(period, employees, totals);
}

export async function timesheetDataOf(
  deps: TimesheetBodyDeps,
  companyId: string,
  period: PayPeriod,
  search?: string,
): Promise<{ employees: TimesheetEmployee[]; totals: EmployeeDayTotal[] }> {
  const range = { from: period.start, to: period.end };
  const [employees, totals] = await Promise.all([
    deps.employeeDirectory.listForTimesheet(companyId, range, search),
    deps.timeEntryRepository.periodTotals(companyId, range),
  ]);
  return { employees, totals };
}

type PaidTimesheetDeps = TimesheetBodyDeps &
  Pick<Deps, 'payRateReader' | 'periodClosureRepository'>;

// Un periodo cerrado muestra lo que se congelo al cerrar, no un calculo nuevo
async function sheetPayOf(
  deps: PaidTimesheetDeps,
  companyId: string,
  period: PayPeriod,
  data: { employees: TimesheetEmployee[]; totals: EmployeeDayTotal[] },
  closure: PeriodClosureView | null,
): Promise<PeriodPay | null> {
  const setup = await deps.payRateReader.setupOf(companyId, period.end);
  if (!setup) return null;
  const live = periodPay(setup, period, data.employees, data.totals);
  if (!closure) return live;
  if (!closure.currency) return null;

  const frozen = await deps.periodClosureRepository.findPays(companyId, closure.id);
  const byEmployee = new Map<string, EmployeePay>();
  let totalCents = 0;
  for (const [employeeId, pay] of live.byEmployee) {
    const amountCents = frozen.get(employeeId) ?? null;
    byEmployee.set(employeeId, { ...pay, amountCents });
    totalCents += amountCents ?? 0;
  }
  return { currency: closure.currency, totalCents, byEmployee };
}

// Hoja de una empresa; con withPay suma el pago de cada empleado, que solo muestra la nomina
export async function paidTimesheetOf(
  deps: PaidTimesheetDeps,
  withPay: boolean,
  companyId: string,
  period: PayPeriod,
  search: string | undefined,
  closure: PeriodClosureView | null,
): Promise<PaidTimesheet> {
  const data = await timesheetDataOf(deps, companyId, period, search);
  const body = buildCompanyTimesheet(period, data.employees, data.totals);
  const pay = withPay ? await sheetPayOf(deps, companyId, period, data, closure) : null;
  return {
    ...body,
    rows: body.rows.map((row) => ({ ...row, pay: pay?.byEmployee.get(row.employee.id) ?? null })),
    pay: pay && { currency: pay.currency, totalCents: pay.totalCents },
  };
}

export async function timesheetOf(
  deps: Deps,
  { actor, date, search }: CompanyTimesheetInput,
  withPay: boolean,
): Promise<CompanyTimesheetResult> {
  const companyId = companyIdOf(actor);
  const timezone = (await deps.employeeDirectory.companyTimezone(companyId)) ?? 'UTC';
  const period = payPeriodOf(date ?? localDateOf(deps.clock.now(), timezone));
  const closure = await deps.periodClosureRepository.find(companyId, period.start);

  return {
    ...(await paidTimesheetOf(deps, withPay, companyId, period, search, closure)),
    period,
    previousPeriodStart: previousPayPeriodStart(period),
    nextPeriodStart: nextPayPeriodStart(period),
    closure,
  };
}

export function pageOf<S extends { readonly rows: readonly unknown[] }>(
  sheet: S,
  { page, limit }: PageRequest,
): S & { readonly page: number; readonly limit: number; readonly total: number } {
  return {
    ...sheet,
    rows: sheet.rows.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: sheet.rows.length,
  };
}

export class GetCompanyTimesheetUseCase implements UseCase<
  CompanyTimesheetPageInput,
  CompanyTimesheetPage
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CompanyTimesheetPageInput): Promise<CompanyTimesheetPage> {
    return pageOf(await timesheetOf(this.deps, input, false), input.page);
  }
}

export class ExportCompanyTimesheetUseCase implements UseCase<
  CompanyTimesheetInput,
  CompanyTimesheetResult
> {
  constructor(private readonly deps: Deps) {}

  execute(input: CompanyTimesheetInput): Promise<CompanyTimesheetResult> {
    return timesheetOf(this.deps, input, false);
  }
}
