import { describe, expect, it, vi } from 'vitest';
import type { SecurityEventInput } from '#shared/application/ports/security-event-recorder.js';
import type { PlatformAdminView } from './ports/platform-admin.repository.js';
import { RecoverPlatformAdminUseCase } from './recover-platform-admin.use-case.js';

const expiresAt = new Date('2026-10-23T12:00:00Z');

function build(admins: PlatformAdminView[], options: { auditFails?: boolean } = {}) {
  const recover = vi.fn(async () => {});
  const events: SecurityEventInput[] = [];
  const useCase = new RecoverPlatformAdminUseCase({
    platformAdminRepository: { listAll: async () => admins, recover },
    temporaryPasswords: {
      issue: async () => ({ password: 'temporal', passwordHash: 'hash', expiresAt }),
    } as never,
    transactions: { run: (work) => work() },
    securityEvents: {
      record: async () => {},
      recordOrThrow: async (event) => {
        if (options.auditFails) throw new Error('sin auditoria');
        events.push(event);
      },
    },
  });
  return { useCase, recover, events };
}

const admin = { id: 'admin-1', email: 'admin@worktime.com' };

describe('RecoverPlatformAdminUseCase', () => {
  it('restablece al admin global y devuelve la temporal una vez', async () => {
    const { useCase, recover, events } = build([admin]);
    const result = await useCase.execute();

    expect(result).toEqual({
      admin,
      temporaryPassword: 'temporal',
      temporaryPasswordExpiresAt: expiresAt,
    });
    expect(recover).toHaveBeenCalledWith('admin-1', { passwordHash: 'hash', expiresAt });
    expect(events).toEqual([
      { type: 'platform_admin.recovered', userId: 'admin-1', metadata: { channel: 'cli' } },
    ]);
  });

  it('sin admin global → PLATFORM_ADMIN_NOT_FOUND', async () => {
    const { useCase, recover } = build([]);
    await expect(useCase.execute()).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_NOT_FOUND' });
    expect(recover).not.toHaveBeenCalled();
  });

  it('con más de un admin global no toca ninguno → PLATFORM_ADMIN_AMBIGUOUS', async () => {
    const { useCase, recover } = build([admin, { id: 'admin-2', email: 'otro@worktime.com' }]);
    await expect(useCase.execute()).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_AMBIGUOUS' });
    expect(recover).not.toHaveBeenCalled();
  });

  it('si no se puede auditar, falla y no entrega la contraseña', async () => {
    const { useCase } = build([admin], { auditFails: true });
    await expect(useCase.execute()).rejects.toThrow('sin auditoria');
  });
});
