import type { Actor } from '#shared/application/actor.js';
import type { Authenticator } from '#shared/application/ports/authenticator.js';
import type { TokenService } from '#shared/application/ports/token-service.js';
import { IdentityErrors } from './identity-errors.js';
import type { UserAccountRepository } from './ports/user-account.repository.js';

interface Deps {
  tokenService: TokenService;
  userAccountRepository: UserAccountRepository;
}

// Ademas de la firma valida en cada request usuario y empresa activos, tokenVersion, rol y empresa
export class TokenAuthenticator implements Authenticator {
  constructor(private readonly deps: Deps) {}

  async authenticate(accessToken: string): Promise<Actor> {
    const claims = await this.deps.tokenService.verifyAccessToken(accessToken);
    // Un admin multiempresa conserva la empresa del token solo si su membresia sigue vigente
    const account = await this.deps.userAccountRepository.findById(claims.userId, {
      activeCompanyId: claims.companyId,
    });

    if (
      !account ||
      account.tokenVersion !== claims.tokenVersion ||
      account.role !== claims.role ||
      account.companyId !== claims.companyId
    ) {
      throw IdentityErrors.sessionRevoked();
    }

    const denial = account.sessionDenial();
    if (denial) throw IdentityErrors.accessDenied(denial);

    return {
      userId: account.id,
      role: account.role,
      companyId: account.companyId,
      mustChangePassword: account.mustChangePassword,
    };
  }
}
