import { MULTI_ADMIN_LIMITS } from '../domain/multi-admin-rules.js';
import {
  accessDeliveryInput,
  accessResultShape,
  emailSchema,
  paginationQuery,
  personNameSchema,
} from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type { MultiAdminDetail } from '../application/get-multi-admin.use-case.js';
import type { MultiAdminView } from '../application/ports/multi-admin.repository.js';
import { companySchema, toCompanyDto } from './platform.schemas.js';

const maxCompanies = z
  .number()
  .int()
  .min(1)
  .max(MULTI_ADMIN_LIMITS.maxCompaniesUpperBound)
  .openapi({ example: 3, description: 'Cuántas empresas puede tener asignadas o crear' });

const maxEmployeesPerCompany = z
  .number()
  .int()
  .min(1)
  .max(MULTI_ADMIN_LIMITS.maxEmployeesPerCompanyUpperBound)
  .openapi({
    example: 25,
    description: 'Máximo de empleados de cada empresa que cree esa persona',
  });

const userStatus = z.enum(['active', 'inactive']);

export const createMultiAdminBody = z
  .object({
    email: emailSchema,
    firstName: personNameSchema.openapi({ example: 'Laura' }),
    lastName: personNameSchema.openapi({ example: 'Gómez' }),
    maxCompanies,
    maxEmployeesPerCompany,
    delivery: accessDeliveryInput,
  })
  .strict()
  .openapi('CreateMultiAdminRequest');

export const updateMultiAdminBody = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    maxCompanies: maxCompanies.optional(),
    maxEmployeesPerCompany: maxEmployeesPerCompany.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Envía al menos un campo para actualizar',
  })
  .openapi('UpdateMultiAdminRequest');

export const changeMultiAdminStatusBody = z
  .object({ status: userStatus })
  .strict()
  .openapi('ChangeMultiAdminStatusRequest');

export const assignCompanyBody = z
  .object({ companyId: z.uuid() })
  .strict()
  .openapi('AssignCompanyRequest');

export const multiAdminCompanyParams = z.object({ id: z.uuid(), companyId: z.uuid() });

export const listMultiAdminsQuery = paginationQuery.extend({
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: 'Busca por correo o nombre' }),
  status: userStatus.optional(),
});

export const multiAdminSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
    status: userStatus,
    lastLoginAt: z.iso.datetime().nullable(),
    maxCompanies: z.number().int(),
    maxEmployeesPerCompany: z.number().int(),
    companyCount: z.number().int().openapi({ description: 'Empresas que tiene hoy' }),
    createdAt: z.iso.datetime(),
  })
  .openapi('MultiAdmin');

export const multiAdminDetailSchema = z
  .object({ multiAdmin: multiAdminSchema, companies: z.array(companySchema) })
  .openapi('MultiAdminDetail');

export const createMultiAdminResponse = z
  .object({
    multiAdmin: multiAdminSchema,
    ...accessResultShape,
  })
  .openapi('CreateMultiAdminResponse');

export function toMultiAdminDto(admin: MultiAdminView) {
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.firstName,
    lastName: admin.lastName,
    status: admin.status,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    maxCompanies: admin.maxCompanies,
    maxEmployeesPerCompany: admin.maxEmployeesPerCompany,
    companyCount: admin.companyCount,
    createdAt: admin.createdAt.toISOString(),
  };
}

export function toMultiAdminDetailDto(detail: MultiAdminDetail) {
  return {
    multiAdmin: toMultiAdminDto(detail.multiAdmin),
    companies: detail.companies.map(toCompanyDto),
  };
}
