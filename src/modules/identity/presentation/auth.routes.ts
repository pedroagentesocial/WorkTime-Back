import { Permission } from '#shared/domain/permissions.js';
import { defineRoute, noContent, ok, type AnyRoute } from '#shared/http/route.js';
import { dataResponse } from '#shared/http/schemas.js';
import type { ChangePasswordUseCase } from '../application/change-password.use-case.js';
import { toProfile, type GetCurrentUserUseCase } from '../application/get-current-user.use-case.js';
import type { LoginUseCase } from '../application/login.use-case.js';
import type { LogoutAllUseCase, UpdateProfileUseCase } from '../application/profile.use-cases.js';
import type { LogoutUseCase } from '../application/logout.use-case.js';
import type { RefreshSessionUseCase } from '../application/refresh-session.use-case.js';
import type {
  ConfirmPasswordResetUseCase,
  RequestPasswordResetUseCase,
} from '../application/password-reset.use-cases.js';
import type { SwitchActiveCompanyUseCase } from '../application/switch-active-company.use-case.js';
import {
  changePasswordBody,
  confirmPasswordResetBody,
  loginBody,
  loginResponseSchema,
  profileSchema,
  refreshBody,
  requestPasswordResetBody,
  updateProfileBody,
  sessionSchema,
  switchCompanyBody,
  toSessionDto,
} from './auth.schemas.js';

interface Deps {
  login: LoginUseCase;
  refreshSession: RefreshSessionUseCase;
  logout: LogoutUseCase;
  getCurrentUser: GetCurrentUserUseCase;
  changePassword: ChangePasswordUseCase;
  updateProfile: UpdateProfileUseCase;
  logoutAll: LogoutAllUseCase;
  switchActiveCompany: SwitchActiveCompanyUseCase;
  requestPasswordReset: RequestPasswordResetUseCase;
  confirmPasswordReset: ConfirmPasswordResetUseCase;
}

const TAGS = ['Autenticación'];

