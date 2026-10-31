import { Permission } from '#shared/domain/permissions.js';
import { defineRoute, ok, paginated, type AnyRoute } from '#shared/http/route.js';
import { dataResponse } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type { GetPortfolioAttendanceMapUseCase } from '../application/attendance-map.use-cases.js';
import type { GetPortfolioLiveUseCase } from '../application/portfolio-live.use-case.js';
import type { GetPortfolioSummaryUseCase } from '../application/portfolio-summary.use-case.js';
import type {
  ExportPortfolioDailyReportsUseCase,
  ListPortfolioDailyReportsUseCase,
} from '../application/portfolio-daily-reports.use-cases.js';
import type {
  ExportPortfolioTimesheetUseCase,
  GetPortfolioTimesheetUseCase,
} from '../application/portfolio-timesheet.use-cases.js';
import { portfolioDailyReportsCsv, portfolioTimesheetCsv } from './portfolio-csv.js';
import {
  portfolioAttendanceMapQuery,
  portfolioDailyReportSchema,
  portfolioDailyReportsExportQuery,
  portfolioDailyReportsQuery,
  portfolioLiveQuery,
  portfolioLiveSchema,
  portfolioSummaryQuery,
  portfolioSummarySchema,
  portfolioTimesheetExportQuery,
  portfolioTimesheetMetaSchema,
  portfolioTimesheetQuery,
  portfolioTimesheetRowSchema,
  toPortfolioDailyReportDto,
  toPortfolioLiveDto,
  toPortfolioSummaryDto,
} from './portfolio.schemas.js';
import { pageResponse } from '#shared/http/schemas.js';
import { attendanceMapSchema, toAttendanceMapDto } from './timekeeping.schemas.js';

interface Deps {
  getPortfolioSummary: GetPortfolioSummaryUseCase;
  getPortfolioLive: GetPortfolioLiveUseCase;
  getPortfolioAttendanceMap: GetPortfolioAttendanceMapUseCase;
  getPortfolioTimesheet: GetPortfolioTimesheetUseCase;
  exportPortfolioTimesheet: ExportPortfolioTimesheetUseCase;
  listPortfolioDailyReports: ListPortfolioDailyReportsUseCase;
  exportPortfolioDailyReports: ExportPortfolioDailyReportsUseCase;
}

const TAGS = ['Admin multiempresa · Todas mis empresas'];
const AUTH = Permission.PORTFOLIO_READ;
const NOT_FOUND = {
  description: 'La empresa no existe o no es tuya',
  errorCodes: ['COMPANY_NOT_FOUND'],
};

