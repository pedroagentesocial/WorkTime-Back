import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '#shared/application/actor.js';
import type { SecurityEventRecorder } from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import { Role } from '#shared/domain/permissions.js';
import { SetEmployeePayRateUseCase } from './pay-rate.use-cases.js';
import type { EmployeeRepository, EmployeeView } from './ports/employee.repository.js';
import type { InactiveSpanRepository } from './ports/inactive-span.repository.js';
import type { PayRateRepository } from './ports/pay-rate.repository.js';

const admin: Actor = {
  userId: 'admin-1',
  role: Role.COMPANY_ADMIN,
  companyId: 'c1',
  mustChangePassword: false,
};

function build(lastClosedDay: string | null = null) {
  const calls: string[] = [];
  const employees = {
    lockEmployee: vi.fn(async () => void calls.push('lock')),
    findById: vi.fn(async () => ({ id: 'emp-1' }) as EmployeeView),
  } as unknown as EmployeeRepository;
  const rates = {
    lockAndLastClosedDay: vi.fn(async () => lastClosedDay),
    save: vi.fn(async () => void calls.push('save')),
    list: vi.fn(async () => []),
    currencyOf: vi.fn(async () => 'USD'),
    lastClosedDay: vi.fn(async () => lastClosedDay),
  } as unknown as PayRateRepository;
  const securityEvents = {
    recordOrThrow: vi.fn(async () => void calls.push('audit')),
  } as unknown as SecurityEventRecorder;
  const transactions = { run: async (work: () => Promise<unknown>) => work() } as TransactionRunner;
  const useCase = new SetEmployeePayRateUseCase({
    employeeRepository: employees,
    payRateRepository: rates,
    inactiveSpanRepository: { list: vi.fn(async () => []) } as unknown as InactiveSpanRepository,
    transactions,
    securityEvents,
    idGenerator: { generate: () => 'rate-1' },
  });
  return { useCase, rates, calls };
}

const input = {
  actor: admin,
  client: {},
  employeeId: 'emp-1',
  kind: 'hourly' as const,
  amountCents: 1500,
  effectiveFrom: '2026-10-05',
};

describe('SetEmployeePayRateUseCase', () => {
  it('bloquea al empleado, guarda y audita en ese orden', async () => {
    const { useCase, calls } = build('2026-10-04');
    const result = await useCase.execute(input);
    expect(calls).toEqual(['lock', 'save', 'audit']);
    expect(result.currency).toBe('USD');
  });

  it('no deja que el cambio rija en un periodo cerrado', async () => {
    const { useCase, rates } = build('2026-10-04');
    await expect(useCase.execute({ ...input, effectiveFrom: '2026-10-04' })).rejects.toMatchObject({
      code: 'PAY_RATE_IN_CLOSED_PERIOD',
    });
    expect(rates.save).not.toHaveBeenCalled();
  });

  it('rechaza montos negativos o con fracciones de centavo', async () => {
    const { useCase } = build();
    await expect(useCase.execute({ ...input, amountCents: -1 })).rejects.toMatchObject({
      code: 'INVALID_PAY_AMOUNT',
    });
    await expect(useCase.execute({ ...input, amountCents: 10.5 })).rejects.toMatchObject({
      code: 'INVALID_PAY_AMOUNT',
    });
  });
});
