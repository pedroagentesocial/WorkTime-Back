import { Permission } from '#shared/domain/permissions.js';
import { created, defineRoute, ok, paginated, type AnyRoute } from '#shared/http/route.js';
import {
  dataResponse,
  idParams,
  pageResponse,
  resetAccessBody,
  toAccessDto,
} from '#shared/http/schemas.js';
import type { ChangeCompanyStatusUseCase } from '../application/change-company-status.use-case.js';
import type { CreateCompanyUseCase } from '../application/create-company.use-case.js';
import type { GetCompanyUseCase } from '../application/get-company.use-case.js';
import type { ListCompaniesUseCase } from '../application/list-companies.use-case.js';
import type { ResetCompanyAdminPasswordUseCase } from '../application/reset-company-admin-password.use-case.js';
import type { UpdateCompanyUseCase } from '../application/update-company.use-case.js';
import {
  changeStatusBody,
  companySchema,
  createCompanyBody,
  createCompanyResponse,
  listCompaniesQuery,
  resetAdminPasswordResponse,
  toAdminDto,
  toCompanyDto,
  updateCompanyBody,
} from './platform.schemas.js';

interface Deps {
  createCompany: CreateCompanyUseCase;
  listCompanies: ListCompaniesUseCase;
  getCompany: GetCompanyUseCase;
  updateCompany: UpdateCompanyUseCase;
  changeCompanyStatus: ChangeCompanyStatusUseCase;
  resetCompanyAdminPassword: ResetCompanyAdminPasswordUseCase;
}

const TAGS = ['Plataforma · Empresas'];
const AUTH = Permission.COMPANIES_MANAGE;
const NOT_FOUND = { description: 'La empresa no existe', errorCodes: ['COMPANY_NOT_FOUND'] };

export function platformRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'post',
      path: '/platform/companies',
      summary: 'Crear una empresa con su administrador',
      description:
        'Crea la empresa y su admin en una sola operación. Devuelve una contraseña temporal ' +
        '(se muestra una sola vez) que el admin deberá cambiar en su primer inicio de sesión.',
      tags: TAGS,
      auth: AUTH,
      request: { body: createCompanyBody },
      responses: {
        201: { description: 'Empresa creada', schema: dataResponse(createCompanyResponse) },
        400: {
          description: 'Datos inválidos',
          errorCodes: ['INVALID_TIMEZONE', 'INVALID_COMPANY_NAME', 'INVALID_MAX_EMPLOYEES'],
        },
        409: { description: 'El email del admin ya está registrado', errorCodes: ['EMAIL_TAKEN'] },
      },
      handler: async ({ actor, body, request }) => {
        const result = await deps.createCompany.execute({ actor, client: request, ...body });
        return created({
          company: toCompanyDto(result.company),
          ...toAccessDto(result.access),
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/platform/companies',
      summary: 'Listar empresas',
      description: 'Ordenadas de la más reciente a la más antigua.',
      tags: TAGS,
      auth: AUTH,
      request: { query: listCompaniesQuery },
      responses: {
        200: { description: 'Página de empresas', schema: pageResponse(companySchema) },
      },
      handler: async ({ query }) => {
        const { page, limit, search, status } = query;
        const result = await deps.listCompanies.execute({
          filter: { search, status },
          page: { page, limit },
        });
        return paginated(result.items.map(toCompanyDto), result);
      },
    }),

    defineRoute({
      method: 'get',
      path: '/platform/companies/:id',
      summary: 'Detalle de una empresa',
      tags: TAGS,
      auth: AUTH,
      request: { params: idParams },
      responses: {
        200: { description: 'Empresa', schema: dataResponse(companySchema) },
        404: NOT_FOUND,
      },
      handler: async ({ params }) => ok(toCompanyDto(await deps.getCompany.execute(params.id))),
    }),

    defineRoute({
      method: 'patch',
      path: '/platform/companies/:id',
      summary: 'Editar una empresa',
      description:
        'Solo se modifican los campos enviados. `maxEmployees` puede quedar por debajo de los ' +
        'empleados activos (por ejemplo al bajar de plan): nadie pierde el acceso, pero la empresa ' +
        'queda excedida y no puede dar de alta ni reactivar empleados hasta quedar dentro.',
      tags: TAGS,
      auth: AUTH,
      request: { params: idParams, body: updateCompanyBody },
      responses: {
        200: { description: 'Empresa actualizada', schema: dataResponse(companySchema) },
        400: {
          description: 'Datos inválidos',
          errorCodes: ['INVALID_TIMEZONE', 'INVALID_COMPANY_NAME', 'INVALID_MAX_EMPLOYEES'],
        },
        404: NOT_FOUND,
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          toCompanyDto(
            await deps.updateCompany.execute({
              actor,
              client: request,
              companyId: params.id,
              patch: body,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'patch',
      path: '/platform/companies/:id/status',
      summary: 'Suspender o reactivar una empresa',
      description:
        'Al suspender, todos los usuarios de la empresa pierden el acceso de inmediato. ' +
        'Sus datos se conservan intactos.',
      tags: TAGS,
      auth: AUTH,
      request: { params: idParams, body: changeStatusBody },
      responses: {
        200: { description: 'Estado actualizado', schema: dataResponse(companySchema) },
        404: NOT_FOUND,
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          toCompanyDto(
            await deps.changeCompanyStatus.execute({
              actor,
              client: request,
              companyId: params.id,
              status: body.status,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/platform/companies/:id/admin/reset-password',
      summary: 'Restablecer la contraseña del admin de una empresa',
      description:
        'Genera una contraseña temporal (se muestra una sola vez), cierra todas las sesiones ' +
        'del admin y desbloquea su cuenta.',
      tags: TAGS,
      auth: AUTH,
      request: { params: idParams, body: resetAccessBody },
      responses: {
        200: {
          description: 'Contraseña restablecida',
          schema: dataResponse(resetAdminPasswordResponse),
        },
        404: {
          description: 'Empresa o admin inexistente',
          errorCodes: ['COMPANY_NOT_FOUND', 'COMPANY_ADMIN_NOT_FOUND'],
        },
      },
      handler: async ({ actor, params, body, request }) => {
        const result = await deps.resetCompanyAdminPassword.execute({
          actor,
          client: request,
          companyId: params.id,
          delivery: body?.delivery,
        });
        return ok({
          admin: toAdminDto(result.admin),
          ...toAccessDto(result.access),
        });
      },
    }),
  ];
}
