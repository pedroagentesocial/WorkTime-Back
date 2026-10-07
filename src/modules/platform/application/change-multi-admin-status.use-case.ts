import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { MultiAdminRepository, MultiAdminView } from './ports/multi-admin.repository.js';

export interface ChangeMultiAdminStatusInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly multiAdminId: string;
  readonly status: 'active' | 'inactive';
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

// Desactivar cierra todas sus sesiones al instante; sus empresas y datos quedan intactos
export class ChangeMultiAdminStatusUseCase implements UseCase<
  ChangeMultiAdminStatusInput,
  MultiAdminView
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    multiAdminId,
    status,
  }: ChangeMultiAdminStatusInput): Promise<MultiAdminView> {
    const { multiAdminRepository: multiAdmins } = this.deps;

    const current = await multiAdmins.findById(multiAdminId);
    if (!current) throw PlatformErrors.multiAdminNotFound();
    if (current.status === status) return current;

    await this.deps.transactions.run(async () => {
      await multiAdmins.setStatus(multiAdminId, status);
      await this.deps.securityEvents.recordOrThrow({
        type:
          status === 'inactive'
            ? SecurityEventType.MULTI_ADMIN_DEACTIVATED
            : SecurityEventType.MULTI_ADMIN_REACTIVATED,
        userId: actor.userId,
        client,
        metadata: { targetUserId: multiAdminId },
      });
    });

    return { ...current, status };
  }
}
