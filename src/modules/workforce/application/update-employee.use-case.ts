import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { DailyLimit } from '#shared/domain/daily-limit.js';
import { EmployeeRules } from '../domain/employee-rules.js';
import type {
  EmployeePatch,
  EmployeeRepository,
  EmployeeView,
} from './ports/employee.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

export interface UpdateEmployeeInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
  readonly patch: EmployeePatch;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  securityEvents: SecurityEventRecorder;
  transactions: TransactionRunner;
}

// Cambian lo que se paga o quien puede tocar sus horas: se guarda el valor anterior y el nuevo
const PAY_FIELDS = ['dailyLimitMinutes', 'allowSelfEdit', 'selfEditUntil'] as const;

export class UpdateEmployeeUseCase implements UseCase<UpdateEmployeeInput, EmployeeView> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, client, employeeId, patch }: UpdateEmployeeInput): Promise<EmployeeView> {
    const { employeeRepository: employees } = this.deps;
    const companyId = companyIdOf(actor);

    const current = await employees.findById(companyId, employeeId);
    if (!current) throw WorkforceErrors.employeeNotFound();

    const changes: EmployeePatch = {
      ...(patch.firstName !== undefined && { firstName: patch.firstName.trim() }),
      ...(patch.lastName !== undefined && { lastName: patch.lastName.trim() }),
      ...(patch.hiredAt !== undefined && { hiredAt: patch.hiredAt }),
      ...(patch.phone !== undefined && { phone: EmployeeRules.normalizePhone(patch.phone) }),
      ...(patch.timezone !== undefined && { timezone: patch.timezone }),
      ...(patch.dailyLimitMinutes !== undefined && {
        dailyLimitMinutes: patch.dailyLimitMinutes,
      }),
      ...(patch.allowCheckIns !== undefined && { allowCheckIns: patch.allowCheckIns }),
      ...(patch.allowSelfEdit !== undefined && { allowSelfEdit: patch.allowSelfEdit }),
      ...(patch.selfEditUntil !== undefined && { selfEditUntil: patch.selfEditUntil }),
    };
    if (changes.timezone !== undefined) EmployeeRules.assertTimezone(changes.timezone);
    if (changes.dailyLimitMinutes !== undefined) DailyLimit.assertValid(changes.dailyLimitMinutes);

    const payChanges = Object.fromEntries(
      PAY_FIELDS.filter((field) => changes[field] !== undefined).map((field) => [
        field,
        { from: current[field], to: changes[field] },
      ]),
    );
    await this.deps.transactions.run(async () => {
      await employees.update(companyId, employeeId, changes);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.EMPLOYEE_UPDATED,
        userId: actor.userId,
        companyId,
        client,
        metadata: { employeeId, fields: Object.keys(changes), payChanges },
      });
    });

    const updated = await employees.findById(companyId, employeeId);
    if (!updated) throw WorkforceErrors.employeeNotFound();
    return updated;
  }
}
