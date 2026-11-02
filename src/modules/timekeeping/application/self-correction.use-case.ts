import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import { SecurityEventType } from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { addDays } from '../domain/pay-period.js';
import { durationSeconds } from '../domain/work-hours.js';
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

// Tope de un marcaje corregido por el propio empleado, decision del usuario; el admin no tiene tope
export const MAX_SELF_EDIT_SECONDS = 24 * 60 * 60;

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
    const now = this.deps.clock.now();
    const today = localDateOf(now, profile.effectiveTimezone);
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
        // Una entrada abierta se mide hasta ahora: una salida posterior no puede inflarla sin control
        const duration = durationSeconds(entry.clockInAt, entry.clockOutAt ?? now);
        if (duration > MAX_SELF_EDIT_SECONDS) throw TimekeepingErrors.selfEditTooLong();
        // Las horas extra las autoriza el admin: el empleado no puede alargar ese marcaje
        if (entry.dailyLimitWaived) {
          const before = durationSeconds(previous.clockInAt, previous.clockOutAt ?? now);
          if (duration > before) throw TimekeepingErrors.selfEditOverLimit();
          return;
        }
        // El empleado no se autoriza horas extra: el dia corregido no puede pasar su limite
        const limit = profile.dailyLimitMinutes;
        if (limit === null) return;
        const before = previous.clockOutAt
          ? durationSeconds(previous.clockInAt, previous.clockOutAt)
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
