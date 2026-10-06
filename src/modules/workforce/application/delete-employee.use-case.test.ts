import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '#shared/application/actor.js';
import type { SecurityEventRecorder } from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import { Role } from '#shared/domain/permissions.js';
import { DeleteEmployeeUseCase } from './delete-employee.use-case.js';
import type { EmployeeRepository, EmployeeView } from './ports/employee.repository.js';

const admin: Actor = {
  userId: 'admin-1',
  role: Role.COMPANY_ADMIN,
  companyId: 'c1',
  mustChangePassword: false,
};

const view = {
  id: 'emp-1',
  userId: 'user-1',
  email: 'ana@empresa.com',
  employeeCode: 'KCS-0001',
} as EmployeeView;

function build(options: { found?: boolean; history?: boolean } = {}) {
  const calls: string[] = [];
  const employees = {
    lockEmployee: vi.fn(async () => void calls.push('lock')),
    findById: vi.fn(async () => (options.found === false ? null : view)),
    hasHistory: vi.fn(async () => options.history === true),
    deleteAccount: vi.fn(async () => void calls.push('delete')),
  } as unknown as EmployeeRepository;
  const securityEvents = {
    recordOrThrow: vi.fn(async () => void calls.push('audit')),
  } as unknown as SecurityEventRecorder;
  const transactions = { run: async (work: () => Promise<unknown>) => work() } as TransactionRunner;
  const useCase = new DeleteEmployeeUseCase({
    employeeRepository: employees,
    securityEvents,
    transactions,
  });
  return { useCase, employees, securityEvents, calls };
}

const input = { actor: admin, client: {}, employeeId: 'emp-1' };

describe('DeleteEmployeeUseCase', () => {
  it('bloquea al empleado, lo borra y deja auditoria en ese orden', async () => {
    const { useCase, calls, securityEvents } = build();
    await useCase.execute(input);
    expect(calls).toEqual(['lock', 'delete', 'audit']);
    expect(securityEvents.recordOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'employee.deleted',
        metadata: expect.objectContaining({ employeeCode: 'KCS-0001', email: 'ana@empresa.com' }),
      }),
    );
  });

  it('con historial no borra nada', async () => {
    const { useCase, employees, securityEvents } = build({ history: true });
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'EMPLOYEE_HAS_HISTORY' });
    expect(employees.deleteAccount).not.toHaveBeenCalled();
    expect(securityEvents.recordOrThrow).not.toHaveBeenCalled();
  });

  it('un empleado inexistente responde 404', async () => {
    const { useCase, employees } = build({ found: false });
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
    expect(employees.deleteAccount).not.toHaveBeenCalled();
  });

  it('si la auditoria falla la transaccion se cancela', async () => {
    const { useCase, securityEvents } = build();
    vi.mocked(securityEvents.recordOrThrow).mockRejectedValueOnce(new Error('sin auditoria'));
    await expect(useCase.execute(input)).rejects.toThrow('sin auditoria');
  });
});
