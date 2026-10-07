import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import { Role } from '#shared/domain/permissions.js';
import { IdentityErrors } from './identity-errors.js';
import type {
  RefreshTokenRepository,
  StoredRefreshToken,
} from './ports/refresh-token.repository.js';
import type { UserAccountRepository } from './ports/user-account.repository.js';
import type { IssuedSession, SessionIssuer, SessionSettings } from './session-issuer.js';

export interface RefreshSessionInput {
  readonly refreshToken: string;
  readonly client: ClientInfo;
}

interface Deps {
  refreshTokenRepository: RefreshTokenRepository;
  userAccountRepository: UserAccountRepository;
  sessionIssuer: SessionIssuer;
  securityEvents: SecurityEventRecorder;
  secureRandom: SecureRandom;
  idGenerator: IdGenerator;
  clock: Clock;
  sessionSettings: SessionSettings;
}

// Rotacion: cada uso entrega un token nuevo y reusar uno viejo revoca toda la sesion
export class RefreshSessionUseCase implements UseCase<RefreshSessionInput, IssuedSession> {
  constructor(private readonly deps: Deps) {}

  async execute({ refreshToken, client }: RefreshSessionInput): Promise<IssuedSession> {
    const { refreshTokenRepository: tokens, userAccountRepository: users } = this.deps;
    const now = this.deps.clock.now();

    const stored = await tokens.findByHash(this.deps.secureRandom.sha256(refreshToken));
    if (!stored) throw IdentityErrors.invalidRefreshToken();

    if (stored.revokedAt !== null || stored.replacedById !== null) {
      await this.handleReuse(stored, now, client);
    }
    if (stored.expiresAt <= now) throw IdentityErrors.refreshTokenExpired();

    const startedAt = await tokens.familyStartedAt(stored.familyId);
    if (
      startedAt &&
      now.getTime() - startedAt.getTime() >= this.deps.sessionSettings.maxSessionAgeMs
    ) {
      await tokens.revokeFamily(stored.familyId, now);
      throw IdentityErrors.sessionMaxAgeReached();
    }

    const account = await users.findById(stored.userId, { activeCompanyId: stored.companyId });
    const denial = account?.loginDenial(now);
    if (!account || denial) {
      await tokens.revokeFamily(stored.familyId, now);
      throw denial ? IdentityErrors.accessDenied(denial) : IdentityErrors.invalidRefreshToken();
    }

    // Si le quitaron la empresa activa a un admin multiempresa, la sesion ya no sirve
    const lostCompany =
      account.role === Role.MULTI_COMPANY_ADMIN && account.companyId !== stored.companyId;
    if (stored.tokenVersion !== account.tokenVersion || lostCompany) {
      await tokens.revokeFamily(stored.familyId, now);
      throw IdentityErrors.invalidRefreshToken();
    }

    const nextId = this.deps.idGenerator.generate();
    const rotated = await tokens.markReplaced(stored.id, nextId, now);
    if (!rotated) {
      await this.handleReuse(stored, now, client);
    }

    return this.deps.sessionIssuer.issue(account, {
      client,
      familyId: stored.familyId,
      refreshTokenId: nextId,
    });
  }

  private async handleReuse(
    stored: StoredRefreshToken,
    now: Date,
    client: ClientInfo,
  ): Promise<never> {
    await this.deps.refreshTokenRepository.revokeFamily(stored.familyId, now);
    await this.deps.securityEvents.record({
      type: SecurityEventType.REFRESH_REUSE_DETECTED,
      userId: stored.userId,
      client,
      metadata: { familyId: stored.familyId },
    });
    throw IdentityErrors.invalidRefreshToken();
  }
}
