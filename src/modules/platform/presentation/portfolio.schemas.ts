import { accessDeliveryInput, emailSchema, personNameSchema } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import { COMPANY_LIMITS } from '#shared/domain/company-rules.js';
import type { MyCompanies } from '../application/list-my-companies.use-case.js';
import { companySchema, toCompanyDto } from './platform.schemas.js';

export const createOwnCompanyBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(COMPANY_LIMITS.nameMinLength)
      .max(COMPANY_LIMITS.nameMaxLength)
      .openapi({ example: 'Sucursal Norte' }),
    timezone: z.string().trim().min(1).max(64).optional().openapi({
      description: 'Zona horaria IANA. Si se omite se usa America/Denver.',
    }),
    admin: z
      .object({
        email: emailSchema,
        firstName: personNameSchema.openapi({ example: 'Juan' }),
        lastName: personNameSchema.openapi({ example: 'Pérez' }),
      })
      .strict()
      .openapi({
        description: 'El admin de la nueva empresa. Recibe un correo para crear su contraseña.',
      }),
    delivery: accessDeliveryInput,
  })
  .strict()
  .openapi('CreateOwnCompanyRequest');

export const myCompaniesSchema = z
  .object({
    limits: z.object({
      maxCompanies: z.number().int(),
      maxEmployeesPerCompany: z.number().int(),
      usedCompanies: z.number().int(),
    }),
    companies: z.array(companySchema),
  })
  .openapi('MyCompanies');

export function toMyCompaniesDto(result: MyCompanies) {
  return { limits: result.limits, companies: result.companies.map(toCompanyDto) };
}
