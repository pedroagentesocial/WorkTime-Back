import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { RefreshTokenRepository } from './ports/refresh-token.repository.js';

export interface LogoutInput {
  readonly refreshToken: string;
  readonly client: ClientInfo;
}

interface Deps {
  refreshTokenRepository: RefreshTokenRepository;
  securityEvents: SecurityEventRecorder;
  secureRandom: SecureRandom;
  clock: Clock;
}

export class LogoutUseCase implements UseCase<LogoutInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute({ refreshToken, client }: LogoutInput): Promise<void> {
    const { refreshTokenRepository: tokens, secureRandom, clock } = this.deps;

    const stored = await tokens.findByHash(secureRandom.sha256(refreshToken));
    if (!stored || stored.revokedAt !== null) return;

    await tokens.revokeFamily(stored.familyId, clock.now());
    await this.deps.securityEvents.record({
      type: SecurityEventType.LOGOUT,
      userId: stored.userId,
      client,
    });
  }
}
