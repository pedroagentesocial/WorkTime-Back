import { Permission } from '#shared/domain/permissions.js';
import { created, defineRoute, ok, paginated, type AnyRoute } from '#shared/http/route.js';
import { dataResponse, idParams, pageResponse } from '#shared/http/schemas.js';
import type {
  CreateCheckInUseCase,
  ListCompanyCheckInsUseCase,
  ListMyCheckInsUseCase,
  VoidCheckInUseCase,
} from '../application/check-in.use-cases.js';
import {
  companyCheckInDto,
  companyCheckInSchema,
  companyCheckInsQuery,
  createCheckInBody,
  myCheckInDto,
  myCheckInSchema,
  myCheckInsQuery,
  voidCheckInBody,
} from './check-in.schemas.js';

interface Deps {
  createCheckIn: CreateCheckInUseCase;
  listMyCheckIns: ListMyCheckInsUseCase;
  listCompanyCheckIns: ListCompanyCheckInsUseCase;
  voidCheckIn: VoidCheckInUseCase;
}

const ME_TAGS = ['Empleado · Check-ins'];
const COMPANY_TAGS = ['Empresa · Check-ins'];
const NO_PROFILE = {
  description: 'Tu usuario no tiene perfil de empleado',
  errorCodes: ['EMPLOYEE_PROFILE_NOT_FOUND'],
};

export function checkInRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'post',
      path: '/me/check-ins',
      summary: 'Registrar llegada (check-in)',
      description:
        'Deja constancia de que el empleado llegó a un lugar, con la hora del servidor y la ' +
        'ubicación del dispositivo (`latitude`, `longitude` y `accuracyMeters`, obligatorias) y una ' +
        'nota opcional. No marca entrada ni salida y no cuenta horas: funciona con o sin la entrada ' +
        'marcada. Se guarda si cayó dentro o fuera de una zona de trabajo, sin bloquear. La empresa ' +
        'debe tenerlo activado (`allowCheckIns`); hasta 50 por día.',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_CLOCK_OWN,
      request: { body: createCheckInBody },
      responses: {
        201: { description: 'Llegada registrada', schema: dataResponse(myCheckInSchema) },
        400: {
          description: 'Falta la ubicación, no es válida o la nota es muy larga',
          errorCodes: ['LOCATION_REQUIRED', 'INVALID_LOCATION', 'INVALID_CHECK_IN_NOTE'],
        },
        404: NO_PROFILE,
        409: {
          description: 'La empresa no lo tiene activado o ya se llegó al máximo del día',
          errorCodes: ['CHECK_INS_DISABLED', 'CHECK_IN_LIMIT_REACHED'],
        },
      },
      handler: async ({ actor, body }) => {
        const { latitude, longitude, accuracyMeters, note } = body ?? {};
        const location =
          latitude !== undefined && longitude !== undefined && accuracyMeters !== undefined
            ? { latitude, longitude, accuracyMeters }
            : undefined;
        return created(myCheckInDto(await deps.createCheckIn.execute({ actor, location, note })));
      },
    }),

    defineRoute({
      method: 'get',
      path: '/me/check-ins',
      summary: 'Mis check-ins',
      description:
        'Tus llegadas registradas, las más recientes primero. Filtra por día laboral con `from`/`to`. ' +
        'Los que anuló el administrador no aparecen.',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_READ_OWN,
      request: { query: myCheckInsQuery },
      responses: {
        200: { description: 'Check-ins', schema: pageResponse(myCheckInSchema) },
        400: { description: 'Rango inválido', errorCodes: ['INVALID_DATE_RANGE'] },
        404: NO_PROFILE,
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const result = await deps.listMyCheckIns.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(result.items.map(myCheckInDto), result);
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/check-ins',
      summary: 'Check-ins de los empleados',
      description:
        'Llegadas registradas por los empleados, las más recientes primero, con ubicación, zona y ' +
        'nota. Filtra por `employeeId`, día laboral (`from`/`to`), `location=outside` y ' +
        '`status=voided` para ver los anulados.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      request: { query: companyCheckInsQuery },
      responses: {
        200: { description: 'Check-ins', schema: pageResponse(companyCheckInSchema) },
        400: { description: 'Rango inválido', errorCodes: ['INVALID_DATE_RANGE'] },
        404: { description: 'Empleado inexistente', errorCodes: ['EMPLOYEE_NOT_FOUND'] },
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const result = await deps.listCompanyCheckIns.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(result.items.map(companyCheckInDto), result);
      },
    }),

    defineRoute({
      method: 'post',
      path: '/company/check-ins/:id/void',
      summary: 'Anular un check-in',
      description:
        'Para un check-in registrado por error. No se borra: queda con quién lo anuló, cuándo y por ' +
        'qué, deja de verse en listas y mapas y el empleado ya no lo ve. No se puede deshacer.',
      tags: COMPANY_TAGS,
      auth: Permission.TIME_ENTRIES_CORRECT,
      request: { params: idParams, body: voidCheckInBody },
      responses: {
        200: { description: 'Check-in anulado', schema: dataResponse(companyCheckInSchema) },
        400: { description: 'Motivo inválido', errorCodes: ['INVALID_REASON'] },
        404: {
          description: 'El check-in no existe en tu empresa',
          errorCodes: ['CHECK_IN_NOT_FOUND'],
        },
        409: { description: 'Ya estaba anulado', errorCodes: ['CHECK_IN_VOIDED'] },
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          companyCheckInDto(
            await deps.voidCheckIn.execute({
              actor,
              client: request,
              checkInId: params.id,
              reason: body.reason,
            }),
          ),
        ),
    }),
  ];
}