// Vistas de solo lectura que reunen las empresas activas de la persona. No dependen de la empresa
// activa de la sesion
export function portfolioRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'get',
      path: '/portfolio/summary',
      summary: 'Panel de todas mis empresas',
      description:
        'Empleados activos, IN y OUT, horas de hoy y del periodo, límites alcanzados y reportes ' +
        'pendientes, en total y por empresa. Solo cuenta las empresas activas; las suspendidas ' +
        'quedan fuera.',
      tags: TAGS,
      auth: AUTH,
      rateLimit: 'heavyRead',
      request: { query: portfolioSummaryQuery },
      responses: {
        200: { description: 'Resumen', schema: dataResponse(portfolioSummarySchema) },
        404: NOT_FOUND,
      },
      handler: async ({ actor, query }) =>
        ok(
          toPortfolioSummaryDto(
            await deps.getPortfolioSummary.execute({ actor, companyId: query.companyId }),
          ),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/portfolio/attendance/live',
      summary: 'Quién está trabajando ahora en todas mis empresas, y desde dónde',
      description:
        'Una fila por empleado con la entrada abierta, con su empresa y el punto donde marcó ' +
        '(`clockInLocation`, null si la registró un admin). Sirve para el mapa. Solo cuenta las ' +
        'empresas activas.',
      tags: TAGS,
      auth: AUTH,
      rateLimit: 'heavyRead',
      request: { query: portfolioLiveQuery },
      responses: {
        200: { description: 'Quién trabaja ahora', schema: dataResponse(portfolioLiveSchema) },
        404: NOT_FOUND,
      },
      handler: async ({ actor, query }) =>
        ok(
          toPortfolioLiveDto(
            await deps.getPortfolioLive.execute({ actor, companyId: query.companyId }),
          ),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/portfolio/attendance/map',
      summary: 'Dónde marcó la entrada cada empleado de todas mis empresas',
      description:
        'Marcajes con ubicación en un rango de días laborales (`from`/`to`), los más recientes ' +
        'primero, con empresa, empleado, dentro o fuera de zona y si siguen abiertos. Devuelve ' +
        'hasta 500 puntos y `truncated` avisa si había más. Acota con `companyId` o `employeeId`. ' +
        'Solo cuenta las empresas activas.',
      tags: TAGS,
      auth: AUTH,
      rateLimit: 'heavyRead',
      request: { query: portfolioAttendanceMapQuery },
      responses: {
        200: { description: 'Puntos del mapa', schema: dataResponse(attendanceMapSchema) },
        400: { description: 'Rango inválido', errorCodes: ['INVALID_DATE_RANGE'] },
        404: NOT_FOUND,
      },
      handler: async ({ actor, query }) => {
        const { companyId, ...filter } = query;
        return ok(
          toAttendanceMapDto(
            await deps.getPortfolioAttendanceMap.execute({ actor, filter, companyId }),
          ),
        );
      },
    }),

    defineRoute({
      method: 'get',
      path: '/portfolio/timesheet',
      summary: 'Horas de todos mis empleados',
      description:
        'Periodo de pago de 14 días con una fila por empleado de todas mis empresas activas, con su ' +
        'empresa, y los totales de todos. Solo cuentan los marcajes cerrados. Sin `date` devuelve el ' +
        'periodo actual (el de la empresa más atrasada en el calendario).',
      tags: TAGS,
      auth: AUTH,
      rateLimit: 'heavyRead',
      request: { query: portfolioTimesheetQuery },
      responses: {
        200: {
          description: 'Hoja de tiempo',
          schema: z.object({
            data: z.array(portfolioTimesheetRowSchema),
            meta: portfolioTimesheetMetaSchema,
          }),
        },
        404: NOT_FOUND,
      },
      handler: async ({ actor, query }) => {
        const { page, limit, date, search, companyId } = query;
        const sheet = await deps.getPortfolioTimesheet.execute({
          actor,
          date,
          search,
          companyId,
          page: { page, limit },
        });
        const rows = sheet.rows.map(({ company, employee, hours, totalHours, openEntries }) => ({
          company,
          employee,
          hours,
          totalHours,
          openEntries,
        }));
        return paginated(rows, sheet, {
          period: sheet.period,
          previousPeriodStart: sheet.previousPeriodStart,
          nextPeriodStart: sheet.nextPeriodStart,
          days: sheet.days,
          totals: sheet.totals,
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/portfolio/timesheet/export',
      summary: 'Exportar las horas de todas mis empresas a CSV',
      description:
        'La misma tabla de `/portfolio/timesheet`, sin paginar, como archivo CSV (UTF-8, horas con ' +
        '2 decimales) con la empresa de cada empleado en las primeras columnas.',
      tags: TAGS,
      auth: AUTH,
      rateLimit: 'export',
      request: { query: portfolioTimesheetExportQuery },
      responses: {
        200: { description: 'Archivo CSV', contentType: 'text/csv' },
        404: NOT_FOUND,
      },
      handler: async ({ actor, query }) => {
        const sheet = await deps.exportPortfolioTimesheet.execute({ actor, ...query });
        return {
          status: 200,
          body: portfolioTimesheetCsv(sheet),
          contentType: 'text/csv; charset=utf-8',
          headers: {
            'Content-Disposition': `attachment; filename="horas-todas-las-empresas-${sheet.period.start}_${sheet.period.end}.csv"`,
          },
        };
      },
    }),

    defineRoute({
      method: 'get',
      path: '/portfolio/daily-reports',
      summary: 'Reportes diarios de todas mis empresas',
      description:
        'Los más recientes primero, con la empresa y el empleado de cada uno. Filtra por día ' +
        'laboral (`from`/`to`) y por empresa.',
      tags: TAGS,
      auth: AUTH,
      rateLimit: 'heavyRead',
      request: { query: portfolioDailyReportsQuery },
      responses: {
        200: { description: 'Reportes', schema: pageResponse(portfolioDailyReportSchema) },
        400: { description: 'Rango inválido', errorCodes: ['INVALID_DATE_RANGE'] },
        404: NOT_FOUND,
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const result = await deps.listPortfolioDailyReports.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(result.items.map(toPortfolioDailyReportDto), result);
      },
    }),

    defineRoute({
      method: 'get',
      path: '/portfolio/daily-reports/export',
      summary: 'Exportar los reportes de todas mis empresas a CSV',
      description:
        'Los mismos reportes de `/portfolio/daily-reports`, sin paginar, como archivo CSV (UTF-8) ' +
        'con la empresa al inicio de cada fila. Con más de 5000 reportes hay que acotar el rango.',
      tags: TAGS,
      auth: AUTH,
      rateLimit: 'export',
      request: { query: portfolioDailyReportsExportQuery },
      responses: {
        200: { description: 'Archivo CSV', contentType: 'text/csv' },
        400: {
          description: 'Rango inválido o demasiados reportes',
          errorCodes: ['INVALID_DATE_RANGE', 'EXPORT_TOO_LARGE'],
        },
        404: NOT_FOUND,
      },
      handler: async ({ actor, query }) => {
        const reports = await deps.exportPortfolioDailyReports.execute({ actor, filter: query });
        const range = [query.from, query.to].filter(Boolean).join('_');
        return {
          status: 200,
          body: portfolioDailyReportsCsv(reports),
          contentType: 'text/csv; charset=utf-8',
          headers: {
            'Content-Disposition': `attachment; filename="reportes-todas-las-empresas${range ? `-${range}` : ''}.csv"`,
          },
        };
      },
    }),
  ];
}
