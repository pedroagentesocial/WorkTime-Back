import { Permission } from '#shared/domain/permissions.js';
import { z } from '#shared/http/zod.js';
import {
  created,
  defineRoute,
  noContent,
  ok,
  paginated,
  type AnyRoute,
} from '#shared/http/route.js';
import { dataResponse, idParams, pageResponse, uuidSchema } from '#shared/http/schemas.js';
import type { ChangeEmployeeStatusUseCase } from '../application/change-employee-status.use-case.js';
import type {
  GetCompanySettingsUseCase,
  UpdateCompanySettingsUseCase,
} from '../application/company-settings.use-cases.js';
import type {
  CreateWorkSiteUseCase,
  ListWorkSitesUseCase,
  UpdateWorkSiteUseCase,
} from '../application/work-site.use-cases.js';
import type { CreateEmployeeUseCase } from '../application/create-employee.use-case.js';
import type {
  GetEmployeeUseCase,
  ListEmployeesUseCase,
} from '../application/query-employees.use-cases.js';
import type { DeleteEmployeeUseCase } from '../application/delete-employee.use-case.js';
import type {
  ListEmployeePayRatesUseCase,
  RemoveEmployeePayRateUseCase,
  SetEmployeePayRateUseCase,
} from '../application/pay-rate.use-cases.js';
import type { RevokeEmployeeSessionsUseCase } from '../application/revoke-employee-sessions.use-case.js';
import type { ResetEmployeePasswordUseCase } from '../application/reset-employee-password.use-case.js';
import type { UpdateEmployeeUseCase } from '../application/update-employee.use-case.js';
import {
  changeEmployeeStatusBody,
  companySettingsSchema,
  createEmployeeBody,
  createWorkSiteBody,
  updateWorkSiteBody,
  toWorkSiteDto,
  workSiteSchema,
  employeeSchema,
  employeeWithPasswordSchema,
  listEmployeesQuery,
  payRatesSchema,
  setPayRateBody,
  toCompanySettingsDto,
  toEmployeeDto,
  toPayRatesDto,
  updateCompanySettingsBody,
  updateEmployeeBody,
} from './workforce.schemas.js';

const payRateParams = z.object({ id: uuidSchema, rateId: uuidSchema });

interface Deps {
  getCompanySettings: GetCompanySettingsUseCase;
  updateCompanySettings: UpdateCompanySettingsUseCase;
  createEmployee: CreateEmployeeUseCase;
  listEmployees: ListEmployeesUseCase;
  getEmployee: GetEmployeeUseCase;
  updateEmployee: UpdateEmployeeUseCase;
  changeEmployeeStatus: ChangeEmployeeStatusUseCase;
  resetEmployeePassword: ResetEmployeePasswordUseCase;
  revokeEmployeeSessions: RevokeEmployeeSessionsUseCase;
  deleteEmployee: DeleteEmployeeUseCase;
  listEmployeePayRates: ListEmployeePayRatesUseCase;
  setEmployeePayRate: SetEmployeePayRateUseCase;
  removeEmployeePayRate: RemoveEmployeePayRateUseCase;
  listWorkSites: ListWorkSitesUseCase;
  createWorkSite: CreateWorkSiteUseCase;
  updateWorkSite: UpdateWorkSiteUseCase;
}

const COMPANY_TAGS = ['Empresa · Configuración'];
const EMPLOYEE_TAGS = ['Empresa · Empleados'];
const EMPLOYEE_NOT_FOUND = {
  description: 'El empleado no existe en tu empresa',
  errorCodes: ['EMPLOYEE_NOT_FOUND'],
};
const EMPLOYEE_VALIDATION = {
  description: 'Datos inválidos',
  errorCodes: ['INVALID_TIMEZONE', 'INVALID_PHONE'],
};

