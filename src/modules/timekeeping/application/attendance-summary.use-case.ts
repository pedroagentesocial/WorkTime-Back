import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { durationSeconds } from '../domain/work-hours.js';
import { dailyLimitStatusOf } from './daily-limit-enforcement.js';
import { pendingDaysByEmployee } from './pending-reports.js';
import type { DailyReportRepository } from './ports/daily-report.repository.js';
import type { EmployeeDirectory, RosterEmployee } from './ports/employee-directory.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  dailyReportRepository: DailyReportRepository;
  employeeDirectory: EmployeeDirectory;
  clock: Clock;
}

export interface AttendanceSummary {
  readonly asOf: Date;
  readonly employees: { readonly active: number; readonly in: number; readonly out: number };
  readonly workedTodaySeconds: number;
  readonly atLimit: {
    readonly employee: RosterEmployee;
    readonly limitMinutes: number;
    readonly workedSeconds: number;
  }[];
  readonly pendingReports: {
    readonly required: boolean;
    readonly employees: number;
    readonly days: number;
  };
}

export class GetAttendanceSummaryUseCase implements UseCase<Actor, AttendanceSummary> {
  constructor(private readonly deps: Deps) {}

  async execute(actor: Actor): Promise<AttendanceSummary> {
    const companyId = companyIdOf(actor);
    const now = this.deps.clock.now();
    const employees = await this.deps.employeeDirectory.listActive(companyId);

    const dayOf = (employee: RosterEmployee) =>
      employee.openEntry?.workDate ?? localDateOf(now, employee.effectiveTimezone);
    const closed = await this.deps.timeEntryRepository.closedSecondsByEmployeeAndDay(
      employees.map((employee) => employee.employeeId),
      [...new Set(employees.map(dayOf))],
    );

    let workedTodaySeconds = 0;
    let inCount = 0;
    const atLimit: AttendanceSummary['atLimit'] = [];
    for (const employee of employees) {
      const running = employee.openEntry ? durationSeconds(employee.openEntry.clockInAt, now) : 0;
      const worked = (closed.get(`${employee.employeeId}|${dayOf(employee)}`) ?? 0) + running;
      workedTodaySeconds += worked;
      if (employee.openEntry) inCount += 1;
      const waived = employee.openEntry?.dailyLimitWaived ?? false;
      if (!waived && dailyLimitStatusOf(employee.dailyLimitMinutes, worked)?.reached) {
        atLimit.push({
          employee,
          limitMinutes: employee.dailyLimitMinutes ?? 0,
          workedSeconds: worked,
        });
      }
    }

    const policy = await this.deps.employeeDirectory.reportPolicy(companyId);
    let pendingEmployees = 0;
    let pendingDays = 0;
    if (policy?.required) {
      const pending = await pendingDaysByEmployee(
        this.deps,
        companyId,
        employees,
        policy.since,
        now,
      );
      pendingEmployees = pending.size;
      for (const days of pending.values()) pendingDays += days.length;
    }

    return {
      asOf: now,
      employees: { active: employees.length, in: inCount, out: employees.length - inCount },
      workedTodaySeconds,
      atLimit,
      pendingReports: {
        required: policy?.required ?? false,
        employees: pendingEmployees,
        days: pendingDays,
      },
    };
  }
}
