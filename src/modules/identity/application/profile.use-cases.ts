import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import { toProfile, type CurrentUserProfile } from './get-current-user.use-case.js';
import { IdentityErrors } from './identity-errors.js';
import type { RefreshTokenRepository } from './ports/refresh-token.repository.js';
import type { UserAccountRepository } from './ports/user-account.repository.js';

export interface UpdateProfileInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly firstName: string;
  readonly lastName: string;
}

interface Deps {
  userAccountRepository: UserAccountRepository;
  refreshTokenRepository: RefreshTokenRepository;
  securityEvents: SecurityEventRecorder;
  clock: Clock;
}

export class UpdateProfileUseCase implements UseCase<UpdateProfileInput, CurrentUserProfile> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    firstName,
    lastName,
  }: UpdateProfileInput): Promise<CurrentUserProfile> {
    const { userAccountRepository: users } = this.deps;
    const current = await users.findById(actor.userId);
    if (!current) throw IdentityErrors.sessionRevoked();

    await users.updateName(actor.userId, firstName, lastName);
    await this.deps.securityEvents.record({
      type: SecurityEventType.PROFILE_UPDATED,
      userId: actor.userId,
      companyId: actor.companyId,
      client,
      metadata: { previousFirstName: current.firstName, previousLastName: current.lastName },
    });

    const updated = await users.findById(actor.userId);
    if (!updated) throw IdentityErrors.sessionRevoked();
    return toProfile(updated);
  }
}

export interface LogoutAllInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
}

export class LogoutAllUseCase implements UseCase<LogoutAllInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, client }: LogoutAllInput): Promise<void> {
    await this.deps.userAccountRepository.revokeSessions(actor.userId);
    await this.deps.refreshTokenRepository.revokeAllForUser(actor.userId, this.deps.clock.now());
    await this.deps.securityEvents.record({
      type: SecurityEventType.SESSIONS_REVOKED,
      userId: actor.userId,
      companyId: actor.companyId,
      client,
    });
  }
}
