import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { AppError } from '#shared/domain/errors.js';
import { remainingSeconds } from '../domain/daily-limit.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import { TimeEntry } from '../domain/time-entry.js';
import { durationSeconds } from '../domain/work-hours.js';
import {
  closeIfOverLimit,
  dailyLimitStatusOf,
  type DailyLimitStatus,
} from './daily-limit-enforcement.js';
import { saveDailyReport } from './daily-report-writer.js';
import { pendingDaysOf } from './pending-reports.js';
import { assertPeriodsOpen } from './period-guard.js';
import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import type { DailyReportRepository } from './ports/daily-report.repository.js';
import type { EmployeeDirectory, EmployeeProfile } from './ports/employee-directory.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  employeeDirectory: EmployeeDirectory;
  idGenerator: IdGenerator;
  clock: Clock;
  dailyReportRepository: DailyReportRepository;
  periodClosureRepository: PeriodClosureRepository;
  transactions: TransactionRunner;
}

async function profileOf(directory: EmployeeDirectory, actor: Actor): Promise<EmployeeProfile> {
  const profile = await directory.findByUser(companyIdOf(actor), actor.userId);
  if (!profile) throw TimekeepingErrors.employeeProfileNotFound();
  return profile;
}

export class ClockInUseCase implements UseCase<Actor, TimeEntry> {
  constructor(private readonly deps: Deps) {}

  async execute(actor: Actor): Promise<TimeEntry> {
    const { timeEntryRepository: entries } = this.deps;
    const profile = await profileOf(this.deps.employeeDirectory, actor);
    const now = this.deps.clock.now();
    const limit = profile.dailyLimitMinutes;

    const open = await entries.findOpenByEmployee(profile.employeeId);
    if (open && !(await closeIfOverLimit(entries, open, limit, now))) {
      throw TimekeepingErrors.alreadyClockedIn();
    }

    // Mientras tenga reportes de dias anteriores sin escribir no puede marcar entrada
    const pending = await pendingDaysOf(this.deps, profile, now);
    if (pending.length > 0) throw TimekeepingErrors.pendingReports(pending);

    if (limit !== null) {
      const worked = await entries.closedSecondsOn(
        profile.employeeId,
        localDateOf(now, profile.effectiveTimezone),
      );
      if (remainingSeconds(limit, worked) === 0) throw TimekeepingErrors.dailyLimitReached(limit);
    }

    const entry = TimeEntry.start({
      id: this.deps.idGenerator.generate(),
      companyId: profile.companyId,
      employeeId: profile.employeeId,
      at: now,
      timezone: profile.effectiveTimezone,
      source: 'web',
    });
    await this.deps.transactions.run(async () => {
      await assertPeriodsOpen(this.deps.periodClosureRepository, profile.companyId, [
        entry.workDate,
      ]);
      await entries.lockEmployee(profile.companyId, profile.employeeId);
      await entries.insert(entry);
    });
    return entry;
  }
}

export interface ClockOutInput {
  readonly actor: Actor;
  readonly dailyReport?: string | undefined;
}

export class ClockOutUseCase implements UseCase<ClockOutInput, TimeEntry> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, dailyReport }: ClockOutInput): Promise<TimeEntry> {
    const { timeEntryRepository: entries } = this.deps;
    const profile = await profileOf(this.deps.employeeDirectory, actor);

    const open = await entries.findOpenByEmployee(profile.employeeId);
    if (!open) throw TimekeepingErrors.notClockedIn();

    const now = this.deps.clock.now();
    const report = dailyReport?.trim() || undefined;

    if (await closeIfOverLimit(entries, open, profile.dailyLimitMinutes, now)) {
      if (report) await this.trySaveReport(profile, open.workDate, report, now);
      return open;
    }

    if (profile.requireDailyReport && !report) throw TimekeepingErrors.dailyReportRequired();

    await this.deps.transactions.run(async () => {
      if (report) await saveDailyReport(this.deps, profile, open.workDate, report, now);
      open.close(now);
      if (!(await entries.closeIfOpen(open.companyId, open.id, now, 'employee'))) {
        throw TimekeepingErrors.notClockedIn();
      }
    });
    return open;
  }

  private async trySaveReport(
    profile: EmployeeProfile,
    workDate: string,
    report: string,
    now: Date,
  ): Promise<void> {
    try {
      await this.deps.transactions.run(() =>
        saveDailyReport(this.deps, profile, workDate, report, now),
      );
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
}

export interface ClockStatus {
  readonly clockedIn: boolean;
  readonly openEntry: TimeEntry | null;
  readonly serverTime: Date;
  readonly timezone: string;
  readonly dailyLimit: DailyLimitStatus | null;
  readonly dailyReport: {
    readonly required: boolean;
    readonly workDate: string;
    readonly content: string | null;
  };
  readonly pendingReports: string[];
  readonly canClockIn: boolean;
}

export class GetClockStatusUseCase implements UseCase<Actor, ClockStatus> {
  constructor(private readonly deps: Deps) {}

  async execute(actor: Actor): Promise<ClockStatus> {
    const { timeEntryRepository: entries } = this.deps;
    const profile = await profileOf(this.deps.employeeDirectory, actor);
    const now = this.deps.clock.now();

    let openEntry = await entries.findOpenByEmployee(profile.employeeId);
    if (openEntry && (await closeIfOverLimit(entries, openEntry, profile.dailyLimitMinutes, now))) {
      openEntry = null;
    }

    let dailyLimit: DailyLimitStatus | null = null;
    if (profile.dailyLimitMinutes !== null) {
      const workDate = openEntry?.workDate ?? localDateOf(now, profile.effectiveTimezone);
      const closed = await entries.closedSecondsOn(profile.employeeId, workDate);
      const running = openEntry ? durationSeconds(openEntry.clockInAt, now) : 0;
      dailyLimit = dailyLimitStatusOf(profile.dailyLimitMinutes, closed + running);
    }

    const reportDate = openEntry?.workDate ?? localDateOf(now, profile.effectiveTimezone);
    const report = await this.deps.dailyReportRepository.find(profile.employeeId, reportDate);

    const pendingReports = await pendingDaysOf(this.deps, profile, now);

    return {
      clockedIn: openEntry !== null,
      openEntry,
      serverTime: now,
      timezone: profile.effectiveTimezone,
      dailyLimit,
      dailyReport: {
        required: profile.requireDailyReport,
        workDate: reportDate,
        content: report?.content ?? null,
      },
      pendingReports,
      canClockIn: openEntry === null && pendingReports.length === 0 && !dailyLimit?.reached,
    };
  }
}
