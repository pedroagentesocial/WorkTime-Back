import type { Actor } from '#shared/application/actor.js';
import { companiesInScope, type PortfolioScope } from '#shared/application/portfolio-scope.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import { payPeriodOf, type PayPeriod } from '../domain/pay-period.js';
import {
  mergeCompanyTimesheets,
  portfolioPeriodDate,
  sumHours,
  type CompanyRef,
} from '../domain/portfolio-timesheet.js';
import type { CompanyTimesheet } from '../domain/company-timesheet.js';
import { timesheetBodyOf } from './company-timesheet.use-cases.js';
import type {
  AttendanceSummary,
  GetAttendanceSummaryUseCase,
} from './attendance-summary.use-case.js';
import { mapInBatches } from './portfolio-batches.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

interface Deps {
  portfolioScope: PortfolioScope;
  getAttendanceSummary: GetAttendanceSummaryUseCase;
  timeEntryRepository: TimeEntryRepository;
  employeeDirectory: EmployeeDirectory;
  clock: Clock;
}

export interface PortfolioSummaryInput {
  readonly actor: Actor;
  readonly companyId?: string | undefined;
}

export interface PortfolioCompanySummary {
  readonly company: CompanyRef;
  readonly employees: AttendanceSummary['employees'];
  readonly workedTodaySeconds: number;
  readonly atLimitCount: number;
  readonly pendingReports: AttendanceSummary['pendingReports'];
  readonly periodHours: number;
}

export interface PortfolioSummary {
  readonly asOf: Date;
  readonly period: PayPeriod;
  readonly days: { readonly date: string; readonly weekday: string }[];
  readonly companies: PortfolioCompanySummary[];
  readonly totals: {
    readonly companies: number;
    readonly employees: AttendanceSummary['employees'];
    readonly workedTodaySeconds: number;
    readonly atLimitCount: number;
    readonly pendingReports: {
      readonly companiesRequiring: number;
      readonly employees: number;
      readonly days: number;
    };
    readonly periodHours: number;
    readonly dailyHours: number[];
  };
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

// El panel de un admin multiempresa: reune lo que ya calcula cada empresa, sin reglas propias
export class GetPortfolioSummaryUseCase implements UseCase<
  PortfolioSummaryInput,
  PortfolioSummary
> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, companyId }: PortfolioSummaryInput): Promise<PortfolioSummary> {
    const companies = await companiesInScope(this.deps.portfolioScope, actor, companyId);
    const now = this.deps.clock.now();
    const period = payPeriodOf(
      portfolioPeriodDate(
        now,
        companies.map((company) => company.timezone),
      ),
    );

    const perCompany = await mapInBatches(companies, async (company) => {
      // La empresa sale de las membresias; la consulta es la misma que la de su admin
      const scoped: Actor = { ...actor, companyId: company.id };
      const [summary, sheet] = await Promise.all([
        this.deps.getAttendanceSummary.execute(scoped),
        timesheetBodyOf(this.deps, company.id, period),
      ]);
      return { company, summary, sheet };
    });

    const merged = mergeCompanyTimesheets(
      period,
      perCompany.map(({ company, sheet }) => ({
        company: sheetRef(company),
        sheet: sheet satisfies CompanyTimesheet,
      })),
    );

    const rows: PortfolioCompanySummary[] = perCompany.map(({ company, summary, sheet }) => ({
      company: sheetRef(company),
      employees: summary.employees,
      workedTodaySeconds: summary.workedTodaySeconds,
      atLimitCount: summary.atLimit.length,
      pendingReports: summary.pendingReports,
      periodHours: sheet.totals.totalHours,
    }));

    return {
      asOf: now,
      period,
      days: merged.days,
      companies: rows,
      totals: {
        companies: rows.length,
        employees: {
          active: sum(rows.map((row) => row.employees.active)),
          in: sum(rows.map((row) => row.employees.in)),
          out: sum(rows.map((row) => row.employees.out)),
        },
        workedTodaySeconds: sum(rows.map((row) => row.workedTodaySeconds)),
        atLimitCount: sum(rows.map((row) => row.atLimitCount)),
        pendingReports: {
          companiesRequiring: rows.filter((row) => row.pendingReports.required).length,
          employees: sum(rows.map((row) => row.pendingReports.employees)),
          days: sum(rows.map((row) => row.pendingReports.days)),
        },
        periodHours: sumHours(rows.map((row) => row.periodHours)),
        dailyHours: merged.totals.hours,
      },
    };
  }
}

function sheetRef(company: CompanyRef): CompanyRef {
  return { id: company.id, name: company.name, code: company.code };
}
