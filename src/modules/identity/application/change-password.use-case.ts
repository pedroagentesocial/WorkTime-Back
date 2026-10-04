import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { PasswordHasher } from '#shared/application/ports/password-hasher.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { LoginLockoutPolicy } from '../domain/login-lockout-policy.js';
import type { PasswordPolicy } from '../domain/password-policy.js';
import { IdentityErrors } from './identity-errors.js';
import type { RefreshTokenRepository } from './ports/refresh-token.repository.js';
import type { UserAccountRepository } from './ports/user-account.repository.js';
import type { IssuedSession, SessionIssuer } from './session-issuer.js';

export interface ChangePasswordInput {
  readonly actor: Actor;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly client: ClientInfo;
}

interface Deps {
  userAccountRepository: UserAccountRepository;
  refreshTokenRepository: RefreshTokenRepository;
  passwordHasher: PasswordHasher;
  passwordPolicy: PasswordPolicy;
  loginLockoutPolicy: LoginLockoutPolicy;
  sessionIssuer: SessionIssuer;
  securityEvents: SecurityEventRecorder;
  clock: Clock;
}

export class ChangePasswordUseCase implements UseCase<ChangePasswordInput, IssuedSession> {
  constructor(private readonly deps: Deps) {}

  async execute(input: ChangePasswordInput): Promise<IssuedSession> {
    const { userAccountRepository: users, passwordHasher, securityEvents } = this.deps;
    const now = this.deps.clock.now();

    const account = await users.findById(input.actor.userId);
    if (!account) throw IdentityErrors.sessionRevoked();
    if (account.isLocked(now)) throw IdentityErrors.accountLocked();
    if (account.loginDenial(now) === 'TEMPORARY_PASSWORD_EXPIRED') {
      throw IdentityErrors.accessDenied('TEMPORARY_PASSWORD_EXPIRED');
    }

    const audit = { userId: account.id, companyId: account.companyId, client: input.client };

    const attempts = await users.reserveLoginAttempt(account.id, now);
    if (attempts === null) throw IdentityErrors.accountLocked();
    if (this.deps.loginLockoutPolicy.exceeded(attempts)) {
      await users.lock(account.id, this.deps.loginLockoutPolicy.lockedUntil(now));
      throw IdentityErrors.accountLocked();
    }

    if (!(await passwordHasher.verify(account.passwordHash, input.currentPassword))) {
      if (this.deps.loginLockoutPolicy.shouldLock(attempts)) {
        await users.lock(account.id, this.deps.loginLockoutPolicy.lockedUntil(now));
      }
      await securityEvents.record({ ...audit, type: SecurityEventType.PASSWORD_CHANGE_FAILED });
      throw IdentityErrors.invalidCurrentPassword();
    }
    await users.clearFailedLoginAttempts(account.id);

    if (input.newPassword === input.currentPassword) throw IdentityErrors.passwordReused();
    this.deps.passwordPolicy.assertAcceptable(input.newPassword, { email: account.email });

    await users.changePassword(account.id, await passwordHasher.hash(input.newPassword), now);
    await this.deps.refreshTokenRepository.revokeAllForUser(account.id, now);
    await securityEvents.record({ ...audit, type: SecurityEventType.PASSWORD_CHANGED });

    const updated = await users.findById(account.id);
    if (!updated) throw IdentityErrors.sessionRevoked();
    return this.deps.sessionIssuer.issue(updated, { client: input.client });
  }
}
