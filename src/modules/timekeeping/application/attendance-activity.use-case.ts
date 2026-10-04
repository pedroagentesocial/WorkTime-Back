import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { UseCase } from '#shared/application/use-case.js';
import { ValidationError } from '#shared/domain/errors.js';
import type {
  AttendanceActivityFilter,
  AttendanceActivityReader,
  AttendanceActivityView,
} from './ports/attendance-activity.reader.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  attendanceActivityReader: AttendanceActivityReader;
  employeeDirectory: EmployeeDirectory;
}

export interface ListAttendanceActivityInput {
  readonly actor: Actor;
  readonly filter: AttendanceActivityFilter;
  readonly page: PageRequest;
}

export class ListAttendanceActivityUseCase implements UseCase<
  ListAttendanceActivityInput,
  Page<AttendanceActivityView>
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    filter,
    page,
  }: ListAttendanceActivityInput): Promise<Page<AttendanceActivityView>> {
    const companyId = companyIdOf(actor);
    if (filter.from && filter.to && filter.from > filter.to) {
      throw new ValidationError('INVALID_DATE_RANGE', '"from" no puede ser posterior a "to"');
    }
    if (
      filter.employeeId &&
      !(await this.deps.employeeDirectory.exists(companyId, filter.employeeId))
    ) {
      throw TimekeepingErrors.employeeNotFound();
    }
    return this.deps.attendanceActivityReader.list(companyId, filter, page);
  }
}
