import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { UserAccount } from '../domain/user-account.js';
import { IdentityErrors } from './identity-errors.js';
import type { UserAccountRepository } from './ports/user-account.repository.js';
import type { IssuedSession, SessionIssuer } from './session-issuer.js';

export interface SwitchActiveCompanyInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  // null deja la sesion sin empresa, para las vistas que reunen todas las suyas
  readonly companyId: string | null;
}

export interface SwitchActiveCompanyOutput {
  readonly session: IssuedSession;
  readonly account: UserAccount;
}

interface Deps {
  userAccountRepository: UserAccountRepository;
  sessionIssuer: SessionIssuer;
  securityEvents: SecurityEventRecorder;
}

// Un admin multiempresa trabaja en una empresa a la vez: elegirla emite una sesion nueva con esa sola empresa
export class SwitchActiveCompanyUseCase implements UseCase<
  SwitchActiveCompanyInput,
  SwitchActiveCompanyOutput
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    companyId,
  }: SwitchActiveCompanyInput): Promise<SwitchActiveCompanyOutput> {
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

    const session = await this.deps.sessionIssuer.issue(account, { client });
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
