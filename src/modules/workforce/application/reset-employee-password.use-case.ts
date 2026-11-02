import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type {
  AccessDelivery,
  AccessResult,
  AccountAccess,
} from '#shared/application/account-access.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { EmployeeRepository, EmployeeView } from './ports/employee.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

export interface ResetEmployeePasswordInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
  readonly delivery?: AccessDelivery | undefined;
}

export interface ResetEmployeePasswordOutput {
  readonly employee: EmployeeView;
  readonly access: AccessResult;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  accountAccess: AccountAccess;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

export class ResetEmployeePasswordUseCase implements UseCase<
  ResetEmployeePasswordInput,
  ResetEmployeePasswordOutput
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    employeeId,
    delivery,
  }: ResetEmployeePasswordInput): Promise<ResetEmployeePasswordOutput> {
    const { employeeRepository: employees } = this.deps;
    const companyId = companyIdOf(actor);

    const current = await employees.findById(companyId, employeeId);
    if (!current) throw WorkforceErrors.employeeNotFound();

    const access = await this.deps.accountAccess.prepare(current.email, delivery);
    await this.deps.transactions.run(async () => {
      await employees.resetPassword(companyId, employeeId, {
        passwordHash: access.passwordHash,
        expiresAt: access.expiresAt,
      });
      await this.deps.accountAccess.saveLink(current.userId, access);
    });
    await this.deps.securityEvents.record({
      type: SecurityEventType.TEMPORARY_PASSWORD_ISSUED,
      userId: actor.userId,
      companyId,
      client,
      metadata: { employeeId, targetUserId: current.userId, delivery: access.delivery },
    });

    const employee = await employees.findById(companyId, employeeId);
    if (!employee) throw WorkforceErrors.employeeNotFound();
    return {
      employee,
      access: await this.deps.accountAccess.deliver(
        { email: employee.email, firstName: employee.firstName },
        access,
        'reset',
      ),
    };
  }
}
