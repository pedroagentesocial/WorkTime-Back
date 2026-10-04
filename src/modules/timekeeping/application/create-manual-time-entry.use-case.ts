import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { TimeEntry } from '../domain/time-entry.js';
import { assertPeriodsOpen } from './period-guard.js';
import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import { normalizeReason } from './correct-time-entry.use-case.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import type { TimeEntryRepository, TimeEntryView } from './ports/time-entry.repository.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  periodClosureRepository: PeriodClosureRepository;
  employeeDirectory: EmployeeDirectory;
  transactions: TransactionRunner;
  idGenerator: IdGenerator;
  clock: Clock;
  securityEvents: SecurityEventRecorder;
}

export interface CreateManualTimeEntryInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date;
  readonly reason: string;
}

export class CreateManualTimeEntryUseCase implements UseCase<
  CreateManualTimeEntryInput,
  TimeEntryView
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateManualTimeEntryInput): Promise<TimeEntryView> {
    const { timeEntryRepository: entries } = this.deps;
    const companyId = companyIdOf(input.actor);
    const reason = normalizeReason(input.reason);

    const profile = await this.deps.employeeDirectory.findByEmployee(companyId, input.employeeId);
    if (!profile) throw TimekeepingErrors.employeeNotFound();

    const entry = TimeEntry.createManual({
      id: this.deps.idGenerator.generate(),
      companyId,
      employeeId: profile.employeeId,
      clockInAt: input.clockInAt,
      clockOutAt: input.clockOutAt,
      timezone: profile.effectiveTimezone,
      now: this.deps.clock.now(),
      reason,
    });

    await this.deps.transactions.run(async () => {
      await assertPeriodsOpen(this.deps.periodClosureRepository, companyId, [entry.workDate]);
      await entries.lockEmployee(companyId, profile.employeeId);
      const overlaps = await entries.hasOverlap(
        profile.employeeId,
        { from: entry.clockInAt, to: entry.clockOutAt },
        entry.id,
      );
      if (overlaps) throw TimekeepingErrors.overlap();
      await entries.insert(entry);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.TIME_ENTRY_CREATED_BY_ADMIN,
        userId: input.actor.userId,
        companyId,
        client: input.client,
        metadata: {
          employeeId: profile.employeeId,
          timeEntryId: entry.id,
          clockInAt: entry.clockInAt.toISOString(),
          clockOutAt: entry.clockOutAt?.toISOString() ?? null,
          reason,
        },
      });
    });

    const view = await entries.findViewById(companyId, entry.id);
    if (!view) throw TimekeepingErrors.timeEntryNotFound();
    return view;
  }
}
