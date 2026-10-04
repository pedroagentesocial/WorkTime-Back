import type { Clock } from '#shared/application/ports/clock.js';
import type { Logger } from '#shared/application/ports/logger.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

const BATCH = 100;

interface Deps {
  timeEntryRepository: TimeEntryRepository;
  transactions: TransactionRunner;
  clock: Clock;
  logger: Logger;
}

// Red de seguridad: si se perdio el evento de desactivacion, cierra las entradas abiertas de empleados inactivos
export class CloseEntriesOfInactiveEmployeesUseCase implements UseCase<void, number> {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<number> {
    const { timeEntryRepository: entries } = this.deps;
    const now = this.deps.clock.now();
    let closed = 0;

    for (const candidate of await entries.findOpenOfInactiveEmployees(BATCH)) {
      try {
        await this.deps.transactions.run(async () => {
          const open = await entries.findOpenByEmployee(candidate.employeeId);
          if (open?.id !== candidate.id) return;
          const closeAt = now < open.clockInAt ? open.clockInAt : now;
          if (await entries.closeIfOpen(open.companyId, open.id, closeAt, 'admin')) closed += 1;
        });
      } catch (err) {
        this.deps.logger.error(
          { err, timeEntryId: candidate.id },
          'No se pudo cerrar la entrada de un empleado desactivado',
        );
      }
    }
    if (closed > 0) {
      this.deps.logger.warn({ closed }, 'Se cerraron entradas abiertas de empleados desactivados');
    }
    return closed;
  }
}
