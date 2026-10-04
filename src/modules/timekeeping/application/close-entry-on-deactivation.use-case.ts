import type { Clock } from '#shared/application/ports/clock.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

export interface EmployeeDeactivatedInput {
  readonly companyId: string;
  readonly employeeId: string;
  readonly deactivatedBy: string;
  readonly at: Date;
}

export const AUTO_CLOSE_REASON = 'Cierre automático: el empleado fue desactivado';

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  transactions: TransactionRunner;
  idGenerator: IdGenerator;
  clock: Clock;
}

export class CloseEntryOnDeactivationUseCase implements UseCase<EmployeeDeactivatedInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: EmployeeDeactivatedInput): Promise<void> {
    const { timeEntryRepository: entries } = this.deps;

    await this.deps.transactions.run(async () => {
      const open = await entries.findOpenByEmployee(input.employeeId);
      if (open?.companyId !== input.companyId) return;

      const closeAt = input.at < open.clockInAt ? open.clockInAt : input.at;
      if (!(await entries.closeIfOpen(input.companyId, open.id, closeAt, 'admin'))) return;

      await entries.addCorrection({
        id: this.deps.idGenerator.generate(),
        companyId: input.companyId,
        timeEntryId: open.id,
        correctedById: input.deactivatedBy,
        previousClockInAt: open.clockInAt,
        previousClockOutAt: null,
        newClockInAt: open.clockInAt,
        newClockOutAt: closeAt,
        reason: AUTO_CLOSE_REASON,
      });
    });
  }
}
