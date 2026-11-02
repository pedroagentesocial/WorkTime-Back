import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { UserAccount } from '../domain/user-account.js';
import { IdentityErrors } from './identity-errors.js';
import type { RefreshTokenRepository } from './ports/refresh-token.repository.js';
import type { UserAccountRepository } from './ports/user-account.repository.js';
import type { IssuedSession, SessionIssuer, SessionSettings } from './session-issuer.js';

export interface SwitchActiveCompanyInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  // null deja la sesion sin empresa, para las vistas que reunen todas las suyas
  readonly companyId: string | null;
  // El de la sesion actual: la nueva sigue en la misma familia y conserva su duracion maxima
  readonly refreshToken: string;
}

export interface SwitchActiveCompanyOutput {
  readonly session: IssuedSession;
  readonly account: UserAccount;
}

interface Deps {
  userAccountRepository: UserAccountRepository;
  refreshTokenRepository: RefreshTokenRepository;
  sessionIssuer: SessionIssuer;
  securityEvents: SecurityEventRecorder;
  secureRandom: SecureRandom;
  idGenerator: IdGenerator;
  clock: Clock;
  sessionSettings: SessionSettings;
}

// Un admin multiempresa trabaja en una empresa a la vez: elegirla rota la sesion actual hacia esa sola empresa
export class SwitchActiveCompanyUseCase implements UseCase<
  SwitchActiveCompanyInput,
  SwitchActiveCompanyOutput
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    companyId,
    refreshToken,
  }: SwitchActiveCompanyInput): Promise<SwitchActiveCompanyOutput> {
    const { refreshTokenRepository: tokens } = this.deps;
    const now = this.deps.clock.now();
    // Sin esto un access token robado bastaria para abrir sesiones nuevas sin fin
    const stored = await tokens.findByHash(this.deps.secureRandom.sha256(refreshToken));
    if (
      !stored ||
      stored.userId !== actor.userId ||
      stored.revokedAt !== null ||
      stored.replacedById !== null ||
      stored.expiresAt <= now
    ) {
      throw IdentityErrors.invalidRefreshToken();
    }
    const startedAt = await tokens.familyStartedAt(stored.familyId);
    if (
      startedAt &&
      now.getTime() - startedAt.getTime() >= this.deps.sessionSettings.maxSessionAgeMs
    ) {
      await tokens.revokeFamily(stored.familyId, now);
      throw IdentityErrors.sessionMaxAgeReached();
    }

    const account = await this.deps.userAccountRepository.findById(actor.userId, {
      activeCompanyId: companyId,
    });
    if (!account) throw IdentityErrors.sessionRevoked();

    // La cuenta solo trae la empresa si la membresia existe; una ajena responde igual que una inexistente
    if (companyId !== null && account.companyId !== companyId) {
      throw IdentityErrors.companyNotAssigned();
    }
    const denial = account.sessionDenial();
    if (denial) throw IdentityErrors.accessDenied(denial);

    const nextId = this.deps.idGenerator.generate();
    if (!(await tokens.markReplaced(stored.id, nextId, now))) {
      throw IdentityErrors.invalidRefreshToken();
    }
    const session = await this.deps.sessionIssuer.issue(account, {
      client,
      familyId: stored.familyId,
      refreshTokenId: nextId,
    });
    await this.deps.securityEvents.record({
      type: SecurityEventType.ACTIVE_COMPANY_CHANGED,
      userId: actor.userId,
      companyId,
      client,
      metadata: { previousCompanyId: actor.companyId },
    });
    return { session, account };
  }
}
