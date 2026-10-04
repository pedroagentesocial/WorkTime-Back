import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TemporaryPasswordIssuer } from '#shared/application/temporary-password-issuer.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { EmployeeRepository, EmployeeView } from './ports/employee.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

export interface ResetEmployeePasswordInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
}

export interface ResetEmployeePasswordOutput {
  readonly employee: EmployeeView;
  readonly temporaryPassword: string;
  readonly temporaryPasswordExpiresAt: Date;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  temporaryPasswords: TemporaryPasswordIssuer;
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
  }: ResetEmployeePasswordInput): Promise<ResetEmployeePasswordOutput> {
    const { employeeRepository: employees } = this.deps;
    const companyId = companyIdOf(actor);

    const current = await employees.findById(companyId, employeeId);
    if (!current) throw WorkforceErrors.employeeNotFound();

    const temporary = await this.deps.temporaryPasswords.issue();
    await employees.resetPassword(companyId, employeeId, {
      passwordHash: temporary.passwordHash,
      expiresAt: temporary.expiresAt,
    });
    await this.deps.securityEvents.record({
      type: SecurityEventType.TEMPORARY_PASSWORD_ISSUED,
      userId: actor.userId,
      companyId,
      client,
      metadata: { employeeId, targetUserId: current.userId },
    });

    const employee = await employees.findById(companyId, employeeId);
    if (!employee) throw WorkforceErrors.employeeNotFound();
    return {
      employee,
      temporaryPassword: temporary.password,
      temporaryPasswordExpiresAt: temporary.expiresAt,
    };
  }
}
