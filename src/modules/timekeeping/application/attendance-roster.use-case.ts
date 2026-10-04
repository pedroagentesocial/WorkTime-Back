import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { PageRequest } from '#shared/application/pagination.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { durationSeconds } from '../domain/work-hours.js';
import { dailyLimitStatusOf, type DailyLimitStatus } from './daily-limit-enforcement.js';
import type {
  EmployeeDirectory,
  RosterEmployee,
  RosterFilter,
} from './ports/employee-directory.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  employeeDirectory: EmployeeDirectory;
  clock: Clock;
}

export interface RosterInput {
  readonly actor: Actor;
  readonly filter: RosterFilter;
  readonly page: PageRequest;
}

export interface RosterRow {
  readonly employee: RosterEmployee;
  readonly clockedIn: boolean;
  readonly elapsedSeconds: number | null;
  readonly workedTodaySeconds: number;
  readonly dailyLimit: DailyLimitStatus | null;
}

export interface Roster {
  readonly asOf: Date;
  readonly items: readonly RosterRow[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export class GetAttendanceRosterUseCase implements UseCase<RosterInput, Roster> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, filter, page }: RosterInput): Promise<Roster> {
    const now = this.deps.clock.now();
    const result = await this.deps.employeeDirectory.listRoster(companyIdOf(actor), filter, page);

    const dayOf = (employee: RosterEmployee) =>
      employee.openEntry?.workDate ?? localDateOf(now, employee.effectiveTimezone);
    const closed = await this.deps.timeEntryRepository.closedSecondsByEmployeeAndDay(
      result.items.map((employee) => employee.employeeId),
      [...new Set(result.items.map(dayOf))],
    );

    const items = result.items.map((employee) => {
      const elapsed = employee.openEntry
        ? durationSeconds(employee.openEntry.clockInAt, now)
        : null;
      const worked =
        (closed.get(`${employee.employeeId}|${dayOf(employee)}`) ?? 0) + (elapsed ?? 0);
      return {
        employee,
        clockedIn: employee.openEntry !== null,
        elapsedSeconds: elapsed,
        workedTodaySeconds: worked,
        dailyLimit: dailyLimitStatusOf(employee.dailyLimitMinutes, worked),
      };
    });
    return { asOf: now, items, page: result.page, limit: result.limit, total: result.total };
  }
}
