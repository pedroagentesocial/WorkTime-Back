import { emailSchema, paginationQuery, personNameSchema } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type { CompanyAdminSummary, CompanyView } from '../application/ports/company.repository.js';
import { COMPANY_DEFAULTS, COMPANY_LIMITS } from '#shared/domain/company-rules.js';

const companyName = z
  .string()
  .trim()
  .min(COMPANY_LIMITS.nameMinLength)
  .max(COMPANY_LIMITS.nameMaxLength)
  .openapi({ example: 'Taller Pérez' });

const timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .openapi({ example: 'America/Denver', description: 'Zona horaria IANA' });

const maxEmployees = z
  .number()
  .int()
  .min(1)
  .max(COMPANY_LIMITS.maxEmployeesUpperBound)
  .openapi({ example: 25 });

const companyStatus = z.enum(['active', 'suspended']);

export const createCompanyBody = z
  .object({
    name: companyName,
    timezone: timezone.optional().openapi({
      description: `Zona horaria IANA. Si se omite: ${COMPANY_DEFAULTS.timezone} (Salt Lake City, Utah).`,
    }),
    maxEmployees,
    admin: z
      .object({
        email: emailSchema,
        firstName: personNameSchema.openapi({ example: 'Juan' }),
        lastName: personNameSchema.openapi({ example: 'Pérez' }),
      })
      .strict(),
  })
  .strict()
  .openapi('CreateCompanyRequest');

export const updateCompanyBody = z
  .object({
    name: companyName.optional(),
    timezone: timezone.optional(),
    maxEmployees: maxEmployees.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Envía al menos un campo para actualizar',
  })
  .openapi('UpdateCompanyRequest');

export const changeStatusBody = z
  .object({ status: companyStatus })
  .strict()
  .openapi('ChangeCompanyStatusRequest');

export const listCompaniesQuery = paginationQuery.extend({
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: 'Busca por nombre o por código de empresa' }),
  status: companyStatus.optional(),
});

const companyAdminSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
    status: z.enum(['active', 'inactive']),
    lastLoginAt: z.iso.datetime().nullable(),
  })
  .openapi('CompanyAdmin');

export const companySchema = z
  .object({
    id: z.uuid(),
    code: z.string().openapi({
      example: 'K7QF-29MX',
      description:
        'Código aleatorio que identifica a la empresa (soporte, correos). No cambia nunca. Identifica, no autentica: no es un secreto',
    }),
    employeeCodePrefix: z.string().openapi({
      example: 'KCS',
      description: 'Letras con las que empiezan los códigos de sus empleados (KCS-0001)',
    }),
    name: z.string(),
    timezone: z.string(),
    maxEmployees: z.number().int(),
    activeEmployees: z.number().int(),
    status: companyStatus,
    // Se usa or null y no nullable porque con un esquema con nombre Swagger perdia el null
    admin: companyAdminSchema.or(z.null()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('Company');

export const createCompanyResponse = z
  .object({
    company: companySchema,
    temporaryPassword: z.string().openapi({
      description:
        'Contraseña temporal del admin. Se muestra UNA sola vez; entrégala de forma segura.',
    }),
    temporaryPasswordExpiresAt: z.iso.datetime(),
  })
  .openapi('CreateCompanyResponse');

export const resetAdminPasswordResponse = z
  .object({
    admin: companyAdminSchema,
    temporaryPassword: z.string().openapi({ description: 'Se muestra UNA sola vez.' }),
    temporaryPasswordExpiresAt: z.iso.datetime(),
  })
  .openapi('ResetAdminPasswordResponse');

export function toAdminDto(admin: CompanyAdminSummary) {
  return { ...admin, lastLoginAt: admin.lastLoginAt?.toISOString() ?? null };
}

export function toCompanyDto(company: CompanyView) {
  return {
    id: company.id,
    code: company.code,
    employeeCodePrefix: company.employeeCodePrefix,
    name: company.name,
    timezone: company.timezone,
    maxEmployees: company.maxEmployees,
    activeEmployees: company.activeEmployees,
    status: company.status,
    admin: company.admin ? toAdminDto(company.admin) : null,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}
