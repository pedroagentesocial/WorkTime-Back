import { Permission } from '#shared/domain/permissions.js';
import { created, defineRoute, ok, paginated, type AnyRoute } from '#shared/http/route.js';
import { dataResponse, idParams, pageResponse } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type {
  ClockInUseCase,
  ClockOutUseCase,
  GetClockStatusUseCase,
} from '../application/clock.use-cases.js';
import type {
  AdminClockInUseCase,
  AdminClockOutUseCase,
} from '../application/admin-clock.use-cases.js';
import type { GetAttendanceRosterUseCase } from '../application/attendance-roster.use-case.js';
import type { GetAttendanceSummaryUseCase } from '../application/attendance-summary.use-case.js';
import type {
  ListCompanyPendingReportsUseCase,
  ListMyPendingReportsUseCase,
} from '../application/pending-reports.use-cases.js';
import type {
  ListCompanyDailyReportsUseCase,
  ListDailyReportRevisionsUseCase,
  ListMyDailyReportsUseCase,
  SaveMyDailyReportUseCase,
} from '../application/daily-report.use-cases.js';
import type { CorrectTimeEntryUseCase } from '../application/correct-time-entry.use-case.js';
import type {
  ClosePayPeriodUseCase,
  GetPayPeriodStatusUseCase,
} from '../application/pay-period.use-cases.js';
import type { ListAttendanceActivityUseCase } from '../application/attendance-activity.use-case.js';
import type { VoidTimeEntryUseCase } from '../application/void-time-entry.use-case.js';
import type { CreateManualTimeEntryUseCase } from '../application/create-manual-time-entry.use-case.js';
import type {
  ExportCompanyTimesheetUseCase,
  GetCompanyTimesheetUseCase,
} from '../application/company-timesheet.use-cases.js';
import type {
  GetEmployeeTimesheetUseCase,
  GetMyTimesheetUseCase,
} from '../application/timesheet.use-cases.js';
import type {
  GetLiveAttendanceUseCase,
  GetTimeEntryUseCase,
  ListCompanyTimeEntriesUseCase,
  ListMyTimeEntriesUseCase,
  ListTimeEntryCorrectionsUseCase,
} from '../application/query-time-entries.use-cases.js';
import { companyTimesheetCsv } from './company-timesheet-csv.js';
import { centihoursToHours, durationSeconds, toDecimalHours } from '../domain/work-hours.js';
import {
  adminClockInBody,
  attendanceSummarySchema,
  clockOutBody,
  companyPendingReportSchema,
  companyPendingReportsQuery,
  myPendingReportsSchema,
  companyTimesheetExportQuery,
  companyTimesheetMetaSchema,
  companyTimesheetQuery,
  companyTimesheetRowSchema,
  activityDto,
  closePeriodBody,
  closureDto,
  closureSchema,
  payPeriodStatusDto,
  payPeriodStatusSchema,
  activityQuery,
  activitySchema,
  manualTimeEntryBody,
  voidTimeEntryBody,
  companyDailyReportDto,
  companyDailyReportSchema,
  companyDailyReportsQuery,
  dailyReportParams,
  dailyReportRevisionSchema,
  dailyReportsQuery,
  myDailyReportDto,
  myDailyReportSchema,
  saveDailyReportBody,
  rosterEntrySchema,
  rosterQuery,
  rosterRowDto,
  clockStatusSchema,
  companyEntryFromView,
  companyTimeEntriesQuery,
  companyTimeEntrySchema,
  correctionDto,
  correctionSchema,
  correctTimeEntryBody,
  liveAttendanceSchema,
  myEntryFromDomain,
  myEntryFromView,
  myTimeEntriesQuery,
  myTimeEntrySchema,
  timesheetQuery,
  timesheetSchema,
} from './timekeeping.schemas.js';

