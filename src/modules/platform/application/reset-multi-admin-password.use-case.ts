import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { TemporaryPasswordIssuer } from '#shared/application/temporary-password-issuer.js';
import type { UseCase } from '#shared/application/use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { MultiAdminRepository, MultiAdminView } from './ports/multi-admin.repository.js';

export interface ResetMultiAdminPasswordInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly multiAdminId: string;
}

export interface ResetMultiAdminPasswordOutput {
  readonly multiAdmin: MultiAdminView;
  readonly temporaryPassword: string;
  readonly temporaryPasswordExpiresAt: Date;
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  temporaryPasswords: TemporaryPasswordIssuer;
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
  }: ResetMultiAdminPasswordInput): Promise<ResetMultiAdminPasswordOutput> {
    const temporary = await this.deps.temporaryPasswords.issue();

    const multiAdmin = await this.deps.transactions.run(async () => {
      const reset = await this.deps.multiAdminRepository.resetPassword(multiAdminId, {
        passwordHash: temporary.passwordHash,
        expiresAt: temporary.expiresAt,
      });
      if (!reset) throw PlatformErrors.multiAdminNotFound();
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.TEMPORARY_PASSWORD_ISSUED,
        userId: actor.userId,
        client,
        metadata: { targetUserId: multiAdminId },
      });
      return reset;
    });

    return {
      multiAdmin,
      temporaryPassword: temporary.password,
      temporaryPasswordExpiresAt: temporary.expiresAt,
    };
  }
}
