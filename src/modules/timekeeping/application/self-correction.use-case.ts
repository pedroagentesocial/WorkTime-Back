import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import { SecurityEventType } from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { addDays } from '../domain/pay-period.js';
import { correctTimeEntry, type Deps as CorrectionDeps } from './correct-time-entry.use-case.js';
import type { EmployeeDirectory, EmployeeProfile } from './ports/employee-directory.js';
import type { TimeEntryView } from './ports/time-entry.repository.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps extends CorrectionDeps {
  employeeDirectory: EmployeeDirectory;
}

export interface CorrectOwnTimeEntryInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly timeEntryId: string;
  readonly clockInAt?: Date | undefined;
  readonly clockOutAt?: Date | undefined;
  readonly reason: string;
}

export function selfEditActive(profile: EmployeeProfile, today: string): boolean {
  const { allowed, until } = profile.selfEdit;
  return allowed && (until === null || today <= until);
}

// El empleado con permiso corrige la entrada o salida de un marcaje suyo reciente
export class CorrectOwnTimeEntryUseCase implements UseCase<
  CorrectOwnTimeEntryInput,
  TimeEntryView
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CorrectOwnTimeEntryInput): Promise<TimeEntryView> {
    const profile = await this.deps.employeeDirectory.findByUser(
      companyIdOf(input.actor),
      input.actor.userId,
    );
    if (!profile) throw TimekeepingErrors.employeeProfileNotFound();
    const today = localDateOf(this.deps.clock.now(), profile.effectiveTimezone);
    if (!selfEditActive(profile, today)) throw TimekeepingErrors.selfEditNotAllowed();
    const days = profile.selfEdit.days;
    const earliest = addDays(today, -days);

    return correctTimeEntry(this.deps, {
      ...input,
      companyId: profile.companyId,
      ownerEmployeeId: profile.employeeId,
      eventType: SecurityEventType.TIME_ENTRY_CORRECTED_BY_EMPLOYEE,
      guard: async (entry, previous, previousWorkDate) => {
        // La jornada de hoy se termina marcando la salida, no corrigiendo
        if (previous.clockOutAt === null && previousWorkDate === today) {
          throw TimekeepingErrors.selfEditOpenToday();
        }
        if (previousWorkDate < earliest || entry.workDate < earliest) {
          throw TimekeepingErrors.selfEditOutOfRange(days);
        }
        // El empleado no se autoriza horas extra: el dia corregido no puede pasar su limite
        const limit = profile.dailyLimitMinutes;
        const duration = entry.durationSeconds();
        if (limit === null || entry.dailyLimitWaived || duration === null) return;
        const before = previous.clockOutAt
          ? Math.floor((previous.clockOutAt.getTime() - previous.clockInAt.getTime()) / 1000)
          : 0;
        const closed = await this.deps.timeEntryRepository.closedSecondsOn(
          entry.employeeId,
          entry.workDate,
        );
        const others = previousWorkDate === entry.workDate ? closed - before : closed;
        if (others + duration > limit * 60) throw TimekeepingErrors.selfEditOverLimit();
      },
    });
  }
}
