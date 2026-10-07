import { Permission } from '#shared/domain/permissions.js';
import { created, defineRoute, ok, paginated, type AnyRoute } from '#shared/http/route.js';
import { dataResponse, idParams, pageResponse } from '#shared/http/schemas.js';
import type { AssignCompanyToMultiAdminUseCase } from '../application/assign-company-to-multi-admin.use-case.js';
import type { ChangeMultiAdminStatusUseCase } from '../application/change-multi-admin-status.use-case.js';
import type { CreateMultiAdminUseCase } from '../application/create-multi-admin.use-case.js';
import type { GetMultiAdminUseCase } from '../application/get-multi-admin.use-case.js';
import type { ListMultiAdminsUseCase } from '../application/list-multi-admins.use-case.js';
import type { RemoveCompanyFromMultiAdminUseCase } from '../application/remove-company-from-multi-admin.use-case.js';
import type { ResetMultiAdminPasswordUseCase } from '../application/reset-multi-admin-password.use-case.js';
import type { UpdateMultiAdminUseCase } from '../application/update-multi-admin.use-case.js';
import {
  assignCompanyBody,
  changeMultiAdminStatusBody,
  createMultiAdminBody,
  createMultiAdminResponse,
  listMultiAdminsQuery,
  multiAdminCompanyParams,
  multiAdminDetailSchema,
  multiAdminSchema,
  toMultiAdminDetailDto,
  toMultiAdminDto,
  updateMultiAdminBody,
} from './multi-admin.schemas.js';

interface Deps {
  createMultiAdmin: CreateMultiAdminUseCase;
  listMultiAdmins: ListMultiAdminsUseCase;
  getMultiAdmin: GetMultiAdminUseCase;
  updateMultiAdmin: UpdateMultiAdminUseCase;
  changeMultiAdminStatus: ChangeMultiAdminStatusUseCase;
  resetMultiAdminPassword: ResetMultiAdminPasswordUseCase;
  assignCompanyToMultiAdmin: AssignCompanyToMultiAdminUseCase;
  removeCompanyFromMultiAdmin: RemoveCompanyFromMultiAdminUseCase;
}

const TAGS = ['Plataforma · Administradores multiempresa'];
const AUTH = Permission.MULTI_ADMINS_MANAGE;
const NOT_FOUND = {
  description: 'El administrador multiempresa no existe',
  errorCodes: ['MULTI_ADMIN_NOT_FOUND'],
};
const INVALID_LIMITS = {
  description: 'Límites inválidos',
  errorCodes: ['INVALID_MAX_COMPANIES', 'INVALID_MAX_EMPLOYEES'],
};