interface Deps {
  clockIn: ClockInUseCase;
  clockOut: ClockOutUseCase;
  getClockStatus: GetClockStatusUseCase;
  listMyTimeEntries: ListMyTimeEntriesUseCase;
  listCompanyTimeEntries: ListCompanyTimeEntriesUseCase;
  getTimeEntry: GetTimeEntryUseCase;
  listTimeEntryCorrections: ListTimeEntryCorrectionsUseCase;
  getLiveAttendance: GetLiveAttendanceUseCase;
  correctTimeEntry: CorrectTimeEntryUseCase;
  adminClockIn: AdminClockInUseCase;
  getAttendanceRoster: GetAttendanceRosterUseCase;
  saveMyDailyReport: SaveMyDailyReportUseCase;
  listMyDailyReports: ListMyDailyReportsUseCase;
  listCompanyDailyReports: ListCompanyDailyReportsUseCase;
  listDailyReportRevisions: ListDailyReportRevisionsUseCase;
  adminClockOut: AdminClockOutUseCase;
  getMyTimesheet: GetMyTimesheetUseCase;
  getEmployeeTimesheet: GetEmployeeTimesheetUseCase;
  createManualTimeEntry: CreateManualTimeEntryUseCase;
  voidTimeEntry: VoidTimeEntryUseCase;
  listAttendanceActivity: ListAttendanceActivityUseCase;
  getPayPeriodStatus: GetPayPeriodStatusUseCase;
  closePayPeriod: ClosePayPeriodUseCase;
  getAttendanceSummary: GetAttendanceSummaryUseCase;
  listMyPendingReports: ListMyPendingReportsUseCase;
  listCompanyPendingReports: ListCompanyPendingReportsUseCase;
  getCompanyTimesheet: GetCompanyTimesheetUseCase;
  exportCompanyTimesheet: ExportCompanyTimesheetUseCase;
}

const ME_TAGS = ['Empleado · Asistencia'];
const COMPANY_TAGS = ['Empresa · Asistencia'];
const NO_PROFILE = {
  description: 'Tu usuario no tiene perfil de empleado',
  errorCodes: ['EMPLOYEE_PROFILE_NOT_FOUND'],
};
const ENTRY_NOT_FOUND = {
  description: 'El registro no existe en tu empresa',
  errorCodes: ['TIME_ENTRY_NOT_FOUND'],
};

const withTotal = <T extends z.ZodType>(item: T) =>
  pageResponse(item).extend({
    meta: z.object({
      page: z.number().int(),
      limit: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
      totalHours: z.number().openapi({
        description:
          'Horas decimales trabajadas (registros cerrados) de TODO el filtro, no solo esta página. ' +
          'Suma de las horas ya redondeadas de cada registro',
      }),
    }),
  });

