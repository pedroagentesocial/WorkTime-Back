import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '#shared/application/actor.js';
import { Role } from '#shared/domain/permissions.js';
import { TimeEntry } from '../domain/time-entry.js';
import { CorrectTimeEntryUseCase } from './correct-time-entry.use-case.js';
import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

const admin: Actor = {
  userId: 'admin-1',
  role: Role.COMPANY_ADMIN,
  companyId: 'c1',
  mustChangePassword: false,
};

const client = { ip: '127.0.0.1', userAgent: 'test' };

function openEntry() {
  return TimeEntry.start({
    id: 'e1',
    companyId: 'c1',
    employeeId: 'emp1',
    at: new Date('2026-06-01T14:00:00Z'),
    timezone: 'America/Denver',
    source: 'web',
  });
}

function fakeRepository(options: { updateSucceeds: boolean }) {
  return {
    findById: vi.fn(async () => openEntry()),
    lockEmployee: vi.fn(async () => {}),
    hasOverlap: vi.fn(async () => false),
    update: vi.fn(async () => options.updateSucceeds),
    addCorrection: vi.fn(async () => {}),
    findViewById: vi.fn(async () => null),
  } as unknown as TimeEntryRepository & {
    update: ReturnType<typeof vi.fn>;
    addCorrection: ReturnType<typeof vi.fn>;
  };
}

function useCase(repository: TimeEntryRepository) {
  return new CorrectTimeEntryUseCase({
    timeEntryRepository: repository,
    transactions: { run: (work) => work() },
    idGenerator: { generate: () => 'corr-1' },
    clock: { now: () => new Date('2026-06-01T20:00:00Z') },
    securityEvents: { record: async () => {}, recordOrThrow: async () => {} },
    periodClosureRepository: {
      lockForChanges: async () => {},
      findCovering: async () => null,
    } as unknown as PeriodClosureRepository,
  });
}

describe('CorrectTimeEntryUseCase', () => {
  it('si el registro cambió mientras se corregía, no lo pisa: TIME_ENTRY_CHANGED', async () => {
    const repository = fakeRepository({ updateSucceeds: false });

    await expect(
      useCase(repository).execute({
        actor: admin,
        client,
        timeEntryId: 'e1',
        clockInAt: new Date('2026-06-01T13:30:00Z'),
        reason: 'Ajuste de entrada',
      }),
    ).rejects.toMatchObject({ code: 'TIME_ENTRY_CHANGED' });

    expect(repository.update).toHaveBeenCalledWith(expect.any(TimeEntry), {
      clockInAt: new Date('2026-06-01T14:00:00Z'),
      clockOutAt: null,
    });
    expect(repository.addCorrection).not.toHaveBeenCalled();
  });

  it('bloquea al empleado antes de revisar cruces', async () => {
    const repository = fakeRepository({ updateSucceeds: true });
    await useCase(repository)
      .execute({
        actor: admin,
        client,
        timeEntryId: 'e1',
        clockOutAt: new Date('2026-06-01T18:00:00Z'),
        reason: 'Olvidó marcar salida',
      })
      .catch(() => undefined);

    const lockOrder = vi.mocked(repository.lockEmployee).mock.invocationCallOrder[0]!;
    const overlapOrder = vi.mocked(repository.hasOverlap).mock.invocationCallOrder[0]!;
    expect(repository.lockEmployee).toHaveBeenCalledWith('c1', 'emp1');
    expect(lockOrder).toBeLessThan(overlapOrder);
  });
});
