import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { PageRequest } from '#shared/application/pagination.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import { assertValidWorkDateRange } from '../domain/work-date-range.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import type {
  CorrectionView,
  TimeEntryFilter,
  TimeEntryPage,
  TimeEntryRepository,
  TimeEntryView,
} from './ports/time-entry.repository.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  employeeDirectory: EmployeeDirectory;
}

export interface ListTimeEntriesInput {
  readonly actor: Actor;
  readonly filter: TimeEntryFilter;
  readonly page: PageRequest;
}

export class ListMyTimeEntriesUseCase implements UseCase<ListTimeEntriesInput, TimeEntryPage> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, filter, page }: ListTimeEntriesInput): Promise<TimeEntryPage> {
    assertValidWorkDateRange(filter);
    const companyId = companyIdOf(actor);
    const profile = await this.deps.employeeDirectory.findByUser(companyId, actor.userId);
    if (!profile) throw TimekeepingErrors.employeeProfileNotFound();

    return this.deps.timeEntryRepository.list(
      companyId,
      { ...filter, employeeId: profile.employeeId },
      page,
    );
  }
}

export class ListCompanyTimeEntriesUseCase implements UseCase<ListTimeEntriesInput, TimeEntryPage> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, filter, page }: ListTimeEntriesInput): Promise<TimeEntryPage> {
    assertValidWorkDateRange(filter);
    const companyId = companyIdOf(actor);
    if (
      filter.employeeId &&
      !(await this.deps.employeeDirectory.exists(companyId, filter.employeeId))
    ) {
      throw TimekeepingErrors.employeeNotFound();
    }
    return this.deps.timeEntryRepository.list(companyId, filter, page);
  }
}

export interface TimeEntryByIdInput {
  readonly actor: Actor;
  readonly timeEntryId: string;
}

export class GetTimeEntryUseCase implements UseCase<TimeEntryByIdInput, TimeEntryView> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, timeEntryId }: TimeEntryByIdInput): Promise<TimeEntryView> {
    const entry = await this.deps.timeEntryRepository.findViewById(companyIdOf(actor), timeEntryId);
    if (!entry) throw TimekeepingErrors.timeEntryNotFound();
    return entry;
  }
}

export class ListTimeEntryCorrectionsUseCase implements UseCase<
  TimeEntryByIdInput,
  CorrectionView[]
> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, timeEntryId }: TimeEntryByIdInput): Promise<CorrectionView[]> {
    const companyId = companyIdOf(actor);
    if (!(await this.deps.timeEntryRepository.findViewById(companyId, timeEntryId))) {
      throw TimekeepingErrors.timeEntryNotFound();
    }
    return this.deps.timeEntryRepository.listCorrections(companyId, timeEntryId);
  }
}

export interface LiveAttendance {
  readonly asOf: Date;
  readonly entries: TimeEntryView[];
}

export class GetLiveAttendanceUseCase implements UseCase<Actor, LiveAttendance> {
  constructor(private readonly deps: Pick<Deps, 'timeEntryRepository'> & { clock: Clock }) {}

  async execute(actor: Actor): Promise<LiveAttendance> {
    const entries = await this.deps.timeEntryRepository.listOpen(companyIdOf(actor));
    return { asOf: this.deps.clock.now(), entries };
  }
}
