import {
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from '#shared/domain/errors.js';
import type { AccessDenial } from '../domain/user-account.js';

export const IdentityErrors = {
  invalidCredentials: () =>
    new UnauthorizedError(
      'INVALID_CREDENTIALS',
      'Email o contraseña incorrectos. Tras varios intentos fallidos la cuenta se bloquea temporalmente.',
    ),

  accessDenied: (reason: AccessDenial) =>
    new ForbiddenError(reason, ACCESS_DENIAL_MESSAGES[reason]),

  invalidRefreshToken: () =>
    new UnauthorizedError(
      'INVALID_REFRESH_TOKEN',
      'La sesión no es válida; inicia sesión de nuevo',
    ),

  refreshTokenExpired: () =>
    new UnauthorizedError('REFRESH_TOKEN_EXPIRED', 'La sesión expiró; inicia sesión de nuevo'),

  sessionMaxAgeReached: () =>
    new UnauthorizedError(
      'SESSION_MAX_AGE_REACHED',
      'Por seguridad, la sesión alcanzó su duración máxima; inicia sesión de nuevo',
    ),

  sessionRevoked: () =>
    new UnauthorizedError('SESSION_REVOKED', 'La sesión ya no es válida; inicia sesión de nuevo'),

  invalidCurrentPassword: () =>
    new ValidationError('INVALID_CURRENT_PASSWORD', 'La contraseña actual no es correcta'),

  passwordReused: () =>
    new ValidationError('PASSWORD_REUSED', 'La nueva contraseña debe ser distinta a la actual'),

  accountLocked: () =>
    new TooManyRequestsError(
      'ACCOUNT_LOCKED',
      'Demasiados intentos fallidos; intenta de nuevo más tarde',
    ),
};

const ACCESS_DENIAL_MESSAGES: Readonly<Record<AccessDenial, string>> = {
  USER_INACTIVE: 'Tu usuario está desactivado; contacta a tu administrador',
  COMPANY_SUSPENDED: 'La cuenta de tu empresa está suspendida; contacta a soporte',
  TEMPORARY_PASSWORD_EXPIRED:
    'Tu contraseña temporal venció; pide a tu administrador que genere una nueva',
};
