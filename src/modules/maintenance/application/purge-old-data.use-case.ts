import type { Clock } from '#shared/application/ports/clock.js';
import { SecurityEventType } from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { DataRetentionRepository } from './ports/data-retention.repository.js';

export interface RetentionPolicy {
  readonly sessionMaxAgeDays: number;
  readonly refreshTokenGraceDays: number;
  readonly securityEventDays: number;
  readonly batchSize: number;
  readonly maxBatchesPerRun: number;
}

// Auditoria de las horas y de los sueldos: se conserva siempre
export const KEPT_FOREVER_EVENT_TYPES: readonly string[] = [
  SecurityEventType.TIME_ENTRY_CLOCKED_IN_BY_ADMIN,
  SecurityEventType.TIME_ENTRY_CLOCKED_OUT_BY_ADMIN,
  SecurityEventType.TIME_ENTRY_CREATED_BY_ADMIN,
  SecurityEventType.TIME_ENTRY_CORRECTED_BY_ADMIN,
  SecurityEventType.TIME_ENTRY_CORRECTED_BY_EMPLOYEE,
  SecurityEventType.TIME_ENTRY_VOIDED_BY_ADMIN,
  SecurityEventType.CHECK_IN_VOIDED_BY_ADMIN,
  SecurityEventType.PAY_PERIOD_CLOSED,
  SecurityEventType.EMPLOYEE_PAY_RATE_CHANGED,
  SecurityEventType.EMPLOYEE_PAY_RATE_REMOVED,
  // Cambian lo que se paga: altas y bajas con su dia, limites, permisos de correccion y moneda
  SecurityEventType.EMPLOYEE_DEACTIVATED,
  SecurityEventType.EMPLOYEE_REACTIVATED,
  SecurityEventType.EMPLOYEE_UPDATED,
  SecurityEventType.COMPANY_SETTINGS_UPDATED,
];

export interface PurgeResult {
  readonly refreshTokens: number;
  readonly securityEvents: number;
}

interface Deps {
  dataRetentionRepository: DataRetentionRepository;
  retentionPolicy: RetentionPolicy;
  clock: Clock;
}

const DAY_MS = 86_400_000;

// Idempotente: puede correr en varias instancias y si se corta la siguiente ejecucion continua
export class PurgeOldDataUseCase implements UseCase<void, PurgeResult> {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<PurgeResult> {
    const { dataRetentionRepository: repository, retentionPolicy: policy } = this.deps;
    const now = this.deps.clock.now().getTime();

    const sessionCutoff = new Date(
      now - (policy.sessionMaxAgeDays + policy.refreshTokenGraceDays) * DAY_MS,
    );
    const eventCutoff = new Date(now - policy.securityEventDays * DAY_MS);

    const refreshTokens = await this.inBatches(policy, (size) =>
      repository.deleteSessionsStartedBefore(sessionCutoff, size),
    );
    const securityEvents = await this.inBatches(policy, (size) =>
      repository.deleteSecurityEventsBefore(eventCutoff, KEPT_FOREVER_EVENT_TYPES, size),
    );
    return { refreshTokens, securityEvents };
  }

  private async inBatches(
    policy: RetentionPolicy,
    deleteBatch: (size: number) => Promise<number>,
  ): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < policy.maxBatchesPerRun; batch += 1) {
      const deleted = await deleteBatch(policy.batchSize);
      if (deleted === 0) break;
      total += deleted;
    }
    return total;
  }
}
