import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { ValidationError } from '#shared/domain/errors.js';
import { assertPeriodsOpen } from './period-guard.js';
import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import type { TimeEntryRepository, TimeEntryView } from './ports/time-entry.repository.js';
import type { TimeEntry, TimeRange } from '../domain/time-entry.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

export const CORRECTION_REASON_LIMITS = { min: 5, max: 500 } as const;

export function normalizeReason(raw: string): string {
  const reason = raw.trim();
  if (
    reason.length < CORRECTION_REASON_LIMITS.min ||
    reason.length > CORRECTION_REASON_LIMITS.max
  ) {
    throw new ValidationError(
      'INVALID_REASON',
      `El motivo debe tener entre ${CORRECTION_REASON_LIMITS.min} y ${CORRECTION_REASON_LIMITS.max} caracteres`,
    );
  }
  return reason;
}

export interface CorrectTimeEntryInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly timeEntryId: string;
  readonly clockInAt?: Date | undefined;
  readonly clockOutAt?: Date | undefined;
  readonly reason: string;
}

export interface Deps {
  timeEntryRepository: TimeEntryRepository;
  periodClosureRepository: PeriodClosureRepository;
  transactions: TransactionRunner;
  idGenerator: IdGenerator;
  clock: Clock;
  securityEvents: SecurityEventRecorder;
}

export type CorrectionEventType =
  | typeof SecurityEventType.TIME_ENTRY_CORRECTED_BY_ADMIN
  | typeof SecurityEventType.TIME_ENTRY_CORRECTED_BY_EMPLOYEE;

export interface CorrectionRequest extends CorrectTimeEntryInput {
  readonly companyId: string;
  readonly eventType: CorrectionEventType;
  // Solo el marcaje de este empleado; otro responde que no existe
  readonly ownerEmployeeId?: string | undefined;
  // Reglas extra de quien corrige, con el marcaje ya cambiado en memoria y como estaba antes
  readonly guard?: (
    entry: TimeEntry,
    previous: TimeRange,
    previousWorkDate: string,
  ) => Promise<void> | void;
}

// La correccion de un marcaje: la comparten el admin y el empleado con permiso
export async function correctTimeEntry(
  deps: Deps,
  request: CorrectionRequest,
): Promise<TimeEntryView> {
  const { timeEntryRepository: entries } = deps;
  const { companyId } = request;
  const reason = normalizeReason(request.reason);

  await deps.transactions.run(async () => {
    const entry = await entries.findById(companyId, request.timeEntryId);
    if (!entry || (request.ownerEmployeeId && entry.employeeId !== request.ownerEmployeeId)) {
      const view = entry ? null : await entries.findViewById(companyId, request.timeEntryId);
      throw view?.voided
        ? TimekeepingErrors.timeEntryVoided()
        : TimekeepingErrors.timeEntryNotFound();
    }
    await entries.lockEmployee(companyId, entry.employeeId);

    const previousWorkDate = entry.workDate;
    const previous = entry.correct(
      { clockInAt: request.clockInAt, clockOutAt: request.clockOutAt },
      deps.clock.now(),
    );
    await request.guard?.(entry, previous, previousWorkDate);
    // Ni el dia de origen ni el de destino pueden estar en un periodo cerrado
    await assertPeriodsOpen(deps.periodClosureRepository, companyId, [
      previousWorkDate,
      entry.workDate,
    ]);
    if (
      await entries.hasOverlap(
        entry.employeeId,
        { from: entry.clockInAt, to: entry.clockOutAt },
        entry.id,
      )
    ) {
      throw TimekeepingErrors.overlap();
    }

    if (!(await entries.update(entry, previous))) {
      throw TimekeepingErrors.changedConcurrently();
    }
    await entries.addCorrection({
      id: deps.idGenerator.generate(),
      companyId,
      timeEntryId: entry.id,
      correctedById: request.actor.userId,
      previousClockInAt: previous.clockInAt,
      previousClockOutAt: previous.clockOutAt,
      newClockInAt: entry.clockInAt,
      newClockOutAt: entry.clockOutAt,
      reason,
    });
    await deps.securityEvents.recordOrThrow({
      type: request.eventType,
      userId: request.actor.userId,
      companyId,
      client: request.client,
      metadata: {
        employeeId: entry.employeeId,
        timeEntryId: request.timeEntryId,
        previousClockInAt: previous.clockInAt.toISOString(),
        previousClockOutAt: previous.clockOutAt?.toISOString() ?? null,
        clockInAt: entry.clockInAt.toISOString(),
        clockOutAt: entry.clockOutAt?.toISOString() ?? null,
        reason,
      },
    });
  });

  const view = await entries.findViewById(companyId, request.timeEntryId);
  if (!view) throw TimekeepingErrors.timeEntryNotFound();
  return view;
}

export class CorrectTimeEntryUseCase implements UseCase<CorrectTimeEntryInput, TimeEntryView> {
  constructor(private readonly deps: Deps) {}

  execute(input: CorrectTimeEntryInput): Promise<TimeEntryView> {
    return correctTimeEntry(this.deps, {
      ...input,
      companyId: companyIdOf(input.actor),
      eventType: SecurityEventType.TIME_ENTRY_CORRECTED_BY_ADMIN,
    });
  }
}
