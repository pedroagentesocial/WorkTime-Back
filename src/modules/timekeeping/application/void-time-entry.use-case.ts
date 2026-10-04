import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { normalizeReason } from './correct-time-entry.use-case.js';
import { assertPeriodsOpen } from './period-guard.js';
import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import type { TimeEntryRepository, TimeEntryView } from './ports/time-entry.repository.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  periodClosureRepository: PeriodClosureRepository;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
  clock: Clock;
}

export interface VoidTimeEntryInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly timeEntryId: string;
  readonly reason: string;
}

export class VoidTimeEntryUseCase implements UseCase<VoidTimeEntryInput, TimeEntryView> {
  constructor(private readonly deps: Deps) {}

  async execute(input: VoidTimeEntryInput): Promise<TimeEntryView> {
    const { timeEntryRepository: entries } = this.deps;
    const companyId = companyIdOf(input.actor);
    const reason = normalizeReason(input.reason);

    const current = await entries.findViewById(companyId, input.timeEntryId);
    if (!current) throw TimekeepingErrors.timeEntryNotFound();
    if (current.voided) throw TimekeepingErrors.timeEntryVoided();

    await this.deps.transactions.run(async () => {
      await entries.lockEmployee(companyId, current.employee.id);
      // Se relee con el bloqueo tomado: otro admin pudo mover el registro a otro dia o periodo
      const entry = await entries.findById(companyId, current.id);
      if (!entry) throw TimekeepingErrors.timeEntryVoided();
      await assertPeriodsOpen(this.deps.periodClosureRepository, companyId, [entry.workDate]);
      const done = await entries.voidIfActive(companyId, current.id, {
        at: this.deps.clock.now(),
        byId: input.actor.userId,
        reason,
      });
      if (!done) throw TimekeepingErrors.timeEntryVoided();
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.TIME_ENTRY_VOIDED_BY_ADMIN,
        userId: input.actor.userId,
        companyId,
        client: input.client,
        metadata: {
          employeeId: current.employee.id,
          timeEntryId: current.id,
          clockInAt: entry.clockInAt.toISOString(),
          clockOutAt: entry.clockOutAt?.toISOString() ?? null,
          reason,
        },
      });
    });

    const view = await entries.findViewById(companyId, current.id);
    if (!view) throw TimekeepingErrors.timeEntryNotFound();
    return view;
  }
}
