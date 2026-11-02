import { ACCESS_DELIVERIES, type AccessResult } from '#shared/application/account-access.js';
import { PAGINATION_DEFAULTS } from '#shared/application/pagination.js';
import { z } from './zod.js';

export const uuidSchema = z.uuid({ message: 'Debe ser un UUID válido' });

export const idParams = z.object({ id: uuidSchema });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION_DEFAULTS.page),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_DEFAULTS.maxLimit)
    .default(PAGINATION_DEFAULTS.limit),
});

export function dataResponse<T extends z.ZodType>(schema: T) {
  return z.object({ data: schema });
}

export function pageResponse<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z.object({
      page: z.number().int(),
      limit: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
    }),
  });
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Debe ser un email válido' }).max(254))
  .openapi({ example: 'ana@empresa.com' });

export const personNameSchema = z
  .string()
  .trim()
  .min(1, 'Es obligatorio')
  .max(100)
  .refine((value) => !/\p{Cc}/u.test(value), 'Contiene caracteres no permitidos');

// Como recibe su acceso una cuenta nueva o restablecida; sin elegir, por correo si se puede
export const accessDeliveryInput = z
  .enum(ACCESS_DELIVERIES)
  .optional()
  .openapi({
    description:
      '`email` (por defecto): le llega un enlace para crear su contraseña. `temporary_password`: ' +
      'se genera una contraseña temporal para entregarla en persona. Si los correos no están ' +
      'configurados o el correo es de un dominio de pruebas, se usa la temporal.',
  });

// Cuerpo opcional de los botones de restablecer la contraseña
export const resetAccessBody = z
  .object({ delivery: accessDeliveryInput })
  .strict()
  .optional()
  .openapi('ResetAccessRequest');

export const accessResultShape = {
  delivery: z.enum(ACCESS_DELIVERIES).openapi({ description: 'Cómo recibió su acceso.' }),
  emailSent: z.boolean().openapi({
    description: 'false si el correo no se pudo enviar: reenvíalo o dale una contraseña temporal.',
  }),
  temporaryPassword: z.string().or(z.null()).openapi({
    description:
      'Solo con `temporary_password`. Se muestra UNA sola vez; entrégala de forma segura.',
  }),
  temporaryPasswordExpiresAt: z.iso.datetime().openapi({
    description: 'Cuándo vence el enlace o la contraseña temporal (72 horas).',
  }),
};

export function toAccessDto(access: AccessResult) {
  return {
    delivery: access.delivery,
    emailSent: access.emailSent,
    temporaryPassword: access.temporaryPassword,
    temporaryPasswordExpiresAt: access.expiresAt.toISOString(),
  };
}
