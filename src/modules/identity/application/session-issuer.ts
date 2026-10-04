import type { ClientInfo } from '#shared/application/client-info.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';
import type { TokenService } from '#shared/application/ports/token-service.js';
import type { UserAccount } from '../domain/user-account.js';
import type { RefreshTokenRepository } from './ports/refresh-token.repository.js';

export interface IssuedSession {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

export interface SessionSettings {
  readonly refreshTokenTtlMs: number;
  readonly maxSessionAgeMs: number;
}

interface Deps {
  tokenService: TokenService;
  refreshTokenRepository: RefreshTokenRepository;
  secureRandom: SecureRandom;
  idGenerator: IdGenerator;
  clock: Clock;
  sessionSettings: SessionSettings;
}

interface IssueOptions {
  readonly client: ClientInfo;
  readonly familyId?: string;
  readonly refreshTokenId?: string;
}

export class SessionIssuer {
  constructor(private readonly deps: Deps) {}

  async issue(account: UserAccount, options: IssueOptions): Promise<IssuedSession> {
    const { tokenService, refreshTokenRepository, secureRandom, idGenerator, clock } = this.deps;

    const access = await tokenService.signAccessToken({
      userId: account.id,
      role: account.role,
      companyId: account.companyId,
      tokenVersion: account.tokenVersion,
    });

    const refreshToken = secureRandom.token();
    const now = clock.now();
    const refreshTokenExpiresAt = new Date(
      now.getTime() + this.deps.sessionSettings.refreshTokenTtlMs,
    );
    await refreshTokenRepository.create({
      createdAt: now,
      id: options.refreshTokenId ?? idGenerator.generate(),
      userId: account.id,
      familyId: options.familyId ?? idGenerator.generate(),
      tokenHash: secureRandom.sha256(refreshToken),
      tokenVersion: account.tokenVersion,
      expiresAt: refreshTokenExpiresAt,
      client: options.client,
    });

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }
}
