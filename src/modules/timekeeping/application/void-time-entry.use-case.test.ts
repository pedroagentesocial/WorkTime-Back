import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '#shared/application/actor.js';
import { Role } from '#shared/domain/permissions.js';
import { TimeEntry } from '../domain/time-entry.js';
import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import type { TimeEntryRepository, TimeEntryView } from './ports/time-entry.repository.js';
import { VoidTimeEntryUseCase } from './void-time-entry.use-case.js';

const admin: Actor = {
  userId: 'admin-1',
  role: Role.COMPANY_ADMIN,
  companyId: 'c1',
  mustChangePassword: false,
};

function entryOn(date: string) {
  return TimeEntry.restore({
    id: 'e1',
    companyId: 'c1',
    employeeId: 'emp1',
    clockInAt: new Date(`${date}T14:00:00Z`),
    clockOutAt: new Date(`${date}T18:00:00Z`),
    timezone: 'America/Denver',
    workDate: date,
    source: 'web',
    closeSource: 'employee',
    dailyLimitWaived: false,
    createdReason: null,
    clockInLocation: null,
    clockInZone: null,
  });
}

const staleView = {
  id: 'e1',
  employee: { id: 'emp1', firstName: 'Ana', lastName: 'User', employeeCode: null },
  workDate: '2026-10-06',
  voided: null,
} as unknown as TimeEntryView;

function build(currentEntry: TimeEntry | null, closedOn: string | null) {
  const repository = {
    findViewById: vi.fn(async () => staleView),
    lockEmployee: vi.fn(async () => {}),
    findById: vi.fn(async () => currentEntry),
    voidIfActive: vi.fn(async () => true),
  } as unknown as TimeEntryRepository & Record<string, ReturnType<typeof vi.fn>>;
  const recordOrThrow = vi.fn(async () => {});
  const useCase = new VoidTimeEntryUseCase({
    timeEntryRepository: repository,
    periodClosureRepository: {
      lockForChanges: async () => {},
      findCovering: async (_company: string, date: string) =>
        date === closedOn
          ? ({ periodStart: '2026-09-21', periodEnd: '2026-10-04' } as never)
          : null,
    } as unknown as PeriodClosureRepository,
    transactions: { run: (work) => work() },
    securityEvents: { record: async () => {}, recordOrThrow },
    clock: { now: () => new Date('2026-10-07T18:00:00Z') },
  });
  return { repository, recordOrThrow, useCase };
}

const input = {
  actor: admin,
  client: {},
  timeEntryId: 'e1',
  reason: 'Se creó por duplicado',
};

describe('VoidTimeEntryUseCase', () => {
  it('usa el día del registro releído con el bloqueo, no el que se leyó antes', async () => {
    const { repository, recordOrThrow, useCase } = build(entryOn('2026-10-01'), '2026-10-01');

    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    expect(repository.voidIfActive).not.toHaveBeenCalled();
    expect(recordOrThrow).not.toHaveBeenCalled();
  });

  it('si el registro ya se anuló mientras esperaba, responde que está anulado', async () => {
    const { repository, useCase } = build(null, null);
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'TIME_ENTRY_VOIDED' });
    expect(repository.voidIfActive).not.toHaveBeenCalled();
  });

  it('audita dentro de la misma transacción y después de anular', async () => {
    const { repository, recordOrThrow, useCase } = build(entryOn('2026-10-06'), null);
    vi.spyOn(repository, 'findViewById')
      .mockResolvedValueOnce(staleView)
      .mockResolvedValue({ ...staleView, voided: { at: new Date() } } as never);

    await useCase.execute(input);

    expect(repository.voidIfActive).toHaveBeenCalledTimes(1);
    expect(recordOrThrow).toHaveBeenCalledTimes(1);
    const voidOrder = vi.mocked(repository.voidIfActive).mock.invocationCallOrder[0]!;
    const auditOrder = recordOrThrow.mock.invocationCallOrder[0]!;
    expect(voidOrder).toBeLessThan(auditOrder);
  });
});