export function workforceRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'get',
      path: '/company',
      summary: 'Datos de mi empresa',
      tags: COMPANY_TAGS,
      auth: Permission.COMPANY_SETTINGS_MANAGE,
      responses: { 200: { description: 'Empresa', schema: dataResponse(companySettingsSchema) } },
      handler: async ({ actor }) =>
        ok(toCompanySettingsDto(await deps.getCompanySettings.execute(actor))),
    }),

    defineRoute({
      method: 'patch',
      path: '/company',
      summary: 'Editar mi empresa',
      description:
        'Nombre y zona horaria. El límite de empleados y el estado solo los cambia el admin global.',
      tags: COMPANY_TAGS,
      auth: Permission.COMPANY_SETTINGS_MANAGE,
      request: { body: updateCompanySettingsBody },
      responses: {
        200: { description: 'Empresa actualizada', schema: dataResponse(companySettingsSchema) },
        400: {
          description: 'Datos inválidos',
          errorCodes: ['INVALID_TIMEZONE', 'INVALID_COMPANY_NAME'],
        },
        409: {
          description: 'Exigir zonas sin ninguna zona activa',
          errorCodes: ['WORK_SITES_REQUIRED'],
        },
      },
      handler: async ({ actor, body, request }) =>
        ok(
          toCompanySettingsDto(
            await deps.updateCompanySettings.execute({ actor, client: request, patch: body }),
          ),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/company/work-sites',
      summary: 'Zonas de trabajo de mi empresa',
      description: 'Activas e inactivas, las activas primero.',
      tags: COMPANY_TAGS,
      auth: Permission.COMPANY_SETTINGS_MANAGE,
      responses: {
        200: { description: 'Zonas', schema: dataResponse(z.array(workSiteSchema)) },
      },
      handler: async ({ actor }) =>
        ok((await deps.listWorkSites.execute(actor)).map(toWorkSiteDto)),
    }),

    defineRoute({
      method: 'post',
      path: '/company/work-sites',
      summary: 'Crear una zona de trabajo',
      description:
        'Un círculo (centro y radio en metros) donde se espera que el empleado marque su entrada. ' +
        'Al marcar se guarda si cayó dentro o fuera; con `enforceWorkSites` fuera de una zona no deja marcar.',
      tags: COMPANY_TAGS,
      auth: Permission.COMPANY_SETTINGS_MANAGE,
      request: { body: createWorkSiteBody },
      responses: {
        201: { description: 'Zona creada', schema: dataResponse(workSiteSchema) },
        409: { description: 'Demasiadas zonas', errorCodes: ['WORK_SITE_LIMIT'] },
      },
      handler: async ({ actor, body, request }) =>
        created(
          toWorkSiteDto(await deps.createWorkSite.execute({ actor, client: request, ...body })),
        ),
    }),

    defineRoute({
      method: 'patch',
      path: '/company/work-sites/:id',
      summary: 'Editar o desactivar una zona de trabajo',
      tags: COMPANY_TAGS,
      auth: Permission.COMPANY_SETTINGS_MANAGE,
      request: { params: idParams, body: updateWorkSiteBody },
      responses: {
        200: { description: 'Zona actualizada', schema: dataResponse(workSiteSchema) },
        404: { description: 'Zona inexistente', errorCodes: ['WORK_SITE_NOT_FOUND'] },
        409: {
          description: 'Dejaría a la empresa sin zonas activas con la exigencia encendida',
          errorCodes: ['WORK_SITES_REQUIRED'],
        },
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          toWorkSiteDto(
            await deps.updateWorkSite.execute({
              actor,
              client: request,
              workSiteId: params.id,
              patch: body,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/company/employees',
      summary: 'Dar de alta un empleado',
      description:
        'Crea el empleado con su usuario y una contraseña temporal (se muestra una sola vez; ' +
        'deberá cambiarla al entrar). Respeta el límite de empleados activos de la empresa.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.EMPLOYEES_MANAGE,
      request: { body: createEmployeeBody },
      responses: {
        201: { description: 'Empleado creado', schema: dataResponse(employeeWithPasswordSchema) },
        400: EMPLOYEE_VALIDATION,
        409: {
          description: 'Límite alcanzado o email repetido',
          errorCodes: ['EMPLOYEE_LIMIT_REACHED', 'EMAIL_TAKEN'],
        },
      },
      handler: async ({ actor, body, request }) => {
        const result = await deps.createEmployee.execute({ actor, client: request, ...body });
        return created({
          employee: toEmployeeDto(result.employee),
          temporaryPassword: result.temporaryPassword,
          temporaryPasswordExpiresAt: result.temporaryPasswordExpiresAt.toISOString(),
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/employees',
      summary: 'Listar empleados',
      description: 'Ordenados por apellido y nombre.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.EMPLOYEES_MANAGE,
      request: { query: listEmployeesQuery },
      responses: {
        200: { description: 'Página de empleados', schema: pageResponse(employeeSchema) },
      },
      handler: async ({ actor, query }) => {
        const { page, limit, search, status } = query;
        const result = await deps.listEmployees.execute({
          actor,
          filter: { search, status },
          page: { page, limit },
        });
        return paginated(result.items.map(toEmployeeDto), result);
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/employees/:id',
      summary: 'Detalle de un empleado',
      tags: EMPLOYEE_TAGS,
      auth: Permission.EMPLOYEES_MANAGE,
      request: { params: idParams },
      responses: {
        200: { description: 'Empleado', schema: dataResponse(employeeSchema) },
        404: EMPLOYEE_NOT_FOUND,
      },
      handler: async ({ actor, params }) =>
        ok(toEmployeeDto(await deps.getEmployee.execute({ actor, employeeId: params.id }))),
    }),

    defineRoute({
      method: 'patch',
      path: '/company/employees/:id',
      summary: 'Editar un empleado',
      description:
        'Solo se modifican los campos enviados. `timezone: null` hace que herede la de la empresa.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.EMPLOYEES_MANAGE,
      request: { params: idParams, body: updateEmployeeBody },
      responses: {
        200: { description: 'Empleado actualizado', schema: dataResponse(employeeSchema) },
        400: EMPLOYEE_VALIDATION,
        404: EMPLOYEE_NOT_FOUND,
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          toEmployeeDto(
            await deps.updateEmployee.execute({
              actor,
              client: request,
              employeeId: params.id,
              patch: body,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'patch',
      path: '/company/employees/:id/status',
      summary: 'Activar o desactivar un empleado',
      description:
        'Desactivar le quita el acceso al instante y conserva su historial. ' +
        'Reactivar requiere lugar dentro del límite de la empresa.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.EMPLOYEES_MANAGE,
      request: { params: idParams, body: changeEmployeeStatusBody },
      responses: {
        200: { description: 'Estado actualizado', schema: dataResponse(employeeSchema) },
        404: EMPLOYEE_NOT_FOUND,
        400: { description: 'Fecha inválida', errorCodes: ['INVALID_STATUS_DATE'] },
        409: {
          description: 'Sin lugar para reactivar o la fecha cae en un periodo cerrado',
          errorCodes: ['EMPLOYEE_LIMIT_REACHED', 'STATUS_DATE_IN_CLOSED_PERIOD'],
        },
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          toEmployeeDto(
            await deps.changeEmployeeStatus.execute({
              actor,
              client: request,
              employeeId: params.id,
              status: body.status,
              effectiveOn: body.effectiveOn,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'delete',
      path: '/company/employees/:id',
      summary: 'Eliminar un empleado',
      description:
        'Solo funciona con un empleado que nunca registró horas ni reportes (por ejemplo un alta ' +
        'por error). Borra su cuenta y su historial de accesos, libera su correo y su lugar en el ' +
        'tope de empleados; su código no se reutiliza. Con historial responde `409 ' +
        'EMPLOYEE_HAS_HISTORY`: desactívalo en su lugar.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.EMPLOYEES_MANAGE,
      rateLimit: 'sensitive',
      request: { params: idParams },
      responses: {
        204: { description: 'Empleado eliminado' },
        404: EMPLOYEE_NOT_FOUND,
        409: {
          description: 'El empleado ya tiene historial',
          errorCodes: ['EMPLOYEE_HAS_HISTORY'],
        },
      },
      handler: async ({ actor, params, request }) => {
        await deps.deleteEmployee.execute({ actor, client: request, employeeId: params.id });
        return noContent();
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/employees/:id/pay-rates',
      summary: 'Sueldo de un empleado',
      description:
        'Historial de sueldo con la moneda de la empresa. Solo lo ven los admins; el empleado no.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.PAY_MANAGE,
      request: { params: idParams },
      responses: {
        200: { description: 'Historial de sueldo', schema: dataResponse(payRatesSchema) },
        404: EMPLOYEE_NOT_FOUND,
      },
      handler: async ({ actor, params }) =>
        ok(
          toPayRatesDto(await deps.listEmployeePayRates.execute({ actor, employeeId: params.id })),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/company/employees/:id/pay-rates',
      summary: 'Cambiar el sueldo de un empleado',
      description:
        'Agrega un cambio que rige desde `effectiveFrom` hasta el siguiente. Si ya hay uno con esa fecha, lo reemplaza. ' +
        'Por hora paga horas × tarifa; el sueldo fijo se reparte entre los 14 días del periodo y solo cuenta los días activos. ' +
        'Queda en la auditoría.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.PAY_MANAGE,
      rateLimit: 'sensitive',
      request: { params: idParams, body: setPayRateBody },
      responses: {
        200: { description: 'Historial actualizado', schema: dataResponse(payRatesSchema) },
        404: EMPLOYEE_NOT_FOUND,
        409: {
          description: 'La fecha cae en un periodo cerrado',
          errorCodes: ['PAY_RATE_IN_CLOSED_PERIOD'],
        },
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          toPayRatesDto(
            await deps.setEmployeePayRate.execute({
              actor,
              client: request,
              employeeId: params.id,
              ...body,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'delete',
      path: '/company/employees/:id/pay-rates/:rateId',
      summary: 'Quitar un cambio de sueldo',
      description:
        'Para corregir un cambio equivocado, por ejemplo con la fecha mal puesta. No se puede quitar uno ' +
        'que rige en un periodo cerrado (`locked`). Queda en la auditoría con el monto que tenía.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.PAY_MANAGE,
      rateLimit: 'sensitive',
      request: { params: payRateParams },
      responses: {
        200: { description: 'Historial actualizado', schema: dataResponse(payRatesSchema) },
        404: {
          description: 'El empleado o el cambio no existen en tu empresa',
          errorCodes: ['PAY_RATE_NOT_FOUND'],
        },
        409: {
          description: 'Rige en un periodo cerrado',
          errorCodes: ['PAY_RATE_IN_CLOSED_PERIOD'],
        },
      },
      handler: async ({ actor, params, request }) =>
        ok(
          toPayRatesDto(
            await deps.removeEmployeePayRate.execute({
              actor,
              client: request,
              employeeId: params.id,
              rateId: params.rateId,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/company/employees/:id/revoke-sessions',
      summary: 'Cerrar las sesiones de un empleado',
      description:
        'Cierra al instante todas las sesiones abiertas del empleado, por ejemplo si perdió su ' +
        'celular. No cambia su contraseña ni lo desactiva: puede iniciar sesión de nuevo.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.EMPLOYEES_MANAGE,
      rateLimit: 'sensitive',
      request: { params: idParams },
      responses: { 204: { description: 'Sesiones cerradas' }, 404: EMPLOYEE_NOT_FOUND },
      handler: async ({ actor, params, request }) => {
        await deps.revokeEmployeeSessions.execute({
          actor,
          client: request,
          employeeId: params.id,
        });
        return noContent();
      },
    }),

    defineRoute({
      method: 'post',
      path: '/company/employees/:id/reset-password',
      summary: 'Restablecer la contraseña de un empleado',
      description:
        'Genera una contraseña temporal (se muestra una sola vez), cierra sus sesiones y ' +
        'desbloquea su cuenta.',
      tags: EMPLOYEE_TAGS,
      auth: Permission.EMPLOYEES_MANAGE,
      request: { params: idParams },
      responses: {
        200: {
          description: 'Contraseña restablecida',
          schema: dataResponse(employeeWithPasswordSchema),
        },
        404: EMPLOYEE_NOT_FOUND,
      },
      handler: async ({ actor, params, request }) => {
        const result = await deps.resetEmployeePassword.execute({
          actor,
          client: request,
          employeeId: params.id,
        });
        return ok({
          employee: toEmployeeDto(result.employee),
          temporaryPassword: result.temporaryPassword,
          temporaryPasswordExpiresAt: result.temporaryPasswordExpiresAt.toISOString(),
        });
      },
    }),
  ];
}
