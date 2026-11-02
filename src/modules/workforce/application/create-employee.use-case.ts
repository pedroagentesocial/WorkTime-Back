import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type {
  AccessDelivery,
  AccessResult,
  AccountAccess,
} from '#shared/application/account-access.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf, resolveTimezone } from '#shared/domain/timezone.js';
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
  readonly delivery?: AccessDelivery | undefined;
}

export interface CreateEmployeeOutput {
  readonly employee: EmployeeView;
  readonly access: AccessResult;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  transactions: TransactionRunner;
  accountAccess: AccountAccess;
  idGenerator: IdGenerator;
  securityEvents: SecurityEventRecorder;
  clock: Clock;
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

    const access = await this.deps.accountAccess.prepare(email, input.delivery);
    const employeeId = idGenerator.generate();
    const userId = idGenerator.generate();

    await this.deps.transactions.run(async () => {
      const capacity = await employees.lockCompanyCapacity(companyId);
      if (!capacity) throw WorkforceErrors.companyNotFound();
      EmployeeRules.assertCanAddActiveEmployee(capacity.activeEmployees, capacity.maxEmployees);

      if (await employees.emailExists(email)) throw WorkforceErrors.emailTaken();
      const employeeCode = await employees.nextEmployeeCode(companyId);
      // Sin fecha de ingreso explicita, es el dia del alta en la zona horaria del empleado
      const hiredAt =
        input.hiredAt ??
        localDateOf(this.deps.clock.now(), resolveTimezone(timezone, capacity.timezone));

      await employees.create({
        companyId,
        employeeId,
        userId,
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        employeeCode,
        phone,
        hiredAt,
        timezone,
        passwordHash: access.passwordHash,
        temporaryPasswordExpiresAt: access.expiresAt,
      });
      await this.deps.accountAccess.saveLink(userId, access);
    });

    await this.deps.securityEvents.record({
      type: SecurityEventType.EMPLOYEE_CREATED,
      userId: input.actor.userId,
      companyId,
      client: input.client,
      metadata: { employeeId, targetUserId: userId, delivery: access.delivery },
    });

    const employee = await employees.findById(companyId, employeeId);
    if (!employee) throw WorkforceErrors.employeeNotFound();
    return {
      employee,
      access: await this.deps.accountAccess.deliver(
        { email, firstName: employee.firstName },
        access,
        'welcome',
      ),
    };
  }
}
