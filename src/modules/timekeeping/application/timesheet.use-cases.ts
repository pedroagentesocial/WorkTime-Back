import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import {
  nextPayPeriodStart,
  payPeriodOf,
  previousPayPeriodStart,
  type PayPeriod,
} from '../domain/pay-period.js';
import { buildTimesheet, type Timesheet } from '../domain/timesheet.js';
import type { EmployeeDirectory, EmployeeProfile } from './ports/employee-directory.js';
import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  periodClosureRepository: PeriodClosureRepository;
  employeeDirectory: EmployeeDirectory;
  clock: Clock;
}

export interface TimesheetResult extends Timesheet {
  readonly period: PayPeriod;
  readonly previousPeriodStart: string;
  readonly nextPeriodStart: string;
  readonly timezone: string;
  readonly requiresDailyReport: boolean;
  readonly closed: boolean;
}

export interface TimesheetInput {
  readonly actor: Actor;
  readonly date?: string | undefined;
}

export interface EmployeeTimesheetInput extends TimesheetInput {
  readonly employeeId: string;
}

async function timesheetOf(
  deps: Deps,
  profile: EmployeeProfile,
  date: string | undefined,
): Promise<TimesheetResult> {
  const day = date ?? localDateOf(deps.clock.now(), profile.effectiveTimezone);
  const period = payPeriodOf(day);
  const [totals, closure] = await Promise.all([
    deps.timeEntryRepository.dailyTotals(profile.companyId, profile.employeeId, {
      from: period.start,
      to: period.end,
    }),
    deps.periodClosureRepository.find(profile.companyId, period.start),
  ]);
  return {
    ...buildTimesheet(period, totals),
    period,
    previousPeriodStart: previousPayPeriodStart(period),
    nextPeriodStart: nextPayPeriodStart(period),
    timezone: profile.effectiveTimezone,
    requiresDailyReport: profile.requireDailyReport,
    closed: closure !== null,
  };
}

export class GetMyTimesheetUseCase implements UseCase<TimesheetInput, TimesheetResult> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, date }: TimesheetInput): Promise<TimesheetResult> {
    const profile = await this.deps.employeeDirectory.findByUser(companyIdOf(actor), actor.userId);
    if (!profile) throw TimekeepingErrors.employeeProfileNotFound();
    return timesheetOf(this.deps, profile, date);
  }
}

export class GetEmployeeTimesheetUseCase implements UseCase<
  EmployeeTimesheetInput,
  TimesheetResult
> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, employeeId, date }: EmployeeTimesheetInput): Promise<TimesheetResult> {
    const profile = await this.deps.employeeDirectory.findByEmployee(
      companyIdOf(actor),
      employeeId,
    );
    if (!profile) throw TimekeepingErrors.employeeNotFound();
    return timesheetOf(this.deps, profile, date);
  }
}
