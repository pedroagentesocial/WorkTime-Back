import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { EventBus } from '#shared/application/ports/event-bus.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { EmployeeRules, type EmployeeStatus } from '../domain/employee-rules.js';
import { WorkforceEvents, type EmployeeDeactivated } from '../domain/events.js';
import { planDeactivation, planReactivation } from './inactive-span-plan.js';
import type { EmployeeRepository, EmployeeView } from './ports/employee.repository.js';
import type { InactiveSpanRepository } from './ports/inactive-span.repository.js';
import type { PayRateRepository } from './ports/pay-rate.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

export interface ChangeEmployeeStatusInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
  readonly status: EmployeeStatus;
  // Al desactivar, el ultimo dia que cobra; al reactivar, el primero. Por defecto hoy en su zona
  readonly effectiveOn?: string | undefined;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  inactiveSpanRepository: InactiveSpanRepository;
  payRateRepository: PayRateRepository;
  transactions: TransactionRunner;
  eventBus: EventBus;
  securityEvents: SecurityEventRecorder;
  clock: Clock;
}

export class ChangeEmployeeStatusUseCase implements UseCase<
  ChangeEmployeeStatusInput,
  EmployeeView
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    employeeId,
    status,
    effectiveOn,
  }: ChangeEmployeeStatusInput): Promise<EmployeeView> {
    const { employeeRepository: employees, inactiveSpanRepository: spans } = this.deps;
    const companyId = companyIdOf(actor);

    const current = await employees.findById(companyId, employeeId);
    if (!current) throw WorkforceErrors.employeeNotFound();
    if (current.status === status) return current;
    const today = localDateOf(this.deps.clock.now(), current.effectiveTimezone);
    const day = effectiveOn ?? today;

    if (status === 'active') {
      await this.deps.transactions.run(async () => {
        const capacity = await employees.lockCompanyCapacity(companyId);
        if (!capacity) throw WorkforceErrors.companyNotFound();
        EmployeeRules.assertCanAddActiveEmployee(capacity.activeEmployees, capacity.maxEmployees);
        await employees.lockEmployee(companyId, employeeId);
        const lastClosedDay = await this.deps.payRateRepository.lockAndLastClosedDay(companyId);
        const plan = planReactivation(await spans.list(companyId, employeeId), day, {
          today,
          lastClosedDay,
        });
        if (plan.action === 'remove') await spans.remove(companyId, employeeId, plan.fromDay);
        if (plan.action === 'end') await spans.end(companyId, employeeId, plan.fromDay, plan.toDay);
        await employees.setStatus(companyId, employeeId, 'active');
      });
    } else {
      await this.deps.transactions.run(async () => {
        await employees.lockEmployee(companyId, employeeId);
        const lastClosedDay = await this.deps.payRateRepository.lockAndLastClosedDay(companyId);
        const plan = planDeactivation(await spans.list(companyId, employeeId), day, {
          today,
          lastClosedDay,
        });
        await spans.start(companyId, employeeId, plan.startFrom);
        await employees.setStatus(companyId, employeeId, 'inactive');
      });
      const event: EmployeeDeactivated = {
        name: WorkforceEvents.EMPLOYEE_DEACTIVATED,
        occurredAt: this.deps.clock.now(),
        payload: { companyId, employeeId, userId: current.userId, deactivatedBy: actor.userId },
      };
      await this.deps.eventBus.publish(event);
    }

    await this.deps.securityEvents.record({
      type:
        status === 'active'
          ? SecurityEventType.EMPLOYEE_REACTIVATED
          : SecurityEventType.EMPLOYEE_DEACTIVATED,
      userId: actor.userId,
      companyId,
      client,
      metadata: { employeeId, targetUserId: current.userId, effectiveOn: day },
    });

    const updated = await employees.findById(companyId, employeeId);
    if (!updated) throw WorkforceErrors.employeeNotFound();
    return updated;
  }
}
