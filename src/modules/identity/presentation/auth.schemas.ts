import { SECURITY } from '#config/security.js';
import { Permission, Role } from '#shared/domain/permissions.js';
import { emailSchema, personNameSchema } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type { IssuedSession } from '../application/session-issuer.js';

const emailInput = emailSchema;

const passwordInput = z.string().min(1, 'Es obligatoria').max(SECURITY.password.maxLength);

const refreshTokenInput = z.string().min(32).max(256);

export const loginBody = z
  .object({ email: emailInput, password: passwordInput })
  .strict()
  .openapi('LoginRequest');

export const refreshBody = z
  .object({ refreshToken: refreshTokenInput })
  .strict()
  .openapi('RefreshRequest');

export const changePasswordBody = z
  .object({
    currentPassword: passwordInput,
    newPassword: z
      .string()
      .max(SECURITY.password.maxLength)
      .openapi({
        description: `Mínimo ${SECURITY.password.minLength} caracteres; distinta de la actual y del email.`,
      }),
  })
  .strict()
  .openapi('ChangePasswordRequest');

export const updateProfileBody = z
  .object({ firstName: personNameSchema, lastName: personNameSchema })
  .strict()
  .openapi('UpdateProfileRequest');

export const switchCompanyBody = z
  .object({
    companyId: z
      .uuid()
      .or(z.null())
      .openapi({
        description:
          'Empresa con la que quieres trabajar. null deja la sesión sin empresa activa, ' +
          'para ver el resumen de todas tus empresas.',
      }),
  })
  .strict()
  .openapi('SwitchCompanyRequest');

export const sessionSchema = z
  .object({
    tokenType: z.literal('Bearer'),
    accessToken: z.string(),
    accessTokenExpiresAt: z.iso.datetime(),
    refreshToken: z.string().openapi({
      description: 'Guárdalo de forma segura. Cada uso devuelve uno nuevo y anula el anterior.',
    }),
    refreshTokenExpiresAt: z.iso.datetime(),
  })
  .openapi('Session');

export const profileSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
    role: z.enum(Object.values(Role) as [Role, ...Role[]]),
    mustChangePassword: z.boolean(),
    company: z
      .object({ id: z.uuid(), code: z.string(), name: z.string(), timezone: z.string() })
      .nullable(),
    employee: z
      .object({
        employeeCode: z
          .string()
          .openapi({ description: 'Código del empleado, por ejemplo KCS-0001.' }),
        timezone: z.string().openapi({
          description:
            'Zona horaria efectiva: la propia del empleado o, si no tiene, la de la empresa.',
        }),
      })
      .openapi({ description: 'Datos de empleado. Es null si el usuario no es empleado.' })
      .or(z.null()),
    permissions: z.array(z.enum(Object.values(Permission) as [Permission, ...Permission[]])),
  })
  .openapi('CurrentUser');

export const loginResponseSchema = sessionSchema
  .extend({ user: profileSchema })
  .openapi('LoginResponse');

export function toSessionDto(session: IssuedSession) {
  return {
    tokenType: 'Bearer' as const,
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
  };
}
