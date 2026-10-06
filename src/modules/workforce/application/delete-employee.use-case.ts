import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { EmployeeRepository } from './ports/employee.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

export interface DeleteEmployeeInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

// Solo se elimina a quien nunca registro horas ni reportes (por ejemplo un alta por error)
export class DeleteEmployeeUseCase implements UseCase<DeleteEmployeeInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, client, employeeId }: DeleteEmployeeInput): Promise<void> {
    const { employeeRepository: employees } = this.deps;
    const companyId = companyIdOf(actor);

    await this.deps.transactions.run(async () => {
      await employees.lockEmployee(companyId, employeeId);
      const current = await employees.findById(companyId, employeeId);
      if (!current) throw WorkforceErrors.employeeNotFound();
      if (await employees.hasHistory(companyId, employeeId)) {
        throw WorkforceErrors.employeeHasHistory();
      }

      await employees.deleteAccount(companyId, employeeId);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.EMPLOYEE_DELETED,
        userId: actor.userId,
        companyId,
        client,
        metadata: {
          employeeId,
          targetUserId: current.userId,
          employeeCode: current.employeeCode,
          email: current.email,
        },
      });
    });
  }
}
