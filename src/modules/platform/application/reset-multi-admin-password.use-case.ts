import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type {
  AccessDelivery,
  AccessResult,
  AccountAccess,
} from '#shared/application/account-access.js';
import type { UseCase } from '#shared/application/use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { MultiAdminRepository, MultiAdminView } from './ports/multi-admin.repository.js';

export interface ResetMultiAdminPasswordInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly multiAdminId: string;
  readonly delivery?: AccessDelivery | undefined;
}

export interface ResetMultiAdminPasswordOutput {
  readonly multiAdmin: MultiAdminView;
  readonly access: AccessResult;
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  accountAccess: AccountAccess;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

export class ResetMultiAdminPasswordUseCase implements UseCase<
  ResetMultiAdminPasswordInput,
  ResetMultiAdminPasswordOutput
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    multiAdminId,
    delivery,
  }: ResetMultiAdminPasswordInput): Promise<ResetMultiAdminPasswordOutput> {
    const current = await this.deps.multiAdminRepository.findById(multiAdminId);
    if (!current) throw PlatformErrors.multiAdminNotFound();
    const access = await this.deps.accountAccess.prepare(current.email, delivery);

    const multiAdmin = await this.deps.transactions.run(async () => {
      const reset = await this.deps.multiAdminRepository.resetPassword(multiAdminId, {
        passwordHash: access.passwordHash,
        expiresAt: access.expiresAt,
      });
      if (!reset) throw PlatformErrors.multiAdminNotFound();
      await this.deps.accountAccess.saveLink(multiAdminId, access);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.TEMPORARY_PASSWORD_ISSUED,
        userId: actor.userId,
        client,
        metadata: { targetUserId: multiAdminId, delivery: access.delivery },
      });
      return reset;
    });

    return {
      multiAdmin,
      access: await this.deps.accountAccess.deliver(multiAdmin, access, 'reset'),
    };
  }
}
