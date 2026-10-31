import { describe, expect, it, vi } from 'vitest';
import type { SecurityEventInput } from '#shared/application/ports/security-event-recorder.js';
import { PlatformErrors } from './platform-errors.js';
import type { PlatformAdminRepository } from './ports/platform-admin.repository.js';
import { RecoverPlatformAdminUseCase } from './recover-platform-admin.use-case.js';

const admin = { id: 'admin-1', email: 'admin@worktime.com', firstName: 'Ana', lastName: 'Ruiz' };
const expiresAt = new Date('2026-10-23T00:00:00Z');

function build(options: { exists?: boolean; auditFails?: boolean } = {}) {
  const recoverAccess = vi.fn(async () => (options.exists === false ? null : admin));
  const events: SecurityEventInput[] = [];
  const useCase = new RecoverPlatformAdminUseCase({
    platformAdminRepository: { recoverAccess } satisfies PlatformAdminRepository,
    temporaryPasswords: {
      issue: async () => ({ password: 'temporal-1234567', passwordHash: 'hash', expiresAt }),
    } as never,
    securityEvents: {
      record: async () => {},
      recordOrThrow: async (event) => {
        if (options.auditFails) throw new Error('sin auditoria');
        events.push(event);
      },
    },
    transactions: { run: <T>(work: () => Promise<T>) => work() },
  });
  return { useCase, recoverAccess, events };
}

describe('RecoverPlatformAdminUseCase', () => {
  it('guarda solo el hash y devuelve la contraseña temporal una vez', async () => {
    const { useCase, recoverAccess } = build();

    const result = await useCase.execute();

    expect(recoverAccess).toHaveBeenCalledWith({ passwordHash: 'hash', expiresAt });
    expect(result).toEqual({
      admin,
      temporaryPassword: 'temporal-1234567',
      temporaryPasswordExpiresAt: expiresAt,
    });
  });

  it('deja constancia de que se recuperó desde la terminal', async () => {
    const { useCase, events } = build();
    await useCase.execute();
    expect(events).toEqual([
      { type: 'platform_admin.recovered', userId: 'admin-1', metadata: { source: 'cli' } },
    ]);
  });

  it('sin admin global avisa que hay que crearlo con el seed', async () => {
    const { useCase, events } = build({ exists: false });
    await expect(useCase.execute()).rejects.toMatchObject({
      code: PlatformErrors.platformAdminNotFound().code,
    });
    expect(events).toHaveLength(0);
  });

  it('si no se puede auditar, falla y la transacción no se confirma', async () => {
    const { useCase } = build({ auditFails: true });
    await expect(useCase.execute()).rejects.toThrow('sin auditoria');
  });
});
