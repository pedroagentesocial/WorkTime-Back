import { paginationQuery, uuidSchema } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type { PortfolioSummary } from '../application/portfolio-summary.use-case.js';
import type { PortfolioDailyReportView } from '../application/ports/portfolio-daily-report.reader.js';
import { toDecimalHours } from '../domain/work-hours.js';
import {
  employeeSummarySchema,
  searchParam,
  timesheetQuery,
  weekdaySchema,
  workDate,
} from './timekeeping.schemas.js';

const companyId = uuidSchema.optional().openapi({
  description:
    'Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente',
});

const companyRefSchema = z.object({ id: z.uuid(), name: z.string(), code: z.string() });

export const portfolioSummaryQuery = z.object({ companyId });

export const portfolioTimesheetQuery = paginationQuery.extend({
  date: timesheetQuery.shape.date,
  search: searchParam,
  companyId,
});

export const portfolioTimesheetExportQuery = z.object({
  date: timesheetQuery.shape.date,
  search: searchParam,
  companyId,
});

export const portfolioDailyReportsQuery = paginationQuery.extend({
  from: workDate.optional().openapi({ description: 'Día laboral inicial (inclusive)' }),
  to: workDate.optional().openapi({ description: 'Día laboral final (inclusive)' }),
  companyId,
});

export const portfolioDailyReportsExportQuery = z.object({
  from: portfolioDailyReportsQuery.shape.from,
  to: portfolioDailyReportsQuery.shape.to,
  companyId,
});

const employeeCounts = z.object({
  active: z.number().int(),
  in: z.number().int().openapi({ description: 'Trabajando ahora' }),
  out: z.number().int(),
});

const pendingReports = z.object({
  employees: z.number().int().openapi({ description: 'Empleados con reportes pendientes' }),
  days: z.number().int().openapi({ description: 'Reportes pendientes en total' }),
});

export const portfolioSummarySchema = z
  .object({
    asOf: z.iso.datetime(),
    period: z.object({ start: workDate, end: workDate }).openapi({
      description:
        'Periodo de pago actual. No avanza hasta que todas las empresas terminaron el anterior',
    }),
    days: z.array(z.object({ date: workDate, weekday: weekdaySchema })),
    totals: z.object({
      companies: z.number().int().openapi({ description: 'Empresas activas incluidas' }),
      employees: employeeCounts,
      worked: z.object({ seconds: z.number().int(), hours: z.number() }).openapi({
        description: 'Trabajado hoy por todos, incluidas las entradas abiertas',
      }),
      atLimitCount: z.number().int(),
      pendingReports: pendingReports.extend({
        companiesRequiring: z.number().int().openapi({
          description: 'Empresas que exigen reporte diario',
        }),
      }),
      periodHours: z.number().openapi({ description: 'Horas de todos en el periodo actual' }),
      dailyHours: z.array(z.number()).openapi({
        description: 'Horas de todos por día del periodo, en el orden de `days`',
      }),
    }),
    companies: z.array(
      z.object({
        company: companyRefSchema,
        employees: employeeCounts,
        worked: z.object({ seconds: z.number().int(), hours: z.number() }),
        atLimitCount: z.number().int(),
        pendingReports: pendingReports.extend({ required: z.boolean() }),
        periodHours: z.number(),
      }),
    ),
  })
  .openapi('PortfolioSummary');

export function toPortfolioSummaryDto(summary: PortfolioSummary) {
  const worked = (seconds: number) => ({ seconds, hours: toDecimalHours(seconds) });
  return {
    asOf: summary.asOf.toISOString(),
    period: summary.period,
    days: summary.days,
    totals: { ...summary.totals, worked: worked(summary.totals.workedTodaySeconds) },
    companies: summary.companies.map(({ workedTodaySeconds, ...rest }) => ({
      ...rest,
      worked: worked(workedTodaySeconds),
    })),
  };
}

export const portfolioTimesheetRowSchema = z
  .object({
    company: companyRefSchema,
    employee: employeeSummarySchema.extend({ active: z.boolean() }),
    hours: z.array(z.number()).openapi({
      description: 'Horas decimales de cada día del periodo, en el mismo orden que meta.days',
    }),
    totalHours: z.number(),
    openEntries: z.number().int(),
  })
  .openapi('PortfolioTimesheetRow');

export const portfolioTimesheetMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  period: z.object({ start: workDate, end: workDate }),
  previousPeriodStart: workDate,
  nextPeriodStart: workDate,
  days: z.array(z.object({ date: workDate, weekday: weekdaySchema })),
  totals: z.object({ hours: z.array(z.number()), totalHours: z.number() }),
});

export const portfolioDailyReportSchema = z
  .object({
    id: z.uuid(),
    company: companyRefSchema,
    employee: employeeSummarySchema,
    workDate,
    content: z.string().openapi({ description: 'Texto del reporte en Markdown' }),
    revisions: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('PortfolioDailyReport');

export function toPortfolioDailyReportDto(report: PortfolioDailyReportView) {
  return {
    id: report.id,
    company: report.company,
    employee: report.employee,
    workDate: report.workDate,
    content: report.content,
    revisions: report.revisions,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}
