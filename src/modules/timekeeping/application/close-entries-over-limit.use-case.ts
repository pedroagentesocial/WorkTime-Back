import type { Clock } from '#shared/application/ports/clock.js';
import type { Logger } from '#shared/application/ports/logger.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { closeIfOverLimit } from './daily-limit-enforcement.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  transactions: TransactionRunner;
  clock: Clock;
  logger: Logger;
}

export class CloseEntriesOverLimitUseCase implements UseCase<void, number> {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<number> {
    const { timeEntryRepository: entries } = this.deps;
    const now = this.deps.clock.now();
    let closed = 0;

    for (const candidate of await entries.findOverLimit(now)) {
      try {
        await this.deps.transactions.run(async () => {
          const open = await entries.findOpenByEmployee(candidate.employeeId);
          if (open?.id !== candidate.id) return;
          if (await closeIfOverLimit(entries, open, candidate.limitMinutes, now)) closed += 1;
        });
      } catch (err) {
        this.deps.logger.error({ err, timeEntryId: candidate.id }, 'No se pudo cerrar por límite');
      }
    }
    return closed;
  }
}
