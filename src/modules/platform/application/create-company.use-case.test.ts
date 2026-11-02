import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '#shared/application/actor.js';
import { Role } from '#shared/domain/permissions.js';
import { CreateCompanyUseCase } from './create-company.use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyRepository, NewCompanyWithAdmin } from './ports/company.repository.js';

const actor: Actor = {
  userId: 'platform-1',
  role: Role.PLATFORM_ADMIN,
  companyId: null,
  mustChangePassword: false,
};

function build(failures: number) {
  const created: NewCompanyWithAdmin[] = [];
  let remaining = failures;
  const repository = {
    emailExists: async () => false,
    createWithAdmin: vi.fn(async (input: NewCompanyWithAdmin) => {
      created.push(input);
      if (remaining > 0) {
        remaining -= 1;
        throw PlatformErrors.identifierTaken();
      }
    }),
    findById: async () => ({ id: 'c1' }) as never,
  } as unknown as CompanyRepository;

  let seed = 0;
  const useCase = new CreateCompanyUseCase({
    companyRepository: repository,
    accountAccess: {
      prepare: async () => ({
        delivery: 'temporary_password',
        passwordHash: 'hash',
        expiresAt: new Date('2026-10-10T00:00:00Z'),
        temporaryPassword: 'temporal',
        token: null,
      }),
      saveLink: async () => {},
      deliver: async () => ({}),
    } as never,
    idGenerator: { generate: () => 'id' },
    secureRandom: { int: () => (seed += 1) % 20 } as never,
    securityEvents: { record: async () => {}, recordOrThrow: async () => {} },
  });
  return { useCase, repository, created };
}

const input = {
  actor,
  client: {},
  name: 'Taller Pérez',
  maxEmployees: 10,
  admin: { email: 'juan@taller.com', firstName: 'Juan', lastName: 'Pérez' },
};

describe('CreateCompanyUseCase: códigos de la empresa', () => {
  it('genera el código y el prefijo, con el formato esperado', async () => {
    const { useCase, created } = build(0);
    await useCase.execute(input);
    expect(created[0]?.company.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(created[0]?.company.employeeCodePrefix).toMatch(/^[A-Z]{3}$/);
  });

  it('si el código o el prefijo ya existen, reintenta con otros', async () => {
    const { useCase, repository, created } = build(2);
    await useCase.execute(input);
    expect(repository.createWithAdmin).toHaveBeenCalledTimes(3);
    const codes = created.map((c) => c.company.code);
    expect(new Set(codes).size).toBe(3);
  });

  it('se rinde tras varios intentos fallidos con el error original', async () => {
    const { useCase, repository } = build(99);
    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: 'COMPANY_IDENTIFIER_TAKEN',
    });
    expect(repository.createWithAdmin).toHaveBeenCalledTimes(5);
  });
});
