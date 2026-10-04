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

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  periodClosureRepository: PeriodClosureRepository;
  transactions: TransactionRunner;
  idGenerator: IdGenerator;
  clock: Clock;
  securityEvents: SecurityEventRecorder;
}

export class CorrectTimeEntryUseCase implements UseCase<CorrectTimeEntryInput, TimeEntryView> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CorrectTimeEntryInput): Promise<TimeEntryView> {
    const { timeEntryRepository: entries } = this.deps;
    const companyId = companyIdOf(input.actor);
    const reason = normalizeReason(input.reason);

    await this.deps.transactions.run(async () => {
      const entry = await entries.findById(companyId, input.timeEntryId);
      if (!entry) {
        const view = await entries.findViewById(companyId, input.timeEntryId);
        throw view?.voided
          ? TimekeepingErrors.timeEntryVoided()
          : TimekeepingErrors.timeEntryNotFound();
      }
      await entries.lockEmployee(companyId, entry.employeeId);

      const previousWorkDate = entry.workDate;
      const previous = entry.correct(
        { clockInAt: input.clockInAt, clockOutAt: input.clockOutAt },
        this.deps.clock.now(),
      );
      // Ni el dia de origen ni el de destino pueden estar en un periodo cerrado
      await assertPeriodsOpen(this.deps.periodClosureRepository, companyId, [
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
        id: this.deps.idGenerator.generate(),
        companyId,
        timeEntryId: entry.id,
        correctedById: input.actor.userId,
        previousClockInAt: previous.clockInAt,
        previousClockOutAt: previous.clockOutAt,
        newClockInAt: entry.clockInAt,
        newClockOutAt: entry.clockOutAt,
        reason,
      });
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.TIME_ENTRY_CORRECTED_BY_ADMIN,
        userId: input.actor.userId,
        companyId,
        client: input.client,
        metadata: {
          employeeId: entry.employeeId,
          timeEntryId: input.timeEntryId,
          previousClockInAt: previous.clockInAt.toISOString(),
          previousClockOutAt: previous.clockOutAt?.toISOString() ?? null,
          clockInAt: entry.clockInAt.toISOString(),
          clockOutAt: entry.clockOutAt?.toISOString() ?? null,
          reason,
        },
      });
    });

    const view = await entries.findViewById(companyId, input.timeEntryId);
    if (!view) throw TimekeepingErrors.timeEntryNotFound();
    return view;
  }
}
