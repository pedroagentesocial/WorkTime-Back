import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { TemporaryPasswordIssuer } from '#shared/application/temporary-password-issuer.js';
import type { UseCase } from '#shared/application/use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type {
  PlatformAdminRepository,
  PlatformAdminSummary,
} from './ports/platform-admin.repository.js';

export interface RecoverPlatformAdminOutput {
  readonly admin: PlatformAdminSummary;
  readonly temporaryPassword: string;
  readonly temporaryPasswordExpiresAt: Date;
}

interface Deps {
  platformAdminRepository: PlatformAdminRepository;
  temporaryPasswords: TemporaryPasswordIssuer;
  securityEvents: SecurityEventRecorder;
  transactions: TransactionRunner;
}

// Solo se usa desde la terminal del servidor: quien la corre ya tiene acceso a la maquina y al .env
export class RecoverPlatformAdminUseCase implements UseCase<void, RecoverPlatformAdminOutput> {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<RecoverPlatformAdminOutput> {
    const temporary = await this.deps.temporaryPasswords.issue();

    const admin = await this.deps.transactions.run(async () => {
      const recovered = await this.deps.platformAdminRepository.recoverAccess({
        passwordHash: temporary.passwordHash,
        expiresAt: temporary.expiresAt,
      });
      if (!recovered) throw PlatformErrors.platformAdminNotFound();
      // Si no queda constancia no se cambia la contrasena
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.PLATFORM_ADMIN_RECOVERED,
        userId: recovered.id,
        metadata: { source: 'cli' },
      });
      return recovered;
    });

    return {
      admin,
      temporaryPassword: temporary.password,
      temporaryPasswordExpiresAt: temporary.expiresAt,
    };
  }
}
