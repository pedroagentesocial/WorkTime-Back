import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { EmailSender } from '#shared/application/ports/email-sender.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { Logger } from '#shared/application/ports/logger.js';
import type { PasswordHasher } from '#shared/application/ports/password-hasher.js';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { Role } from '#shared/domain/permissions.js';
import type { PasswordPolicy } from '../domain/password-policy.js';
import type { UserAccount } from '../domain/user-account.js';
import { IdentityErrors } from './identity-errors.js';
import type { PasswordResetRepository } from './ports/password-reset.repository.js';
import type { RefreshTokenRepository } from './ports/refresh-token.repository.js';
import type { UserAccountRepository } from './ports/user-account.repository.js';
import { passwordResetEmail } from './password-reset-email.js';

export interface PasswordResetSettings {
  // Direccion del front para el enlace; null si no hay correos configurados
  readonly appUrl: string | null;
  readonly ttlMs: number;
  readonly cooldownMs: number;
}

// El admin global solo se recupera desde la terminal del servidor; las cuentas sin acceso tampoco
function canReset(account: UserAccount | null): account is UserAccount {
  return account !== null && account.role !== Role.PLATFORM_ADMIN && !account.sessionDenial();
}

export interface RequestPasswordResetInput {
  readonly email: string;
  readonly client: ClientInfo;
}

interface RequestDeps {
  userAccountRepository: UserAccountRepository;
  passwordResetRepository: PasswordResetRepository;
  passwordResetSettings: PasswordResetSettings;
  emailSender: EmailSender;
  secureRandom: SecureRandom;
  idGenerator: IdGenerator;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
  clock: Clock;
  logger: Logger;
}

// Responde igual exista o no la cuenta: no revela que correos estan registrados
export class RequestPasswordResetUseCase implements UseCase<RequestPasswordResetInput, void> {
  constructor(private readonly deps: RequestDeps) {}

  async execute({ email, client }: RequestPasswordResetInput): Promise<void> {
    const { passwordResetRepository: resets, passwordResetSettings: settings } = this.deps;
    const account = await this.deps.userAccountRepository.findByEmail(email.trim().toLowerCase());
    if (!canReset(account)) return;
    if (settings.appUrl === null) {
      this.deps.logger.warn({ userId: account.id }, 'Recuperación pedida sin correos configurados');
      return;
    }

    const now = this.deps.clock.now();
    const last = await resets.latestCreatedAt(account.id);
    if (last && now.getTime() - last.getTime() < settings.cooldownMs) return;

    const token = this.deps.secureRandom.token();
    const expiresAt = new Date(now.getTime() + settings.ttlMs);
    await this.deps.transactions.run(async () => {
      await resets.replaceForUser({
        id: this.deps.idGenerator.generate(),
        userId: account.id,
        tokenHash: this.deps.secureRandom.sha256(token),
        expiresAt,
        createdAt: now,
        ip: client.ip ?? null,
      });
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.PASSWORD_RESET_REQUESTED,
        userId: account.id,
        companyId: account.companyId,
        client,
      });
    });

    // No se espera al proveedor: la respuesta tarda lo mismo exista o no la cuenta
    const link = `${settings.appUrl}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
    this.deps.emailSender
      .send(
        passwordResetEmail({
          to: account.email,
          firstName: account.firstName,
          link,
          ttlMinutes: Math.round(settings.ttlMs / 60_000),
        }),
      )
      .catch((error: unknown) => {
        this.deps.logger.error(
          { userId: account.id, error: error instanceof Error ? error.message : String(error) },
          'No se pudo enviar el correo de recuperación',
        );
      });
  }
}

export interface ConfirmPasswordResetInput {
  readonly token: string;
  readonly newPassword: string;
  readonly client: ClientInfo;
}

interface ConfirmDeps {
  userAccountRepository: UserAccountRepository;
  passwordResetRepository: PasswordResetRepository;
  refreshTokenRepository: RefreshTokenRepository;
  passwordHasher: PasswordHasher;
  passwordPolicy: PasswordPolicy;
  secureRandom: SecureRandom;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
  clock: Clock;
}

// Pone la contrasena nueva con el enlace del correo; cierra todas las sesiones y quita el bloqueo
export class ConfirmPasswordResetUseCase implements UseCase<ConfirmPasswordResetInput, void> {
  constructor(private readonly deps: ConfirmDeps) {}

  async execute({ token, newPassword, client }: ConfirmPasswordResetInput): Promise<void> {
    const { passwordResetRepository: resets, userAccountRepository: users } = this.deps;
    const now = this.deps.clock.now();
    const stored = await resets.findByHash(this.deps.secureRandom.sha256(token));
    if (!stored || stored.usedAt !== null || stored.expiresAt <= now) {
      throw IdentityErrors.invalidResetToken();
    }
    const account = await users.findById(stored.userId);
    if (!canReset(account)) throw IdentityErrors.invalidResetToken();

    this.deps.passwordPolicy.assertAcceptable(newPassword, { email: account.email });
    const passwordHash = await this.deps.passwordHasher.hash(newPassword);

    await this.deps.transactions.run(async () => {
      if (!(await resets.markUsed(stored.id, now))) throw IdentityErrors.invalidResetToken();
      await users.changePassword(account.id, passwordHash, now);
      await this.deps.refreshTokenRepository.revokeAllForUser(account.id, now);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.PASSWORD_RESET_COMPLETED,
        userId: account.id,
        companyId: account.companyId,
        client,
      });
    });
  }
}
