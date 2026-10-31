import { MAX_DAILY_LIMIT_MINUTES } from '#shared/domain/daily-limit.js';
import { COMPANY_LIMITS } from '#shared/domain/company-rules.js';
import { PAY_KINDS, PAY_LIMITS } from '#shared/domain/pay-rules.js';
import type { EmployeePayRates } from '../application/pay-rate.use-cases.js';
import { emailSchema, paginationQuery, personNameSchema } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type { CompanySettingsView } from '../application/ports/company-settings.repository.js';
import type { WorkSiteView } from '../application/ports/work-site.repository.js';
import { WORK_SITE_LIMITS } from '../domain/work-site-rules.js';
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
    enforceWorkSites: z.boolean().optional().openapi({
      description:
        'true exige que los empleados marquen su entrada dentro de una zona de trabajo. Requiere al menos una zona activa.',
    }),
    allowCheckIns: z.boolean().optional().openapi({
      description:
        'true deja que los empleados registren su llegada a un lugar (check-in) sin marcar entrada. No cuenta horas.',
    }),
    selfEditDays: z.number().int().min(1).max(31).optional().openapi({
      example: 7,
      description:
        'Cuántos días hacia atrás pueden corregir sus horas los empleados con permiso (1 a 31). Nunca dentro de un periodo cerrado.',
    }),
    currency: z.string().trim().length(3).optional().openapi({
      example: 'USD',
      description:
        'Moneda en la que cobran los empleados, con el código ISO 4217 de 3 letras (USD, MXN...). Los periodos ya cerrados conservan la suya.',
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
    enforceWorkSites: z.boolean(),
    allowCheckIns: z.boolean(),
    selfEditDays: z.number().int(),
    currency: z.string().openapi({ example: 'USD' }),
    maxEmployees: z.number().int().openapi({ description: 'Lo define el admin global.' }),
    activeEmployees: z.number().int(),
  })
  .openapi('CompanySettings');

export function toCompanySettingsDto(company: CompanySettingsView) {
  return { ...company };
}

const siteName = z.string().trim().min(1).max(WORK_SITE_LIMITS.nameMaxLength).openapi({
  example: 'Oficina central',
});
const siteLatitude = z.number().min(-90).max(90).openapi({ example: 40.7608 });
const siteLongitude = z.number().min(-180).max(180).openapi({ example: -111.891 });
const siteRadius = z
  .number()
  .int()
  .min(WORK_SITE_LIMITS.minRadiusMeters)
  .max(WORK_SITE_LIMITS.maxRadiusMeters)
  .openapi({ example: 150, description: 'Radio de la zona en metros (10 a 60000)' });

export const createWorkSiteBody = z
  .object({
    name: siteName,
    latitude: siteLatitude,
    longitude: siteLongitude,
    radiusMeters: siteRadius,
  })
  .strict()
  .openapi('CreateWorkSiteRequest');

export const updateWorkSiteBody = z
  .object({
    name: siteName.optional(),
    latitude: siteLatitude.optional(),
    longitude: siteLongitude.optional(),
    radiusMeters: siteRadius.optional(),
    active: z.boolean().optional().openapi({
      description: 'false desactiva la zona sin borrarla; los marcajes pasados la conservan',
    }),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Envía al menos un campo para actualizar',
  })
  .openapi('UpdateWorkSiteRequest');

