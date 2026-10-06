import { MAX_DAILY_LIMIT_MINUTES } from '#shared/domain/daily-limit.js';
import { COMPANY_LIMITS } from '#shared/domain/company-rules.js';
import { emailSchema, paginationQuery, personNameSchema } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type { CompanySettingsView } from '../application/ports/company-settings.repository.js';
import type { EmployeeView } from '../application/ports/employee.repository.js';
import { EMPLOYEE_LIMITS } from '../domain/employee-rules.js';

const timezone = z.string().trim().min(1).max(64);

const employeeTimezone = timezone.nullable().openapi({
  example: 'America/Mexico_City',
  description: 'Zona horaria IANA del empleado. `null` u omitido = usa la de la empresa.',
});

const phone = z.string().trim().max(EMPLOYEE_LIMITS.phoneMaxLength).nullable().openapi({
  example: '+52 33 1234 5678',
  description: 'Teléfono de contacto opcional (solo informativo). `null` o vacío = sin teléfono.',
});

const dailyLimitMinutes = z.number().int().min(1).max(MAX_DAILY_LIMIT_MINUTES).nullable().openapi({
  example: 490,
  description:
    'Máximo de minutos de trabajo por día laboral (490 = 8 h 10 min). `null` = sin límite.',
});

const hiredAt = z.iso.date().nullable().openapi({ example: '2026-06-01' });

const employeeStatus = z.enum(['active', 'inactive']);

export const updateCompanySettingsBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(COMPANY_LIMITS.nameMinLength)
      .max(COMPANY_LIMITS.nameMaxLength)
      .optional(),
    timezone: timezone.optional().openapi({ example: 'America/Denver' }),
    requireDailyReport: z.boolean().optional().openapi({
      description:
        'true obliga al empleado a escribir el reporte de lo que hizo en el día al marcar salida (mínimo 10 caracteres).',
    }),
    dailyLimitMinutes: dailyLimitMinutes.optional().openapi({
      description:
        'Límite diario para todos los empleados de la empresa. Al alcanzarlo se cierra la entrada abierta y no pueden volver a marcar ese día. `null` = sin límite.',
    }),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Envía al menos un campo para actualizar',
  })
  .openapi('UpdateCompanySettingsRequest');

export const companySettingsSchema = z
  .object({
    id: z.uuid(),
    code: z.string().openapi({
      example: 'K7QF-29MX',
      description:
        'Código que identifica a tu empresa (soporte, correos). No cambia nunca. No es un secreto',
    }),
    employeeCodePrefix: z.string().openapi({
      example: 'KCS',
      description: 'Letras con las que empiezan los códigos de tus empleados (KCS-0001)',
    }),
    name: z.string(),
    timezone: z.string(),
    status: z.enum(['active', 'suspended']),
    dailyLimitMinutes: z.number().int().nullable().openapi({ description: 'null = sin límite.' }),
    requireDailyReport: z.boolean(),
    maxEmployees: z.number().int().openapi({ description: 'Lo define el admin global.' }),
    activeEmployees: z.number().int(),
  })
  .openapi('CompanySettings');

export function toCompanySettingsDto(company: CompanySettingsView) {
  return { ...company };
}

export const createEmployeeBody = z
  .object({
    email: emailSchema,
    firstName: personNameSchema.openapi({ example: 'Ana' }),
    lastName: personNameSchema.openapi({ example: 'López' }),
    phone: phone.optional(),
    hiredAt: hiredAt.optional().openapi({
      description:
        'Fecha de ingreso. Si se omite se registra sola el día del alta, en la zona horaria del empleado.',
    }),
    timezone: employeeTimezone.optional(),
  })
  .strict()
  .openapi('CreateEmployeeRequest');

export const updateEmployeeBody = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    phone: phone.optional(),
    hiredAt: hiredAt.optional(),
    timezone: employeeTimezone.optional(),
    dailyLimitMinutes: dailyLimitMinutes.optional().openapi({
      description:
        'Límite diario propio de este empleado. `null` = usa el de la empresa. Tiene prioridad sobre el de la empresa.',
    }),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Envía al menos un campo para actualizar',
  })
  .openapi('UpdateEmployeeRequest');

export const changeEmployeeStatusBody = z
  .object({ status: employeeStatus })
  .strict()
  .openapi('ChangeEmployeeStatusRequest');

export const listEmployeesQuery = paginationQuery.extend({
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: 'Busca en nombre, apellido, email o código' }),
  status: employeeStatus.optional(),
});

export const employeeSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
    employeeCode: z.string().openapi({
      example: 'KCS-0001',
      description:
        'Lo asigna el sistema al dar de alta: letras de la empresa y consecutivo. No cambia ni se reutiliza',
    }),
    phone: z.string().nullable(),
    hiredAt: z.iso.date().nullable(),
    timezone: z.string().nullable().openapi({ description: 'Zona propia; null = hereda.' }),
    effectiveTimezone: z.string().openapi({ description: 'Zona que realmente aplica.' }),
    dailyLimitMinutes: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Propio; null = hereda.' }),
    effectiveDailyLimitMinutes: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Límite que realmente aplica; null = sin límite.' }),
    status: employeeStatus,
    mustChangePassword: z.boolean(),
    lastLoginAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('Employee');

export const employeeWithPasswordSchema = z
  .object({
    employee: employeeSchema,
    temporaryPassword: z.string().openapi({
      description: 'Se muestra UNA sola vez; entrégala de forma segura al empleado.',
    }),
    temporaryPasswordExpiresAt: z.iso.datetime(),
  })
  .openapi('EmployeeWithTemporaryPassword');

export function toEmployeeDto(employee: EmployeeView) {
  return {
    ...employee,
    lastLoginAt: employee.lastLoginAt?.toISOString() ?? null,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}
