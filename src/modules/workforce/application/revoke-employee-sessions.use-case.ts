import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { EmployeeRepository } from './ports/employee.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

export interface RevokeEmployeeSessionsInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  securityEvents: SecurityEventRecorder;
}

export class RevokeEmployeeSessionsUseCase implements UseCase<RevokeEmployeeSessionsInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, client, employeeId }: RevokeEmployeeSessionsInput): Promise<void> {
    const companyId = companyIdOf(actor);
    const employee = await this.deps.employeeRepository.findById(companyId, employeeId);
    if (!employee) throw WorkforceErrors.employeeNotFound();

    await this.deps.employeeRepository.revokeSessions(companyId, employeeId);
    await this.deps.securityEvents.record({
      type: SecurityEventType.EMPLOYEE_SESSIONS_REVOKED,
      userId: actor.userId,
      companyId,
      client,
      metadata: { employeeId, targetUserId: employee.userId },
    });
  }
}
