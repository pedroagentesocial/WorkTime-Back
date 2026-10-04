import { asClass, asFunction, asValue } from 'awilix';
import { SECURITY } from '#config/security.js';
import type { AppModule } from '#shared/composition/app-module.js';
import type { Cradle } from '#shared/composition/container.js';
import { ChangePasswordUseCase } from './application/change-password.use-case.js';
import { GetCurrentUserUseCase } from './application/get-current-user.use-case.js';
import { LoginUseCase } from './application/login.use-case.js';
import { LogoutUseCase } from './application/logout.use-case.js';
import { LogoutAllUseCase, UpdateProfileUseCase } from './application/profile.use-cases.js';
import type { RefreshTokenRepository } from './application/ports/refresh-token.repository.js';
import type { UserAccountRepository } from './application/ports/user-account.repository.js';
import { RefreshSessionUseCase } from './application/refresh-session.use-case.js';
import { SessionIssuer, type SessionSettings } from './application/session-issuer.js';
import { TokenAuthenticator } from './application/token-authenticator.js';
import { LoginLockoutPolicy } from './domain/login-lockout-policy.js';
import { PasswordPolicy } from './domain/password-policy.js';
import { PrismaRefreshTokenRepository } from './infrastructure/prisma-refresh-token.repository.js';
import { PrismaUserAccountRepository } from './infrastructure/prisma-user-account.repository.js';
import { authRoutes } from './presentation/auth.routes.js';

declare module '#shared/composition/container.js' {
  interface Cradle {
    loginLockoutPolicy: LoginLockoutPolicy;
    passwordPolicy: PasswordPolicy;
    sessionSettings: SessionSettings;
    userAccountRepository: UserAccountRepository;
    refreshTokenRepository: RefreshTokenRepository;
    sessionIssuer: SessionIssuer;
    login: LoginUseCase;
    refreshSession: RefreshSessionUseCase;
    logout: LogoutUseCase;
    getCurrentUser: GetCurrentUserUseCase;
    changePassword: ChangePasswordUseCase;
    updateProfile: UpdateProfileUseCase;
    logoutAll: LogoutAllUseCase;
  }
}

export const identityModule: AppModule = {
  name: 'identity',

  register(container) {
    container.register({
      loginLockoutPolicy: asValue(
        new LoginLockoutPolicy(
          SECURITY.login.maxFailedAttempts,
          SECURITY.login.lockoutMinutes * 60_000,
        ),
      ),
      passwordPolicy: asValue(
        new PasswordPolicy(SECURITY.password.minLength, SECURITY.password.maxLength),
      ),
      sessionSettings: asFunction(({ env }: Cradle): SessionSettings => ({
        refreshTokenTtlMs: env.refreshTokenTtlMs,
        maxSessionAgeMs: SECURITY.session.maxAgeDays * 86_400_000,
      })).singleton(),

      userAccountRepository: asClass(PrismaUserAccountRepository).singleton(),
      refreshTokenRepository: asClass(PrismaRefreshTokenRepository).singleton(),

      sessionIssuer: asClass(SessionIssuer).singleton(),
      login: asClass(LoginUseCase).singleton(),
      refreshSession: asClass(RefreshSessionUseCase).singleton(),
      logout: asClass(LogoutUseCase).singleton(),
      getCurrentUser: asClass(GetCurrentUserUseCase).singleton(),
      changePassword: asClass(ChangePasswordUseCase).singleton(),
      updateProfile: asClass(UpdateProfileUseCase).singleton(),
      logoutAll: asClass(LogoutAllUseCase).singleton(),

      authenticator: asClass(TokenAuthenticator).singleton(),
    });
  },

  routes: (container) => authRoutes(container.cradle),
};
