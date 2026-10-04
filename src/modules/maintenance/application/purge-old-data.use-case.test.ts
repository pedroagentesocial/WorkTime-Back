import { describe, expect, it, vi } from 'vitest';
import type { DataRetentionRepository } from './ports/data-retention.repository.js';
import {
  KEPT_FOREVER_EVENT_TYPES,
  PurgeOldDataUseCase,
  type RetentionPolicy,
} from './purge-old-data.use-case.js';

const NOW = new Date('2026-10-07T12:00:00Z');
const DAY_MS = 86_400_000;

const policy: RetentionPolicy = {
  sessionMaxAgeDays: 30,
  refreshTokenGraceDays: 7,
  securityEventDays: 365,
  batchSize: 10,
  maxBatchesPerRun: 5,
};

function build(tokens: number[], events: number[], overrides: Partial<RetentionPolicy> = {}) {
  const repository = {
    deleteSessionsStartedBefore: vi.fn(async () => tokens.shift() ?? 0),
    deleteSecurityEventsBefore: vi.fn(async () => events.shift() ?? 0),
  } satisfies DataRetentionRepository;
  const useCase = new PurgeOldDataUseCase({
    dataRetentionRepository: repository,
    retentionPolicy: { ...policy, ...overrides },
    clock: { now: () => NOW },
  });
  return { repository, useCase };
}

describe('PurgeOldDataUseCase', () => {
  it('calcula las fechas de corte: sesión máxima más margen, y un año de eventos', async () => {
    const { repository, useCase } = build([], []);
    await useCase.execute();

    expect(repository.deleteSessionsStartedBefore).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 37 * DAY_MS),
      10,
    );
    expect(repository.deleteSecurityEventsBefore).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 365 * DAY_MS),
      KEPT_FOREVER_EVENT_TYPES,
      10,
    );
  });

  it('repite por lotes hasta que no queda nada y suma lo borrado', async () => {
    const { repository, useCase } = build([10, 10, 3], [7]);
    const result = await useCase.execute();

    expect(result).toEqual({ refreshTokens: 23, securityEvents: 7 });
    expect(repository.deleteSessionsStartedBefore).toHaveBeenCalledTimes(4);
    expect(repository.deleteSecurityEventsBefore).toHaveBeenCalledTimes(2);
  });

  it('no pasa del tope de lotes por ejecución; la siguiente termina el trabajo', async () => {
    const { repository, useCase } = build([10, 10, 10, 10, 10, 10, 10], [], {
      maxBatchesPerRun: 3,
    });
    const result = await useCase.execute();

    expect(result.refreshTokens).toBe(30);
    expect(repository.deleteSessionsStartedBefore).toHaveBeenCalledTimes(3);
  });

  it('la auditoría de las horas se conserva siempre', () => {
    expect(KEPT_FOREVER_EVENT_TYPES).toContain('time_entry.voided_by_admin');
    expect(KEPT_FOREVER_EVENT_TYPES).toContain('pay_period.closed');
    expect(KEPT_FOREVER_EVENT_TYPES).not.toContain('login.succeeded');
  });
});