// Solo el admin global gestiona a estas personas y decide a cuáles empresas tienen acceso
export function multiAdminRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'post',
      path: '/platform/multi-admins',
      summary: 'Crear un administrador multiempresa',
      description:
        'Lo crea sin empresas, con su paquete: máximo de empresas y de empleados por empresa. ' +
        'Devuelve una contraseña temporal (se muestra una sola vez).',
      tags: TAGS,
      auth: AUTH,
      request: { body: createMultiAdminBody },
      responses: {
        201: { description: 'Creado', schema: dataResponse(createMultiAdminResponse) },
        400: INVALID_LIMITS,
        409: { description: 'El email ya está registrado', errorCodes: ['EMAIL_TAKEN'] },
      },
      handler: async ({ actor, body, request }) => {
        const result = await deps.createMultiAdmin.execute({ actor, client: request, ...body });
        return created({
          multiAdmin: toMultiAdminDto(result.multiAdmin),
          temporaryPassword: result.temporaryPassword,
          temporaryPasswordExpiresAt: result.temporaryPasswordExpiresAt.toISOString(),
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/platform/multi-admins',
      summary: 'Listar administradores multiempresa',
      description: 'Del más reciente al más antiguo.',
      tags: TAGS,
      auth: AUTH,
      request: { query: listMultiAdminsQuery },
      responses: {
        200: { description: 'Página de administradores', schema: pageResponse(multiAdminSchema) },
      },
      handler: async ({ query }) => {
        const { page, limit, search, status } = query;
        const result = await deps.listMultiAdmins.execute({
          filter: { search, status },
          page: { page, limit },
        });
        return paginated(result.items.map(toMultiAdminDto), result);
      },
    }),

    defineRoute({
      method: 'get',
      path: '/platform/multi-admins/:id',
      summary: 'Detalle de un administrador multiempresa y sus empresas',
      tags: TAGS,
      auth: AUTH,
      request: { params: idParams },
      responses: {
        200: {
          description: 'Administrador y empresas',
          schema: dataResponse(multiAdminDetailSchema),
        },
        404: NOT_FOUND,
      },
      handler: async ({ params }) =>
        ok(toMultiAdminDetailDto(await deps.getMultiAdmin.execute(params.id))),
    }),

    defineRoute({
      method: 'patch',
      path: '/platform/multi-admins/:id',
      summary: 'Editar un administrador multiempresa',
      description: 'Nombre y paquete. Solo se modifican los campos enviados.',
      tags: TAGS,
      auth: AUTH,
      request: { params: idParams, body: updateMultiAdminBody },
      responses: {
        200: { description: 'Actualizado', schema: dataResponse(multiAdminSchema) },
        400: INVALID_LIMITS,
        404: NOT_FOUND,
        409: {
          description: 'El máximo es menor a las empresas que ya tiene',
          errorCodes: ['MAX_COMPANIES_BELOW_ASSIGNED'],
        },
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          toMultiAdminDto(
            await deps.updateMultiAdmin.execute({
              actor,
              client: request,
              multiAdminId: params.id,
              patch: body,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'patch',
      path: '/platform/multi-admins/:id/status',
      summary: 'Desactivar o reactivar un administrador multiempresa',
      description:
        'Al desactivarlo pierde el acceso de inmediato. Sus empresas y datos se conservan.',
      tags: TAGS,
      auth: AUTH,
      request: { params: idParams, body: changeMultiAdminStatusBody },
      responses: {
        200: { description: 'Estado actualizado', schema: dataResponse(multiAdminSchema) },
        404: NOT_FOUND,
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          toMultiAdminDto(
            await deps.changeMultiAdminStatus.execute({
              actor,
              client: request,
              multiAdminId: params.id,
              status: body.status,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/platform/multi-admins/:id/reset-password',
      summary: 'Restablecer la contraseña de un administrador multiempresa',
      description:
        'Genera una contraseña temporal (se muestra una sola vez), cierra todas sus sesiones ' +
        'y desbloquea su cuenta.',
      tags: TAGS,
      auth: AUTH,
      request: { params: idParams },
      responses: {
        200: {
          description: 'Contraseña restablecida',
          schema: dataResponse(createMultiAdminResponse),
        },
        404: NOT_FOUND,
      },
      handler: async ({ actor, params, request }) => {
        const result = await deps.resetMultiAdminPassword.execute({
          actor,
          client: request,
          multiAdminId: params.id,
        });
        return ok({
          multiAdmin: toMultiAdminDto(result.multiAdmin),
          temporaryPassword: result.temporaryPassword,
          temporaryPasswordExpiresAt: result.temporaryPasswordExpiresAt.toISOString(),
        });
      },
    }),

    defineRoute({
      method: 'post',
      path: '/platform/multi-admins/:id/companies',
      summary: 'Asignar una empresa existente a un administrador multiempresa',
      description:
        'Le da acceso a la empresa, sin pasar de su máximo de empresas. La empresa conserva ' +
        'su propio admin de empresa.',
      tags: TAGS,
      auth: AUTH,
      request: { params: idParams, body: assignCompanyBody },
      responses: {
        201: { description: 'Empresa asignada', schema: dataResponse(multiAdminSchema) },
        404: {
          description: 'El administrador o la empresa no existen',
          errorCodes: ['MULTI_ADMIN_NOT_FOUND', 'COMPANY_NOT_FOUND'],
        },
        409: {
          description: 'Ya la tiene o llegó a su máximo de empresas',
          errorCodes: ['COMPANY_ALREADY_ASSIGNED', 'MAX_COMPANIES_REACHED'],
        },
      },
      handler: async ({ actor, params, body, request }) =>
        created(
          toMultiAdminDto(
            await deps.assignCompanyToMultiAdmin.execute({
              actor,
              client: request,
              multiAdminId: params.id,
              companyId: body.companyId,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'delete',
      path: '/platform/multi-admins/:id/companies/:companyId',
      summary: 'Quitar una empresa a un administrador multiempresa',
      description:
        'Pierde el acceso a esa empresa de inmediato. La empresa y sus datos no se tocan.',
      tags: TAGS,
      auth: AUTH,
      request: { params: multiAdminCompanyParams },
      responses: {
        200: { description: 'Empresa quitada', schema: dataResponse(multiAdminSchema) },
        404: {
          description: 'El administrador no existe o no tenía esa empresa',
          errorCodes: ['MULTI_ADMIN_NOT_FOUND', 'MEMBERSHIP_NOT_FOUND'],
        },
      },
      handler: async ({ actor, params, request }) =>
        ok(
          toMultiAdminDto(
            await deps.removeCompanyFromMultiAdmin.execute({
              actor,
              client: request,
              multiAdminId: params.id,
              companyId: params.companyId,
            }),
          ),
        ),
    }),
  ];
}
