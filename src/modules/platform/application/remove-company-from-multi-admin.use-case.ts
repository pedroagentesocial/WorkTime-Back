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

export interface RemoveCompanyInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly multiAdminId: string;
  readonly companyId: string;
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

// Quita el acceso de inmediato: las sesiones que trabajaban en esa empresa dejan de servir
export class RemoveCompanyFromMultiAdminUseCase implements UseCase<
  RemoveCompanyInput,
  MultiAdminView
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    multiAdminId,
    companyId,
  }: RemoveCompanyInput): Promise<MultiAdminView> {
    const { multiAdminRepository: multiAdmins } = this.deps;

    await this.deps.transactions.run(async () => {
      if (!(await multiAdmins.lockLimits(multiAdminId))) throw PlatformErrors.multiAdminNotFound();
      if (!(await multiAdmins.removeMembership(multiAdminId, companyId))) {
        throw PlatformErrors.membershipNotFound();
      }
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.MULTI_ADMIN_COMPANY_REMOVED,
        userId: actor.userId,
        companyId,
        client,
        metadata: { targetUserId: multiAdminId },
      });
    });

    const updated = await multiAdmins.findById(multiAdminId);
    if (!updated) throw PlatformErrors.multiAdminNotFound();
    return updated;
  }
}
