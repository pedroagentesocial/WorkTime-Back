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
  PlatformAdminView,
} from './ports/platform-admin.repository.js';

export interface RecoverPlatformAdminOutput {
  readonly admin: PlatformAdminView;
  readonly temporaryPassword: string;
  readonly temporaryPasswordExpiresAt: Date;
}

interface Deps {
  platformAdminRepository: PlatformAdminRepository;
  temporaryPasswords: TemporaryPasswordIssuer;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

// Rescate del admin global desde la consola del servidor: no hay nadie por encima de el que pueda
// restablecerlo, asi que la autoridad es tener acceso al servidor y a la BD. No tiene ruta HTTP
export class RecoverPlatformAdminUseCase implements UseCase<void, RecoverPlatformAdminOutput> {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<RecoverPlatformAdminOutput> {
    const temporary = await this.deps.temporaryPasswords.issue();

    const admin = await this.deps.transactions.run(async () => {
      const admins = await this.deps.platformAdminRepository.listAll();
      if (admins.length > 1) throw PlatformErrors.platformAdminAmbiguous();
      const [admin] = admins;
      if (!admin) throw PlatformErrors.platformAdminNotFound();

      await this.deps.platformAdminRepository.recover(admin.id, {
        passwordHash: temporary.passwordHash,
        expiresAt: temporary.expiresAt,
      });
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.PLATFORM_ADMIN_RECOVERED,
        userId: admin.id,
        metadata: { channel: 'cli' },
      });
      return admin;
    });

    return {
      admin,
      temporaryPassword: temporary.password,
      temporaryPasswordExpiresAt: temporary.expiresAt,
    };
  }
}
