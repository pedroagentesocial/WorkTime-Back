import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { PageRequest } from '#shared/application/pagination.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import { pendingDaysByEmployee, pendingDaysOf } from './pending-reports.js';
import type { DailyReportRepository } from './ports/daily-report.repository.js';
import type { EmployeeDirectory, RosterEmployee } from './ports/employee-directory.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  dailyReportRepository: DailyReportRepository;
  employeeDirectory: EmployeeDirectory;
  clock: Clock;
}

export interface MyPendingReports {
  readonly required: boolean;
  readonly days: string[];
}

export class ListMyPendingReportsUseCase implements UseCase<Actor, MyPendingReports> {
  constructor(private readonly deps: Deps) {}

  async execute(actor: Actor): Promise<MyPendingReports> {
    const profile = await this.deps.employeeDirectory.findByUser(companyIdOf(actor), actor.userId);
    if (!profile) throw TimekeepingErrors.employeeProfileNotFound();
    return {
      required: profile.requireDailyReport,
      days: await pendingDaysOf(this.deps, profile, this.deps.clock.now()),
    };
  }
}

export interface CompanyPendingReportsInput {
  readonly actor: Actor;
  readonly employeeId?: string | undefined;
  readonly page: PageRequest;
}

export interface EmployeePendingReports {
  readonly employee: RosterEmployee;
  readonly days: string[];
}

export interface CompanyPendingReports {
  readonly required: boolean;
  readonly items: EmployeePendingReports[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export class ListCompanyPendingReportsUseCase implements UseCase<
  CompanyPendingReportsInput,
  CompanyPendingReports
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    employeeId,
    page,
  }: CompanyPendingReportsInput): Promise<CompanyPendingReports> {
    const companyId = companyIdOf(actor);
    const { employeeDirectory: directory } = this.deps;
    if (employeeId && !(await directory.exists(companyId, employeeId))) {
      throw TimekeepingErrors.employeeNotFound();
    }

    const policy = await directory.reportPolicy(companyId);
    if (!policy?.required) return { required: false, items: [], ...page, total: 0 };

    const employees = (await directory.listActive(companyId)).filter(
      (employee) => !employeeId || employee.employeeId === employeeId,
    );
    const pending = await pendingDaysByEmployee(
      this.deps,
      companyId,
      employees,
      policy.since,
      this.deps.clock.now(),
    );

    const all = employees.flatMap((employee) => {
      const days = pending.get(employee.employeeId);
      return days ? [{ employee, days }] : [];
    });
    const start = (page.page - 1) * page.limit;
    return {
      required: true,
      items: all.slice(start, start + page.limit),
      page: page.page,
      limit: page.limit,
      total: all.length,
    };
  }
}
