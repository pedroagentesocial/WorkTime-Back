import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import { AppError } from '#shared/domain/errors.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { remainingSeconds } from '../domain/daily-limit.js';
import { TimeEntry } from '../domain/time-entry.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import { closeIfOverLimit } from './daily-limit-enforcement.js';
import { assertPeriodsOpen } from './period-guard.js';
import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import type { EmployeeDirectory, EmployeeProfile } from './ports/employee-directory.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  periodClosureRepository: PeriodClosureRepository;
  transactions: TransactionRunner;
  employeeDirectory: EmployeeDirectory;
  idGenerator: IdGenerator;
  clock: Clock;
  securityEvents: SecurityEventRecorder;
}

export interface AdminClockInInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
  readonly overrideDailyLimit: boolean;
}

export interface AdminClockOutInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
}

async function employeeOf(
  directory: EmployeeDirectory,
  actor: Actor,
  employeeId: string,
): Promise<EmployeeProfile> {
  const profile = await directory.findByEmployee(companyIdOf(actor), employeeId);
  if (!profile) throw TimekeepingErrors.employeeNotFound();
  return profile;
}

export class AdminClockInUseCase implements UseCase<AdminClockInInput, TimeEntry> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    employeeId,
    overrideDailyLimit,
  }: AdminClockInInput): Promise<TimeEntry> {
    const { timeEntryRepository: entries } = this.deps;
    const profile = await employeeOf(this.deps.employeeDirectory, actor, employeeId);
    if (!profile.active) throw TimekeepingErrors.employeeInactive();

    const now = this.deps.clock.now();
    const limit = profile.dailyLimitMinutes;

    const open = await entries.findOpenByEmployee(profile.employeeId);
    if (open && !(await closeIfOverLimit(entries, open, limit, now))) {
      throw TimekeepingErrors.employeeAlreadyClockedIn();
    }

    if (limit !== null && !overrideDailyLimit) {
      const worked = await entries.closedSecondsOn(
        profile.employeeId,
        localDateOf(now, profile.effectiveTimezone),
      );
      if (remainingSeconds(limit, worked) === 0) {
        throw TimekeepingErrors.employeeDailyLimitReached(limit);
      }
    }

    const entry = TimeEntry.start({
      id: this.deps.idGenerator.generate(),
      companyId: profile.companyId,
      employeeId: profile.employeeId,
      at: now,
      timezone: profile.effectiveTimezone,
      source: 'admin',
      dailyLimitWaived: overrideDailyLimit,
    });
    try {
      await this.deps.transactions.run(async () => {
        await assertPeriodsOpen(this.deps.periodClosureRepository, profile.companyId, [
          entry.workDate,
        ]);
        await entries.lockEmployee(profile.companyId, profile.employeeId);
        await entries.insert(entry);
        // La auditoria va en la misma transaccion: si no se puede registrar, no se marca
        await this.deps.securityEvents.recordOrThrow({
          type: SecurityEventType.TIME_ENTRY_CLOCKED_IN_BY_ADMIN,
          userId: actor.userId,
          companyId: profile.companyId,
          client,
          metadata: { employeeId, timeEntryId: entry.id, overrideDailyLimit },
        });
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'ALREADY_CLOCKED_IN') {
        throw TimekeepingErrors.employeeAlreadyClockedIn();
      }
      throw error;
    }

    return entry;
  }
}

export class AdminClockOutUseCase implements UseCase<AdminClockOutInput, TimeEntry> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, client, employeeId }: AdminClockOutInput): Promise<TimeEntry> {
    const { timeEntryRepository: entries } = this.deps;
    const profile = await employeeOf(this.deps.employeeDirectory, actor, employeeId);

    const open = await entries.findOpenByEmployee(profile.employeeId);
    if (!open) throw TimekeepingErrors.employeeNotClockedIn();

    const now = this.deps.clock.now();
    await this.deps.transactions.run(async () => {
      if (!(await closeIfOverLimit(entries, open, profile.dailyLimitMinutes, now))) {
        open.close(now, 'admin');
        if (!(await entries.closeIfOpen(open.companyId, open.id, now, 'admin', open.clockInAt))) {
          throw TimekeepingErrors.employeeNotClockedIn();
        }
      }
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.TIME_ENTRY_CLOCKED_OUT_BY_ADMIN,
        userId: actor.userId,
        companyId: profile.companyId,
        client,
        metadata: { employeeId, timeEntryId: open.id },
      });
    });
    return open;
  }
}