export const workSiteSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    radiusMeters: z.number().int(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('WorkSite');

export function toWorkSiteDto(site: WorkSiteView) {
  return {
    ...site,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}

const payKind = z.enum(PAY_KINDS).openapi({
  description:
    '`hourly`: el monto es lo que se paga por hora. `salary`: sueldo fijo de cada periodo de 14 días.',
});
const amountCents = z.number().int().min(0).max(PAY_LIMITS.maxAmountCents).openapi({
  example: 1550,
  description: 'En centavos de la moneda de la empresa: 1550 = 15.50.',
});

export const setPayRateBody = z
  .object({
    kind: payKind,
    amountCents,
    effectiveFrom: z.iso
      .date()
      .refine(
        (value) => value >= '2000-01-01' && value <= '2100-12-31',
        'La fecha debe estar entre los años 2000 y 2100',
      )
      .openapi({
        example: '2026-10-19',
        description:
          'Día desde el que rige. Para aplicarlo a todo el periodo en curso, manda su primer día. No puede caer en un periodo cerrado.',
      }),
  })
  .strict()
  .openapi('SetPayRateRequest');

export const payRatesSchema = z
  .object({
    currency: z.string().openapi({ example: 'USD' }),
    rates: z.array(
      z
        .object({
          id: z.uuid(),
          kind: payKind,
          amountCents: z.number().int(),
          effectiveFrom: z.iso.date(),
          changedById: z.uuid(),
          locked: z.boolean().openapi({
            description: 'Rige en un periodo cerrado: ya se pagó con él y no se puede quitar',
          }),
          createdAt: z.iso.datetime(),
          updatedAt: z.iso.datetime(),
        })
        .openapi('PayRate'),
    ),
    inactiveSpans: z
      .array(z.object({ fromDay: z.iso.date(), toDay: z.iso.date().nullable() }))
      .openapi({
        description:
          'Bajas del empleado, de la más vieja a la más nueva: días en que no cobra sueldo fijo. `toDay` es null mientras sigue inactivo.',
      }),
  })
  .openapi('EmployeePayRates', {
    description:
      'Historial de sueldo, del cambio más nuevo al más viejo. El primero es el vigente o el próximo.',
  });

export function toPayRatesDto({ currency, rates, inactiveSpans }: EmployeePayRates) {
  return {
    currency,
    inactiveSpans,
    rates: rates.map((rate) => ({
      ...rate,
      createdAt: rate.createdAt.toISOString(),
      updatedAt: rate.updatedAt.toISOString(),
    })),
  };
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
    allowCheckIns: z.boolean().nullable().optional().openapi({
      description:
        'Registro de llegada (check-in) propio de este empleado. `true` lo permite y `false` lo prohíbe aunque la empresa diga lo contrario; `null` = usa el de la empresa.',
    }),
    allowSelfEdit: z.boolean().optional().openapi({
      description:
        'Permite que el empleado corrija la hora de entrada o salida de sus marcajes de los últimos días (los que diga la empresa), con motivo. Nunca en un periodo cerrado.',
    }),
    selfEditUntil: hiredAt.optional().openapi({
      example: '2026-11-15',
      description: 'Último día en que puede corregir; `null` = sin vencimiento.',
    }),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Envía al menos un campo para actualizar',
  })
  .openapi('UpdateEmployeeRequest');

export const changeEmployeeStatusBody = z
  .object({
    status: employeeStatus,
    effectiveOn: z.iso
      .date()
      .refine(
        (value) => value >= '2000-01-01' && value <= '2100-12-31',
        'La fecha debe estar entre los años 2000 y 2100',
      )
      .optional()
      .openapi({
        example: '2026-10-30',
        description:
          'Solo para el sueldo fijo. Al desactivar, el último día que se le paga; al reactivar, el primero. Por defecto hoy en la zona del empleado; no puede ser futuro ni caer en un periodo cerrado. El acceso cambia al momento.',
      }),
  })
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
    allowCheckIns: z.boolean().nullable().openapi({
      description: 'Check-in propio: true o false lo fuerzan; null = hereda el de la empresa.',
    }),
    effectiveAllowCheckIns: z.boolean().openapi({
      description:
        'Si el empleado puede registrar llegadas, ya combinando el suyo con el de la empresa.',
    }),
    allowSelfEdit: z.boolean().openapi({
      description: 'Si el admin le permite corregir sus propias horas.',
    }),
    selfEditUntil: z.iso.date().nullable().openapi({
      description: 'Último día del permiso; null = sin vencimiento.',
    }),
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
