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
import { localDateOf } from '#shared/domain/timezone.js';
import {
  earliestWorkDateInUse,
  FIRST_PAY_PERIOD_START,
  nextPayPeriodStart,
  payPeriodOf,
  previousPayPeriodStart,
  type PayPeriod,
} from '../domain/pay-period.js';
import { centihoursToHours } from '../domain/work-hours.js';
import type { DailyReportRepository } from './ports/daily-report.repository.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import type {
  PeriodClosureRepository,
  PeriodClosureView,
} from './ports/period-closure.repository.js';
import type { OpenEntryBlocker, TimeEntryRepository } from './ports/time-entry.repository.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

const MAX_BLOCKERS = 50;

interface Deps {
  periodClosureRepository: PeriodClosureRepository;
  timeEntryRepository: TimeEntryRepository;
  dailyReportRepository: DailyReportRepository;
  employeeDirectory: EmployeeDirectory;
  transactions: TransactionRunner;
  idGenerator: IdGenerator;
  securityEvents: SecurityEventRecorder;
  clock: Clock;
}

export interface PayPeriodStatus {
  readonly period: PayPeriod;
  readonly previousPeriodStart: string;
  readonly nextPeriodStart: string;
  readonly finished: boolean;
  readonly closure: PeriodClosureView | null;
  readonly totalCentihours: number;
  readonly openEntries: OpenEntryBlocker[];
  readonly pendingReports: {
    readonly required: boolean;
    readonly employees: number;
    readonly days: number;
  };
  readonly canClose: boolean;
}

export interface PayPeriodStatusInput {
  readonly actor: Actor;
  readonly date?: string | undefined;
}

export class GetPayPeriodStatusUseCase implements UseCase<PayPeriodStatusInput, PayPeriodStatus> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, date }: PayPeriodStatusInput): Promise<PayPeriodStatus> {
    const companyId = companyIdOf(actor);
    const { employeeDirectory: directory } = this.deps;
    const timezone = (await directory.companyTimezone(companyId)) ?? 'UTC';
    const today = localDateOf(this.deps.clock.now(), timezone);
    const period = payPeriodOf(date ?? today);
    const range = { from: period.start, to: period.end };

    const [closure, totals, openEntries, policy] = await Promise.all([
      this.deps.periodClosureRepository.find(companyId, period.start),
      this.deps.timeEntryRepository.periodTotals(companyId, range),
      this.deps.timeEntryRepository.findOpenUpTo(companyId, period.end, MAX_BLOCKERS),
      directory.reportPolicy(companyId),
    ]);

    let pendingEmployees = 0;
    let pendingDays = 0;
    if (policy?.required) {
      const from = policy.since > period.start ? policy.since : period.start;
      const rows =
        from > period.end
          ? []
          : await this.deps.dailyReportRepository.findDaysWithoutReport(companyId, {
              from,
              to: period.end,
            });
      pendingEmployees = new Set(rows.map((row) => row.employeeId)).size;
      pendingDays = rows.length;
    }

    const finished = period.end < earliestWorkDateInUse(this.deps.clock.now());
    return {
      period,
      previousPeriodStart: previousPayPeriodStart(period),
      nextPeriodStart: nextPayPeriodStart(period),
      finished,
      closure,
      totalCentihours: totals.reduce((sum, total) => sum + total.centihours, 0),
      openEntries: closure ? [] : openEntries,
      pendingReports: {
        required: policy?.required ?? false,
        employees: pendingEmployees,
        days: pendingDays,
      },
      canClose: closure === null && finished && openEntries.length === 0,
    };
  }
}

export interface ClosePayPeriodInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly date: string;
}

export class ClosePayPeriodUseCase implements UseCase<ClosePayPeriodInput, PeriodClosureView> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, client, date }: ClosePayPeriodInput): Promise<PeriodClosureView> {
    const companyId = companyIdOf(actor);
    const { periodClosureRepository: closures, timeEntryRepository: entries } = this.deps;

    const period = payPeriodOf(date);
    if (period.start < FIRST_PAY_PERIOD_START) {
      throw TimekeepingErrors.periodBeforeStart(FIRST_PAY_PERIOD_START);
    }
    if (period.end >= earliestWorkDateInUse(this.deps.clock.now())) {
      throw TimekeepingErrors.periodNotFinished(period.end);
    }

    await this.deps.transactions.run(async () => {
      await closures.lockForClosing(companyId);
      if (await closures.find(companyId, period.start)) {
        throw TimekeepingErrors.periodAlreadyClosed();
      }

      const open = await entries.findOpenUpTo(companyId, period.end, MAX_BLOCKERS);
      if (open.length > 0) {
        throw TimekeepingErrors.periodHasOpenEntries(
          open.map((entry) => ({
            employee: `${entry.employee.firstName} ${entry.employee.lastName}`,
            workDate: entry.workDate,
          })),
        );
      }

      const total = (
        await entries.periodTotals(companyId, { from: period.start, to: period.end })
      ).reduce((sum, row) => sum + row.centihours, 0);
      await closures.insert({
        id: this.deps.idGenerator.generate(),
        companyId,
        periodStart: period.start,
        periodEnd: period.end,
        totalCentihours: total,
        closedById: actor.userId,
      });
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.PAY_PERIOD_CLOSED,
        userId: actor.userId,
        companyId,
        client,
        metadata: {
          periodStart: period.start,
          periodEnd: period.end,
          totalHours: centihoursToHours(total),
        },
      });
    });

    const closure = await closures.find(companyId, period.start);
    if (!closure) throw TimekeepingErrors.periodAlreadyClosed();
    return closure;
  }
}
