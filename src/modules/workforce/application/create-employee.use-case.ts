import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { TemporaryPasswordIssuer } from '#shared/application/temporary-password-issuer.js';
import type { UseCase } from '#shared/application/use-case.js';
import { EmployeeRules } from '../domain/employee-rules.js';
import type { EmployeeRepository, EmployeeView } from './ports/employee.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

export interface CreateEmployeeInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone?: string | null | undefined;
  readonly hiredAt?: string | null | undefined;
  readonly timezone?: string | null | undefined;
}

export interface CreateEmployeeOutput {
  readonly employee: EmployeeView;
  readonly temporaryPassword: string;
  readonly temporaryPasswordExpiresAt: Date;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  transactions: TransactionRunner;
  temporaryPasswords: TemporaryPasswordIssuer;
  idGenerator: IdGenerator;
  securityEvents: SecurityEventRecorder;
}

export class CreateEmployeeUseCase implements UseCase<CreateEmployeeInput, CreateEmployeeOutput> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateEmployeeInput): Promise<CreateEmployeeOutput> {
    const { employeeRepository: employees, idGenerator } = this.deps;
    const companyId = companyIdOf(input.actor);

    const email = input.email.trim().toLowerCase();
    const phone = EmployeeRules.normalizePhone(input.phone);
    const timezone = input.timezone ?? null;
    EmployeeRules.assertTimezone(timezone);

    const temporary = await this.deps.temporaryPasswords.issue();
    const employeeId = idGenerator.generate();
    const userId = idGenerator.generate();

    await this.deps.transactions.run(async () => {
      const capacity = await employees.lockCompanyCapacity(companyId);
      if (!capacity) throw WorkforceErrors.companyNotFound();
      EmployeeRules.assertCanAddActiveEmployee(capacity.activeEmployees, capacity.maxEmployees);

      if (await employees.emailExists(email)) throw WorkforceErrors.emailTaken();
      const employeeCode = await employees.nextEmployeeCode(companyId);

      await employees.create({
        companyId,
        employeeId,
        userId,
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        employeeCode,
        phone,
        hiredAt: input.hiredAt ?? null,
        timezone,
        passwordHash: temporary.passwordHash,
        temporaryPasswordExpiresAt: temporary.expiresAt,
      });
    });

    await this.deps.securityEvents.record({
      type: SecurityEventType.EMPLOYEE_CREATED,
      userId: input.actor.userId,
      companyId,
      client: input.client,
      metadata: { employeeId, targetUserId: userId },
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