export function authRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'post',
      path: '/auth/login',
      summary: 'Iniciar sesión',
      description:
        'Devuelve un access token (vida corta) y un refresh token. Si `user.mustChangePassword` ' +
        'es true, solo se permite consultar el perfil y cambiar la contraseña.',
      tags: TAGS,
      auth: 'public',
      rateLimit: ['login', 'loginIp'],
      request: { body: loginBody },
      responses: {
        200: { description: 'Sesión iniciada', schema: dataResponse(loginResponseSchema) },
        401: {
          description: 'Email o contraseña incorrectos (o cuenta bloqueada temporalmente)',
          errorCodes: ['INVALID_CREDENTIALS'],
        },
        403: {
          description: 'Credenciales correctas pero sin acceso',
          errorCodes: ['USER_INACTIVE', 'COMPANY_SUSPENDED', 'TEMPORARY_PASSWORD_EXPIRED'],
        },
      },
      handler: async ({ body, request }) => {
        const { session, account } = await deps.login.execute({ ...body, client: request });
        return ok({ ...toSessionDto(session), user: toProfile(account) });
      },
    }),

    defineRoute({
      method: 'post',
      path: '/auth/refresh',
      summary: 'Renovar la sesión',
      description:
        'Cambia un refresh token por un par nuevo. El refresh token usado queda anulado; ' +
        'si se vuelve a presentar, se cierra toda la sesión por seguridad.',
      tags: TAGS,
      auth: 'public',
      rateLimit: 'refresh',
      request: { body: refreshBody },
      responses: {
        200: { description: 'Sesión renovada', schema: dataResponse(sessionSchema) },
        401: {
          description: 'Refresh token inválido, ya usado o vencido',
          errorCodes: ['INVALID_REFRESH_TOKEN', 'REFRESH_TOKEN_EXPIRED', 'SESSION_MAX_AGE_REACHED'],
        },
        403: {
          description: 'El usuario o su empresa ya no tienen acceso',
          errorCodes: ['USER_INACTIVE', 'COMPANY_SUSPENDED'],
        },
      },
      handler: async ({ body, request }) =>
        ok(toSessionDto(await deps.refreshSession.execute({ ...body, client: request }))),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/logout',
      summary: 'Cerrar sesión',
      description: 'Anula el refresh token y su sesión. Siempre responde 204.',
      tags: TAGS,
      auth: 'public',
      rateLimit: 'sensitive',
      request: { body: refreshBody },
      responses: { 204: { description: 'Sesión cerrada' } },
      handler: async ({ body, request }) => {
        await deps.logout.execute({ ...body, client: request });
        return noContent();
      },
    }),

    defineRoute({
      method: 'get',
      path: '/auth/me',
      summary: 'Perfil del usuario autenticado',
      tags: TAGS,
      auth: 'authenticated',
      allowWhenPasswordChangeRequired: true,
      responses: { 200: { description: 'Perfil', schema: dataResponse(profileSchema) } },
      handler: async ({ actor }) => ok(await deps.getCurrentUser.execute(actor)),
    }),

    defineRoute({
      method: 'patch',
      path: '/auth/me',
      summary: 'Cambiar mi nombre',
      description: 'Solo nombre y apellido. El email es la identidad de acceso y no se edita aquí.',
      tags: TAGS,
      auth: 'authenticated',
      request: { body: updateProfileBody },
      responses: {
        200: { description: 'Perfil actualizado', schema: dataResponse(profileSchema) },
      },
      handler: async ({ actor, body, request }) =>
        ok(await deps.updateProfile.execute({ actor, client: request, ...body })),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/active-company',
      summary: 'Elegir la empresa con la que trabajo',
      description:
        'Solo para el admin multiempresa. Cambia el refresh token de la sesión actual por un par ' +
        'nuevo cuya empresa activa es la elegida; desde ahí se trabaja como admin de esa empresa. ' +
        'Con `companyId: null` la sesión queda sin empresa activa. El refresh token enviado queda ' +
        'anulado y la sesión conserva su duración máxima de 30 días.',
      tags: TAGS,
      auth: Permission.PORTFOLIO_READ,
      rateLimit: 'sensitive',
      request: { body: switchCompanyBody },
      responses: {
        200: { description: 'Sesión nueva', schema: dataResponse(loginResponseSchema) },
        401: {
          description:
            'El refresh token no es de esta sesión, ya se usó o la sesión llegó a su máximo',
          errorCodes: ['INVALID_REFRESH_TOKEN', 'SESSION_MAX_AGE_REACHED'],
        },
        403: {
          description: 'La empresa está suspendida',
          errorCodes: ['COMPANY_SUSPENDED'],
        },
        404: {
          description: 'La empresa no existe o no está asignada a la cuenta',
          errorCodes: ['COMPANY_NOT_FOUND'],
        },
      },
      handler: async ({ actor, body, request }) => {
        const { session, account } = await deps.switchActiveCompany.execute({
          actor,
          client: request,
          companyId: body.companyId,
          refreshToken: body.refreshToken,
        });
        return ok({ ...toSessionDto(session), user: toProfile(account) });
      },
    }),

    defineRoute({
      method: 'post',
      path: '/auth/me/logout-all',
      summary: 'Cerrar todas mis sesiones',
      description:
        'Cierra todas las sesiones del usuario, también la actual y de inmediato (los access ' +
        'tokens dejan de servir). Hay que iniciar sesión de nuevo.',
      tags: TAGS,
      auth: 'authenticated',
      allowWhenPasswordChangeRequired: true,
      rateLimit: 'sensitive',
      responses: { 204: { description: 'Sesiones cerradas' } },
      handler: async ({ actor, request }) => {
        await deps.logoutAll.execute({ actor, client: request });
        return noContent();
      },
    }),

    defineRoute({
      method: 'patch',
      path: '/auth/me/password',
      summary: 'Cambiar mi contraseña',
      description:
        'Cierra todas las sesiones abiertas del usuario y devuelve una sesión nueva. ' +
        'Es obligatorio cuando la contraseña es temporal.',
      tags: TAGS,
      auth: 'authenticated',
      allowWhenPasswordChangeRequired: true,
      rateLimit: 'sensitive',
      request: { body: changePasswordBody },
      responses: {
        200: { description: 'Contraseña cambiada', schema: dataResponse(sessionSchema) },
        400: {
          description: 'No se pudo cambiar la contraseña',
          errorCodes: ['INVALID_CURRENT_PASSWORD', 'PASSWORD_REUSED', 'WEAK_PASSWORD'],
        },
        429: {
          description: 'Demasiados intentos fallidos',
          errorCodes: ['ACCOUNT_LOCKED'],
        },
      },
      handler: async ({ actor, body, request }) =>
        ok(toSessionDto(await deps.changePassword.execute({ actor, ...body, client: request }))),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/password-reset',
      summary: 'Pedir un enlace para restablecer la contraseña',
      description:
        'Si el correo es de una cuenta con acceso, le envía un enlace de un solo uso que vence en ' +
        '30 minutos (como máximo uno por minuto). Responde igual exista o no la cuenta, para no ' +
        'revelar qué correos están registrados. El admin global no se recupera por aquí, solo ' +
        'desde la terminal del servidor.',
      tags: TAGS,
      auth: 'public',
      rateLimit: 'sensitive',
      request: { body: requestPasswordResetBody },
      responses: { 204: { description: 'Si la cuenta existe, se envió el correo' } },
      handler: async ({ body, request }) => {
        await deps.requestPasswordReset.execute({ email: body.email, client: request });
        return noContent();
      },
    }),

    defineRoute({
      method: 'post',
      path: '/auth/password-reset/confirm',
      summary: 'Restablecer la contraseña con el enlace del correo',
      description:
        'Pone la contraseña nueva, cierra todas las sesiones y quita el bloqueo por intentos. ' +
        'El enlace queda usado. Después hay que iniciar sesión.',
      tags: TAGS,
      auth: 'public',
      rateLimit: 'sensitive',
      request: { body: confirmPasswordResetBody },
      responses: {
        204: { description: 'Contraseña restablecida' },
        400: {
          description: 'Enlace inválido, usado o vencido, o contraseña débil',
          errorCodes: ['INVALID_RESET_TOKEN', 'WEAK_PASSWORD'],
        },
      },
      handler: async ({ body, request }) => {
        await deps.confirmPasswordReset.execute({ ...body, client: request });
        return noContent();
      },
    }),
  ];
}
