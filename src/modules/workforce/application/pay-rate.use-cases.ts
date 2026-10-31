import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { PayRules, type PayKind } from '#shared/domain/pay-rules.js';
import type { EmployeeRepository } from './ports/employee.repository.js';
import type { InactiveSpanRepository, InactiveSpanView } from './ports/inactive-span.repository.js';
import type { PayRateRepository, PayRateView } from './ports/pay-rate.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

export interface EmployeePayRate extends PayRateView {
  // Rige desde un dia de un periodo cerrado: ya no se puede quitar
  readonly locked: boolean;
}

export interface EmployeePayRates {
  readonly currency: string;
  readonly rates: EmployeePayRate[];
  // Bajas del empleado, de la mas vieja a la mas nueva: dias sin sueldo fijo
  readonly inactiveSpans: InactiveSpanView[];
}

interface Deps {
  employeeRepository: EmployeeRepository;
  payRateRepository: PayRateRepository;
  inactiveSpanRepository: InactiveSpanRepository;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
  idGenerator: IdGenerator;
}

async function payRatesOf(
  deps: Pick<Deps, 'payRateRepository' | 'inactiveSpanRepository'>,
  companyId: string,
  employeeId: string,
): Promise<EmployeePayRates> {
  const [currency, rates, lastClosedDay, inactiveSpans] = await Promise.all([
    deps.payRateRepository.currencyOf(companyId),
    deps.payRateRepository.list(companyId, employeeId),
    deps.payRateRepository.lastClosedDay(companyId),
    deps.inactiveSpanRepository.list(companyId, employeeId),
  ]);
  if (!currency) throw WorkforceErrors.companyNotFound();
  return {
    currency,
    rates: rates.map((rate) => ({
      ...rate,
      locked: lastClosedDay !== null && rate.effectiveFrom <= lastClosedDay,
    })),
    inactiveSpans,
  };
}

export interface ListEmployeePayRatesInput {
  readonly actor: Actor;
  readonly employeeId: string;
}

export class ListEmployeePayRatesUseCase implements UseCase<
  ListEmployeePayRatesInput,
  EmployeePayRates
> {
  constructor(
    private readonly deps: Pick<
      Deps,
      'employeeRepository' | 'payRateRepository' | 'inactiveSpanRepository'
    >,
  ) {}

  async execute({ actor, employeeId }: ListEmployeePayRatesInput): Promise<EmployeePayRates> {
    const companyId = companyIdOf(actor);
    const employee = await this.deps.employeeRepository.findById(companyId, employeeId);
    if (!employee) throw WorkforceErrors.employeeNotFound();
    return payRatesOf(this.deps, companyId, employeeId);
  }
}

export interface SetEmployeePayRateInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
  readonly kind: PayKind;
  readonly amountCents: number;
  readonly effectiveFrom: string;
}

export class SetEmployeePayRateUseCase implements UseCase<
  SetEmployeePayRateInput,
  EmployeePayRates
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    employeeId,
    kind,
    amountCents,
    effectiveFrom,
  }: SetEmployeePayRateInput): Promise<EmployeePayRates> {
    PayRules.assertAmount(amountCents);
    const companyId = companyIdOf(actor);
    const { employeeRepository: employees, payRateRepository: rates } = this.deps;

    await this.deps.transactions.run(async () => {
      await employees.lockEmployee(companyId, employeeId);
      const employee = await employees.findById(companyId, employeeId);
      if (!employee) throw WorkforceErrors.employeeNotFound();

      // Un periodo cerrado ya congelo lo que se pago: el cambio solo puede regir despues
      const lastClosedDay = await rates.lockAndLastClosedDay(companyId);
      if (lastClosedDay && effectiveFrom <= lastClosedDay) {
        throw WorkforceErrors.payRateInClosedPeriod(lastClosedDay);
      }

      await rates.save(companyId, employeeId, {
        id: this.deps.idGenerator.generate(),
        kind,
        amountCents,
        effectiveFrom,
        changedById: actor.userId,
      });
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.EMPLOYEE_PAY_RATE_CHANGED,
        userId: actor.userId,
        companyId,
        client,
        metadata: { employeeId, kind, amountCents, effectiveFrom },
      });
    });

    return payRatesOf(this.deps, companyId, employeeId);
  }
}

export interface RemoveEmployeePayRateInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly employeeId: string;
  readonly rateId: string;
}

// Quita un cambio de sueldo equivocado; los de un periodo cerrado ya se pagaron y se quedan
export class RemoveEmployeePayRateUseCase implements UseCase<
  RemoveEmployeePayRateInput,
  EmployeePayRates
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    employeeId,
    rateId,
  }: RemoveEmployeePayRateInput): Promise<EmployeePayRates> {
    const companyId = companyIdOf(actor);
    const { employeeRepository: employees, payRateRepository: rates } = this.deps;

    await this.deps.transactions.run(async () => {
      await employees.lockEmployee(companyId, employeeId);
      const rate = await rates.find(companyId, employeeId, rateId);
      if (!rate) throw WorkforceErrors.payRateNotFound();
      const lastClosedDay = await rates.lockAndLastClosedDay(companyId);
      if (lastClosedDay && rate.effectiveFrom <= lastClosedDay) {
        throw WorkforceErrors.payRateLocked();
      }

      await rates.remove(companyId, rateId);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.EMPLOYEE_PAY_RATE_REMOVED,
        userId: actor.userId,
        companyId,
        client,
        metadata: {
          employeeId,
          kind: rate.kind,
          amountCents: rate.amountCents,
          effectiveFrom: rate.effectiveFrom,
        },
      });
    });

    return payRatesOf(this.deps, companyId, employeeId);
  }
}