export function timekeepingRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'get',
      path: '/me/clock-status',
      summary: '¿Estoy trabajando?',
      description: 'Estado actual, entrada abierta (si hay) y hora del servidor.',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_CLOCK_OWN,
      responses: {
        200: { description: 'Estado', schema: dataResponse(clockStatusSchema) },
        404: NO_PROFILE,
      },
      handler: async ({ actor }) => {
        const status = await deps.getClockStatus.execute(actor);
        return ok({
          clockedIn: status.clockedIn,
          openEntry: status.openEntry ? myEntryFromDomain(status.openEntry) : null,
          serverTime: status.serverTime.toISOString(),
          dailyLimit: status.dailyLimit,
          dailyReport: status.dailyReport,
          pendingReports: status.pendingReports,
          canClockIn: status.canClockIn,
          elapsedSeconds: status.openEntry
            ? durationSeconds(status.openEntry.clockInAt, status.serverTime)
            : null,
          timezone: status.timezone,
        });
      },
    }),

    defineRoute({
      method: 'post',
      path: '/me/clock-in',
      summary: 'Marcar entrada',
      description:
        'La hora la registra el servidor (no se envía). Queda guardada la zona horaria del ' +
        'empleado y su día laboral local.',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_CLOCK_OWN,
      responses: {
        201: { description: 'Entrada registrada', schema: dataResponse(myTimeEntrySchema) },
        404: NO_PROFILE,
        409: {
          description:
            'Ya hay una entrada abierta, se alcanzó el límite diario o hay reportes pendientes (el error trae `details.dates`)',
          errorCodes: ['ALREADY_CLOCKED_IN', 'DAILY_LIMIT_REACHED', 'DAILY_REPORT_PENDING'],
        },
      },
      handler: async ({ actor }) => created(myEntryFromDomain(await deps.clockIn.execute(actor))),
    }),

    defineRoute({
      method: 'post',
      path: '/me/clock-out',
      summary: 'Marcar salida',
      description:
        'Si la empresa exige el reporte diario, hay que mandar `dailyReport` con lo que hiciste hoy. ' +
        'El reporte y la salida van juntos: si el reporte no es válido no se marca la salida. ' +
        'Si el límite diario ya cerró la entrada, la salida queda en ese instante y el reporte no se exige.',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_CLOCK_OWN,
      request: { body: clockOutBody },
      responses: {
        200: { description: 'Salida registrada', schema: dataResponse(myTimeEntrySchema) },
        400: {
          description: 'Falta el reporte del día o no es válido',
          errorCodes: ['DAILY_REPORT_REQUIRED', 'INVALID_DAILY_REPORT'],
        },
        404: NO_PROFILE,
        409: { description: 'No hay entrada abierta', errorCodes: ['NOT_CLOCKED_IN'] },
      },
      handler: async ({ actor, body }) =>
        ok(
          myEntryFromDomain(await deps.clockOut.execute({ actor, dailyReport: body?.dailyReport })),
        ),
    }),

    defineRoute({
      method: 'put',
      path: '/me/daily-reports/:date',
      summary: 'Escribir o corregir el reporte de un día',
      description:
        'Un reporte por día laboral. Se puede editar el mismo día (la versión anterior queda en el ' +
        'historial) o escribir uno pendiente de un día reciente (hasta 14 días atrás) con marcajes. ' +
        'Un reporte de un día anterior ya no se edita.',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_CLOCK_OWN,
      request: { params: dailyReportParams, body: saveDailyReportBody },
      responses: {
        200: { description: 'Reporte guardado', schema: dataResponse(myDailyReportSchema) },
        400: {
          description: 'Reporte o fecha inválidos',
          errorCodes: [
            'INVALID_DAILY_REPORT',
            'INVALID_REPORT_DATE',
            'NO_WORK_ON_DATE',
            'REPORT_DATE_TOO_OLD',
          ],
        },
        404: NO_PROFILE,
        409: {
          description: 'El reporte ya no se puede editar',
          errorCodes: ['DAILY_REPORT_LOCKED'],
        },
      },
      handler: async ({ actor, params, body }) =>
        ok(
          myDailyReportDto(
            await deps.saveMyDailyReport.execute({
              actor,
              workDate: params.date,
              content: body.content,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/me/daily-reports/pending',
      summary: 'Mis reportes pendientes',
      description:
        'Días anteriores con marcajes y sin reporte, de los últimos 14. Mientras haya alguno no se ' +
        'puede marcar entrada; se escriben con `PUT /me/daily-reports/{date}`. El de hoy no cuenta: ' +
        'se exige al marcar la salida.',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_READ_OWN,
      responses: {
        200: { description: 'Pendientes', schema: dataResponse(myPendingReportsSchema) },
        404: NO_PROFILE,
      },
      handler: async ({ actor }) => ok(await deps.listMyPendingReports.execute(actor)),
    }),

    defineRoute({
      method: 'get',
      path: '/me/daily-reports',
      summary: 'Mis reportes del día',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_READ_OWN,
      request: { query: dailyReportsQuery },
      responses: {
        200: { description: 'Reportes', schema: pageResponse(myDailyReportSchema) },
        400: { description: 'Rango inválido', errorCodes: ['INVALID_DATE_RANGE'] },
        404: NO_PROFILE,
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const result = await deps.listMyDailyReports.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(result.items.map(myDailyReportDto), result);
      },
    }),

    defineRoute({
      method: 'get',
      path: '/me/timesheet',
      summary: 'Mi hoja de tiempo del periodo',
      description:
        'Periodo de pago de 14 días (lunes a domingo) con una fila por día, su día de la semana ' +
        'y las horas decimales de ese día. Varios marcajes del mismo día se suman. Sin `date` ' +
        'devuelve el periodo actual; `previousPeriodStart` y `nextPeriodStart` sirven para navegar.',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_READ_OWN,
      request: { query: timesheetQuery },
      responses: {
        200: { description: 'Hoja de tiempo', schema: dataResponse(timesheetSchema) },
        404: NO_PROFILE,
      },
      handler: async ({ actor, query }) =>
        ok(await deps.getMyTimesheet.execute({ actor, date: query.date })),
    }),

    defineRoute({
      method: 'get',
      path: '/me/time-entries',
      summary: 'Mi historial de asistencia',
      description:
        'Filtra por día laboral (`from`/`to`, inclusive). `meta.totalHours` suma las horas ' +
        'decimales trabajadas de todo el rango.',
      tags: ME_TAGS,
      auth: Permission.ATTENDANCE_READ_OWN,
      request: { query: myTimeEntriesQuery },
      responses: {
        200: { description: 'Registros', schema: withTotal(myTimeEntrySchema) },
        400: { description: 'Rango inválido', errorCodes: ['INVALID_DATE_RANGE'] },
        404: NO_PROFILE,
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const result = await deps.listMyTimeEntries.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(result.items.map(myEntryFromView), result, {
          totalHours: centihoursToHours(result.totalCentihours),
        });
      },
    }),

    defineRoute({
      method: 'post',
      path: '/company/employees/:id/clock-in',
      summary: 'Marcar entrada a un empleado',
      description:
        'La hora la pone el servidor. Queda auditado quién lo hizo y el marcaje se ve como "admin". ' +
        'Si el empleado ya alcanzó su límite diario responde 409 `DAILY_LIMIT_REACHED`; con ' +
        '`overrideDailyLimit: true` se autoriza trabajar por encima del límite.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_CLOCK_EMPLOYEES,
      request: { params: idParams, body: adminClockInBody },
      responses: {
        201: { description: 'Entrada registrada', schema: dataResponse(myTimeEntrySchema) },
        404: { description: 'Empleado inexistente', errorCodes: ['EMPLOYEE_NOT_FOUND'] },
        409: {
          description: 'No se puede marcar entrada',
          errorCodes: ['EMPLOYEE_ALREADY_CLOCKED_IN', 'EMPLOYEE_INACTIVE', 'DAILY_LIMIT_REACHED'],
        },
      },
      handler: async ({ actor, params, body, request }) =>
        created(
          myEntryFromDomain(
            await deps.adminClockIn.execute({
              actor,
              client: request,
              employeeId: params.id,
              overrideDailyLimit: body.overrideDailyLimit,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/company/employees/:id/clock-out',
      summary: 'Marcar salida a un empleado',
      description:
        'La hora la pone el servidor. Queda auditado quién lo hizo y el marcaje muestra `closedBy: admin`.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_CLOCK_EMPLOYEES,
      request: { params: idParams },
      responses: {
        200: { description: 'Salida registrada', schema: dataResponse(myTimeEntrySchema) },
        404: { description: 'Empleado inexistente', errorCodes: ['EMPLOYEE_NOT_FOUND'] },
        409: {
          description: 'El empleado no tiene entrada abierta',
          errorCodes: ['EMPLOYEE_NOT_CLOCKED_IN'],
        },
      },
      handler: async ({ actor, params, request }) =>
        ok(
          myEntryFromDomain(
            await deps.adminClockOut.execute({ actor, client: request, employeeId: params.id }),
          ),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/company/daily-reports/pending',
      summary: 'Quién debe reportes del día',
      description:
        'Empleados activos con reportes pendientes y los días que les faltan, de los últimos 14 ' +
        'días. Solo si la empresa exige el reporte (`meta.required`). Filtra por `employeeId`.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      rateLimit: 'heavyRead',
      request: { query: companyPendingReportsQuery },
      responses: {
        200: {
          description: 'Pendientes',
          schema: pageResponse(companyPendingReportSchema).extend({
            meta: z.object({
              page: z.number().int(),
              limit: z.number().int(),
              total: z.number().int(),
              totalPages: z.number().int(),
              required: z.boolean(),
            }),
          }),
        },
        404: { description: 'Empleado inexistente', errorCodes: ['EMPLOYEE_NOT_FOUND'] },
      },
      handler: async ({ actor, query }) => {
        const result = await deps.listCompanyPendingReports.execute({
          actor,
          employeeId: query.employeeId,
          page: { page: query.page, limit: query.limit },
        });
        return paginated(
          result.items.map(({ employee, days }) => ({
            employee: {
              id: employee.employeeId,
              firstName: employee.firstName,
              lastName: employee.lastName,
              employeeCode: employee.employeeCode,
            },
            days,
          })),
          result,
          { required: result.required },
        );
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/daily-reports',
      summary: 'Reportes del día de los empleados',
      description: 'Filtra por empleado y día laboral (`from`/`to`, inclusive).',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      request: { query: companyDailyReportsQuery },
      responses: {
        200: { description: 'Reportes', schema: pageResponse(companyDailyReportSchema) },
        400: { description: 'Rango inválido', errorCodes: ['INVALID_DATE_RANGE'] },
        404: { description: 'Empleado inexistente', errorCodes: ['EMPLOYEE_NOT_FOUND'] },
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const result = await deps.listCompanyDailyReports.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(result.items.map(companyDailyReportDto), result);
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/daily-reports/:id/revisions',
      summary: 'Versiones anteriores de un reporte',
      description: 'Las más recientes primero. Cada una trae cuándo fue reemplazada.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      request: { params: idParams },
      responses: {
        200: {
          description: 'Versiones',
          schema: dataResponse(z.array(dailyReportRevisionSchema)),
        },
        404: {
          description: 'El reporte no existe en tu empresa',
          errorCodes: ['DAILY_REPORT_NOT_FOUND'],
        },
      },
      handler: async ({ actor, params }) => {
        const revisions = await deps.listDailyReportRevisions.execute({
          actor,
          reportId: params.id,
        });
        return ok(revisions.map((r) => ({ ...r, savedAt: r.savedAt.toISOString() })));
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/activity',
      summary: 'Actividad del admin sobre la asistencia',
      description:
        'Quién marcó entrada o salida por un empleado, creó registros manuales, corrigió o anuló ' +
        'registros, y cuándo, con el motivo cuando lo hay. Lo más reciente primero. Filtra por ' +
        'empleado afectado, tipo y rango de instantes (`from` y `to`, UTC o local con desfase).',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      rateLimit: 'heavyRead',
      request: { query: activityQuery },
      responses: {
        200: { description: 'Actividad', schema: pageResponse(activitySchema) },
        400: { description: 'Rango inválido', errorCodes: ['INVALID_DATE_RANGE'] },
        404: { description: 'Empleado inexistente', errorCodes: ['EMPLOYEE_NOT_FOUND'] },
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const result = await deps.listAttendanceActivity.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(result.items.map(activityDto), result);
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/attendance/summary',
      summary: 'Resumen del día',
      description:
        'Pantalla de inicio del admin: empleados activos, cuántos están IN y OUT, horas trabajadas ' +
        'hoy por todos (cada empleado en su día local), quiénes alcanzaron su límite diario y ' +
        'cuántos reportes están pendientes. El detalle de pendientes está en ' +
        '`GET /company/daily-reports/pending`.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      rateLimit: 'heavyRead',
      responses: { 200: { description: 'Resumen', schema: dataResponse(attendanceSummarySchema) } },
      handler: async ({ actor }) => {
        const summary = await deps.getAttendanceSummary.execute(actor);
        return ok({
          asOf: summary.asOf.toISOString(),
          employees: summary.employees,
          worked: {
            seconds: summary.workedTodaySeconds,
            hours: toDecimalHours(summary.workedTodaySeconds),
          },
          atLimit: {
            count: summary.atLimit.length,
            employees: summary.atLimit.map(({ employee, limitMinutes, workedSeconds }) => ({
              id: employee.employeeId,
              firstName: employee.firstName,
              lastName: employee.lastName,
              employeeCode: employee.employeeCode,
              limitMinutes,
              workedSeconds,
            })),
          },
          pendingReports: summary.pendingReports,
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/attendance/roster',
      summary: 'Empleados con su estado IN / OUT',
      description:
        'Lista paginada de empleados activos, cada uno con `status` (`in` trabajando, `out` fuera), ' +
        'lo trabajado hoy y su límite diario. Filtra por `status` y busca por nombre, email o código. ' +
        'Para cambiar el estado usa `POST /company/employees/{id}/clock-in` o `/clock-out`.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      request: { query: rosterQuery },
      responses: {
        200: {
          description: 'Empleados',
          schema: pageResponse(rosterEntrySchema).extend({
            meta: z.object({
              page: z.number().int(),
              limit: z.number().int(),
              total: z.number().int(),
              totalPages: z.number().int(),
              asOf: z.iso.datetime(),
            }),
          }),
        },
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const roster = await deps.getAttendanceRoster.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(roster.items.map(rosterRowDto), roster, {
          asOf: roster.asOf.toISOString(),
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/attendance/live',
      summary: 'Quién está trabajando ahora',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      responses: { 200: { description: 'En turno', schema: dataResponse(liveAttendanceSchema) } },
      handler: async ({ actor }) => {
        const { asOf, entries } = await deps.getLiveAttendance.execute(actor);
        return ok({
          asOf: asOf.toISOString(),
          working: entries.length,
          entries: entries.map((entry) => {
            const elapsedSeconds = durationSeconds(entry.clockInAt, asOf);
            return {
              ...companyEntryFromView(entry),
              elapsedSeconds,
              elapsedHours: toDecimalHours(elapsedSeconds),
            };
          }),
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/employees/:id/timesheet',
      summary: 'Hoja de tiempo de un empleado',
      description: 'Igual que `/me/timesheet`, pero de cualquier empleado de la empresa.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      request: { params: idParams, query: timesheetQuery },
      responses: {
        200: { description: 'Hoja de tiempo', schema: dataResponse(timesheetSchema) },
        404: { description: 'Empleado inexistente', errorCodes: ['EMPLOYEE_NOT_FOUND'] },
      },
      handler: async ({ actor, params, query }) =>
        ok(
          await deps.getEmployeeTimesheet.execute({
            actor,
            employeeId: params.id,
            date: query.date,
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/company/employees/:id/time-entries',
      summary: 'Crear un registro manual',
      description:
        'El admin registra una jornada pasada que nadie marcó, con entrada y salida. Solo de los ' +
        'últimos 14 días, sin horas futuras y sin cruzarse con otro registro del empleado. El ' +
        'motivo es obligatorio y queda auditado; el registro se ve como "admin". Acepta horas en ' +
        'UTC o locales con desfase.',
      tags: COMPANY_TAGS,
      auth: Permission.TIME_ENTRIES_CORRECT,
      request: { params: idParams, body: manualTimeEntryBody },
      responses: {
        201: { description: 'Registro creado', schema: dataResponse(companyTimeEntrySchema) },
        400: {
          description: 'Horas o motivo inválidos',
          errorCodes: [
            'INVALID_TIME_RANGE',
            'TIME_IN_FUTURE',
            'MANUAL_ENTRY_TOO_OLD',
            'INVALID_REASON',
          ],
        },
        404: { description: 'Empleado inexistente', errorCodes: ['EMPLOYEE_NOT_FOUND'] },
        409: {
          description: 'Se cruza con otro registro o su periodo está cerrado',
          errorCodes: ['TIME_ENTRY_OVERLAP', 'PERIOD_CLOSED'],
        },
      },
      handler: async ({ actor, params, body, request }) =>
        created(
          companyEntryFromView(
            await deps.createManualTimeEntry.execute({
              actor,
              client: request,
              employeeId: params.id,
              ...body,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/company/timesheet',
      summary: 'Hoja de tiempo de todos los empleados',
      description:
        'Periodo de pago de 14 días con una fila por empleado y una cifra de horas por día ' +
        '(`meta.days` da las fechas en el mismo orden), más los totales de toda la empresa. ' +
        'Incluye a los empleados activos y a los desactivados que trabajaron en el periodo. ' +
        'Solo cuentan los marcajes cerrados. Sin `date` devuelve el periodo actual.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      rateLimit: 'heavyRead',
      request: { query: companyTimesheetQuery },
      responses: {
        200: {
          description: 'Hoja de tiempo',
          schema: z.object({
            data: z.array(companyTimesheetRowSchema),
            meta: companyTimesheetMetaSchema,
          }),
        },
      },
      handler: async ({ actor, query }) => {
        const { page, limit, date, search } = query;
        const sheet = await deps.getCompanyTimesheet.execute({
          actor,
          date,
          search,
          page: { page, limit },
        });
        return paginated(sheet.rows, sheet, {
          period: sheet.period,
          previousPeriodStart: sheet.previousPeriodStart,
          nextPeriodStart: sheet.nextPeriodStart,
          days: sheet.days,
          closed: sheet.closure ? closureDto(sheet.closure) : null,
          totals: sheet.totals,
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/periods',
      summary: 'Estado de un periodo de pago',
      description:
        'Si el periodo está abierto o cerrado, si ya terminó, qué impide cerrarlo (entradas sin ' +
        'salida), cuántos reportes faltan (solo avisa) y el total de horas. `canClose` dice si se ' +
        'puede cerrar ahora. Sin `date` usa el periodo actual.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      rateLimit: 'heavyRead',
      request: { query: timesheetQuery },
      responses: { 200: { description: 'Estado', schema: dataResponse(payPeriodStatusSchema) } },
      handler: async ({ actor, query }) =>
        ok(payPeriodStatusDto(await deps.getPayPeriodStatus.execute({ actor, date: query.date }))),
    }),

    defineRoute({
      method: 'post',
      path: '/company/periods/close',
      summary: 'Cerrar un periodo de pago',
      description:
        '**Definitivo:** las horas del periodo quedan congeladas y no hay forma de reabrirlo. ' +
        'Después no se puede corregir, crear ni anular ningún registro de esos días (409 ' +
        '`PERIOD_CLOSED`); los reportes del día sí se siguen escribiendo. Solo se cierra un ' +
        'periodo que ya terminó y sin entradas abiertas. Los reportes pendientes no lo impiden. ' +
        'Queda guardado el total de horas al cerrar, quién y cuándo.',
      tags: COMPANY_TAGS,
      auth: Permission.PERIODS_MANAGE,
      rateLimit: 'sensitive',
      request: { body: closePeriodBody },
      responses: {
        201: { description: 'Periodo cerrado', schema: dataResponse(closureSchema) },
        409: {
          description: 'No se puede cerrar',
          errorCodes: ['PERIOD_NOT_FINISHED', 'PERIOD_ALREADY_CLOSED', 'PERIOD_HAS_OPEN_ENTRIES'],
        },
      },
      handler: async ({ actor, body, request }) =>
        created(
          closureDto(
            await deps.closePayPeriod.execute({ actor, client: request, date: body.date }),
          ),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/company/timesheet/export',
      summary: 'Exportar la hoja de tiempo a CSV',
      description:
        'La misma tabla de `/company/timesheet`, de todos los empleados y sin paginar, como ' +
        'archivo CSV (UTF-8, horas con 2 decimales).',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      rateLimit: 'export',
      request: { query: companyTimesheetExportQuery },
      responses: { 200: { description: 'Archivo CSV', contentType: 'text/csv' } },
      handler: async ({ actor, query }) => {
        const sheet = await deps.exportCompanyTimesheet.execute({
          actor,
          date: query.date,
          search: query.search,
        });
        return {
          status: 200,
          body: companyTimesheetCsv(sheet),
          contentType: 'text/csv; charset=utf-8',
          headers: {
            'Content-Disposition': `attachment; filename="hoja-de-tiempo-${sheet.period.start}_${sheet.period.end}.csv"`,
          },
        };
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/time-entries',
      summary: 'Registros de asistencia de la empresa',
      description:
        'Filtra por empleado, día laboral (`from`/`to`) y estado. Cada empleado se agrupa en sus ' +
        'días locales aunque estén en zonas horarias distintas.',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      request: { query: companyTimeEntriesQuery },
      responses: {
        200: { description: 'Registros', schema: withTotal(companyTimeEntrySchema) },
        400: { description: 'Rango inválido', errorCodes: ['INVALID_DATE_RANGE'] },
        404: { description: 'Empleado inexistente', errorCodes: ['EMPLOYEE_NOT_FOUND'] },
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const result = await deps.listCompanyTimeEntries.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(result.items.map(companyEntryFromView), result, {
          totalHours: centihoursToHours(result.totalCentihours),
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/time-entries/:id',
      summary: 'Detalle de un registro',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      request: { params: idParams },
      responses: {
        200: { description: 'Registro', schema: dataResponse(companyTimeEntrySchema) },
        404: ENTRY_NOT_FOUND,
      },
      handler: async ({ actor, params }) =>
        ok(
          companyEntryFromView(await deps.getTimeEntry.execute({ actor, timeEntryId: params.id })),
        ),
    }),

    defineRoute({
      method: 'patch',
      path: '/company/time-entries/:id',
      summary: 'Corregir un registro',
      description:
        'Cambia la entrada y/o la salida (también sirve para cerrar una entrada olvidada). ' +
        'El motivo es obligatorio; el valor anterior queda guardado y el empleado ve que fue ' +
        'corregido. Acepta horas en UTC o locales con desfase.',
      tags: COMPANY_TAGS,
      auth: Permission.TIME_ENTRIES_CORRECT,
      request: { params: idParams, body: correctTimeEntryBody },
      responses: {
        200: { description: 'Registro corregido', schema: dataResponse(companyTimeEntrySchema) },
        400: {
          description: 'Corrección inválida',
          errorCodes: ['INVALID_TIME_RANGE', 'TIME_IN_FUTURE', 'NO_CHANGES', 'INVALID_REASON'],
        },
        404: ENTRY_NOT_FOUND,
        409: {
          description: 'Se cruza con otro registro',
          errorCodes: [
            'TIME_ENTRY_OVERLAP',
            'TIME_ENTRY_CHANGED',
            'TIME_ENTRY_VOIDED',
            'PERIOD_CLOSED',
          ],
        },
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          companyEntryFromView(
            await deps.correctTimeEntry.execute({
              actor,
              client: request,
              timeEntryId: params.id,
              ...body,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/company/time-entries/:id/void',
      summary: 'Anular un registro',
      description:
        'Deja de contar en todo: horas, límite diario, hojas de tiempo, reportes pendientes, cruces ' +
        'y estado IN/OUT. No se borra: queda con quién lo anuló, cuándo y por qué, y el admin lo ve ' +
        'con `status: voided` (lista con `status=voided`). El empleado ya no lo ve. No se puede ' +
        'deshacer: si fue un error, se crea de nuevo con el registro manual. Si estaba abierto, el ' +
        'empleado queda libre para marcar entrada.',
      tags: COMPANY_TAGS,
      auth: Permission.TIME_ENTRIES_CORRECT,
      request: { params: idParams, body: voidTimeEntryBody },
      responses: {
        200: { description: 'Registro anulado', schema: dataResponse(companyTimeEntrySchema) },
        400: { description: 'Motivo inválido', errorCodes: ['INVALID_REASON'] },
        404: ENTRY_NOT_FOUND,
        409: {
          description: 'Ya estaba anulado o su periodo está cerrado',
          errorCodes: ['TIME_ENTRY_VOIDED', 'PERIOD_CLOSED'],
        },
      },
      handler: async ({ actor, params, body, request }) =>
        ok(
          companyEntryFromView(
            await deps.voidTimeEntry.execute({
              actor,
              client: request,
              timeEntryId: params.id,
              reason: body.reason,
            }),
          ),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/company/time-entries/:id/corrections',
      summary: 'Historial de correcciones de un registro',
      tags: COMPANY_TAGS,
      auth: Permission.ATTENDANCE_READ_ALL,
      request: { params: idParams },
      responses: {
        200: { description: 'Correcciones', schema: dataResponse(z.array(correctionSchema)) },
        404: ENTRY_NOT_FOUND,
      },
      handler: async ({ actor, params }) =>
        ok(
          (await deps.listTimeEntryCorrections.execute({ actor, timeEntryId: params.id })).map(
            correctionDto,
          ),
        ),
    }),
  ];
}
