import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { PasswordHasher } from '#shared/application/ports/password-hasher.js';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { LoginLockoutPolicy } from '../domain/login-lockout-policy.js';
import type { UserAccount } from '../domain/user-account.js';
import { IdentityErrors } from './identity-errors.js';
import type { UserAccountRepository } from './ports/user-account.repository.js';
import type { IssuedSession, SessionIssuer } from './session-issuer.js';

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly client: ClientInfo;
}

export interface LoginOutput {
  readonly session: IssuedSession;
  readonly account: UserAccount;
}

const NO_USER_ID = '00000000-0000-0000-0000-000000000000';

interface Audit {
  readonly userId: string;
  readonly companyId: string | null;
  readonly client: ClientInfo;
}

interface Deps {
  userAccountRepository: UserAccountRepository;
  passwordHasher: PasswordHasher;
  sessionIssuer: SessionIssuer;
  loginLockoutPolicy: LoginLockoutPolicy;
  securityEvents: SecurityEventRecorder;
  secureRandom: SecureRandom;
  clock: Clock;
}

export class LoginUseCase implements UseCase<LoginInput, LoginOutput> {
  // Hash de relleno para que un email inexistente tarde lo mismo que uno real
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly deps: Deps) {}

  async execute({ email, password, client }: LoginInput): Promise<LoginOutput> {
    const { userAccountRepository: users, passwordHasher, securityEvents } = this.deps;
    const now = this.deps.clock.now();

    const account = await users.findByEmail(email.trim().toLowerCase());
    if (!account) {
      await users.reserveLoginAttempt(NO_USER_ID, now);
      await passwordHasher.verify(await this.getDummyHash(), password);
      await securityEvents.record({
        type: SecurityEventType.LOGIN_FAILED,
        client,
        metadata: { reason: 'unknown_email' },
      });
      throw IdentityErrors.invalidCredentials();
    }

    const audit = { userId: account.id, companyId: account.companyId, client };

    // Reserva atomica del intento antes de verificar: ni en paralelo se prueban de mas
    const attempt = await users.reserveLoginAttempt(account.id, now);
    const passwordMatches = await passwordHasher.verify(account.passwordHash, password);

    if (attempt === null || this.deps.loginLockoutPolicy.exceeded(attempt)) {
      if (attempt !== null) await this.lock(account, now, audit);
      await securityEvents.record({ ...audit, type: SecurityEventType.LOGIN_BLOCKED });
      throw IdentityErrors.invalidCredentials();
    }

    if (!passwordMatches) {
      await this.registerFailure(attempt, account, now, audit);
      throw IdentityErrors.invalidCredentials();
    }

    const denial = account.loginDenial(now);
    if (denial) {
      await users.clearFailedLoginAttempts(account.id);
      await securityEvents.record({
        ...audit,
        type: SecurityEventType.LOGIN_FAILED,
        metadata: { reason: denial },
      });
      throw IdentityErrors.accessDenied(denial);
    }

    if (passwordHasher.needsRehash(account.passwordHash)) {
      await users.updatePasswordHash(account.id, await passwordHasher.hash(password));
    }
    await users.recordSuccessfulLogin(account.id, now);

    const session = await this.deps.sessionIssuer.issue(account, { client });
    await securityEvents.record({ ...audit, type: SecurityEventType.LOGIN_SUCCEEDED });

    return { session, account };
  }

  private async registerFailure(
    attempts: number,
    account: UserAccount,
    now: Date,
    audit: Audit,
  ): Promise<void> {
    await this.deps.securityEvents.record({
      ...audit,
      type: SecurityEventType.LOGIN_FAILED,
      metadata: { reason: 'wrong_password', attempts },
    });
    if (this.deps.loginLockoutPolicy.shouldLock(attempts)) await this.lock(account, now, audit);
  }

  private async lock(account: UserAccount, now: Date, audit: Audit): Promise<void> {
    const { until, level } = this.deps.loginLockoutPolicy.nextLock(account, now);
    await this.deps.userAccountRepository.lock(account.id, until, level);
    await this.deps.securityEvents.record({
      ...audit,
      type: SecurityEventType.ACCOUNT_LOCKED,
      metadata: { until: until.toISOString() },
    });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.deps.passwordHasher.hash(this.deps.secureRandom.token(16));
    return this.dummyHash;
  }
}
