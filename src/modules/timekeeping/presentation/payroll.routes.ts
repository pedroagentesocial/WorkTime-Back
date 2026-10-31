import { Permission } from '#shared/domain/permissions.js';
import { defineRoute, paginated, type AnyRoute } from '#shared/http/route.js';
import { z } from '#shared/http/zod.js';
import type {
  ExportCompanyPayrollUseCase,
  ExportPortfolioPayrollUseCase,
  GetCompanyPayrollUseCase,
  GetPortfolioPayrollUseCase,
} from '../application/payroll.use-cases.js';
import { companyPayrollCsv, portfolioPayrollCsv } from './payroll-csv.js';
import {
  companyPayrollMetaSchema,
  companyPayrollRows,
  companyPayrollRowSchema,
  portfolioPayrollMetaSchema,
  portfolioPayrollRows,
  portfolioPayrollRowSchema,
} from './payroll.schemas.js';
import { portfolioTimesheetExportQuery, portfolioTimesheetQuery } from './portfolio.schemas.js';
import {
  closureDto,
  companyTimesheetExportQuery,
  companyTimesheetQuery,
} from './timekeeping.schemas.js';

interface Deps {
  getCompanyPayroll: GetCompanyPayrollUseCase;
  exportCompanyPayroll: ExportCompanyPayrollUseCase;
  getPortfolioPayroll: GetPortfolioPayrollUseCase;
  exportPortfolioPayroll: ExportPortfolioPayrollUseCase;
}

const COMPANY_TAGS = ['Empresa · Nómina'];
const PORTFOLIO_TAGS = ['Admin multiempresa · Todas mis empresas'];
const PORTFOLIO_NOT_FOUND = {
  description: 'La empresa no existe o no es tuya',
  errorCodes: ['COMPANY_NOT_FOUND'],
};

const csv = (body: string, filename: string) => ({
  status: 200,
  body,
  contentType: 'text/csv; charset=utf-8',
  headers: { 'Content-Disposition': `attachment; filename="${filename}"` },
});

export function payrollRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'get',
      path: '/company/payroll',
      summary: 'Nómina del periodo',
      description:
        'Lo que se paga a cada empleado en un periodo de 14 días: tipo de pago, sueldo, horas, días ' +
        'con sueldo fijo y monto, más el total. En un periodo cerrado son los montos congelados al ' +
        'cerrar. Sin `date` devuelve el periodo actual.',
      tags: COMPANY_TAGS,
      auth: Permission.PAY_MANAGE,
      rateLimit: 'heavyRead',
      request: { query: companyTimesheetQuery },
      responses: {
        200: {
          description: 'Nómina',
          schema: z.object({
            data: z.array(companyPayrollRowSchema),
            meta: companyPayrollMetaSchema,
          }),
        },
      },
      handler: async ({ actor, query }) => {
        const { page, limit, date, search } = query;
        const sheet = await deps.getCompanyPayroll.execute({
          actor,
          date,
          search,
          page: { page, limit },
        });
        return paginated(companyPayrollRows(sheet), sheet, {
          period: sheet.period,
          previousPeriodStart: sheet.previousPeriodStart,
          nextPeriodStart: sheet.nextPeriodStart,
          totalHours: sheet.totals.totalHours,
          employeeCount: sheet.employeeCount,
          closed: sheet.closure ? closureDto(sheet.closure) : null,
          pay: sheet.pay && sheet.breakdown && { currency: sheet.pay.currency, ...sheet.breakdown },
          missingPay: sheet.missingPay,
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/company/payroll/export',
      summary: 'Exportar la nómina a CSV',
      description: 'La misma tabla de `/company/payroll`, sin paginar, como archivo CSV (UTF-8).',
      tags: COMPANY_TAGS,
      auth: Permission.PAY_MANAGE,
      rateLimit: 'export',
      request: { query: companyTimesheetExportQuery },
      responses: { 200: { description: 'Archivo CSV', contentType: 'text/csv' } },
      handler: async ({ actor, query }) => {
        const sheet = await deps.exportCompanyPayroll.execute({ actor, ...query });
        return csv(
          companyPayrollCsv(sheet),
          `nomina-${sheet.period.start}_${sheet.period.end}.csv`,
        );
      },
    }),

    // Solo el admin multiempresa lee sus empresas, y siempre puede ver sueldos
    defineRoute({
      method: 'get',
      path: '/portfolio/payroll',
      summary: 'Nómina de todas mis empresas',
      description:
        'La nómina de todos los empleados de mis empresas activas, con su empresa y su moneda, y un ' +
        'total por moneda en `meta.payTotals`: los montos de monedas distintas nunca se suman.',
      tags: PORTFOLIO_TAGS,
      auth: Permission.PORTFOLIO_READ,
      rateLimit: 'heavyRead',
      request: { query: portfolioTimesheetQuery },
      responses: {
        200: {
          description: 'Nómina',
          schema: z.object({
            data: z.array(portfolioPayrollRowSchema),
            meta: portfolioPayrollMetaSchema,
          }),
        },
        404: PORTFOLIO_NOT_FOUND,
      },
      handler: async ({ actor, query }) => {
        const { page, limit, date, search, companyId } = query;
        const sheet = await deps.getPortfolioPayroll.execute({
          actor,
          date,
          search,
          companyId,
          page: { page, limit },
        });
        return paginated(portfolioPayrollRows(sheet), sheet, {
          period: sheet.period,
          previousPeriodStart: sheet.previousPeriodStart,
          nextPeriodStart: sheet.nextPeriodStart,
          totalHours: sheet.totals.totalHours,
          employeeCount: sheet.employeeCount,
          missingPay: sheet.missingPay,
          payTotals: sheet.breakdowns,
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/portfolio/payroll/export',
      summary: 'Exportar la nómina de todas mis empresas a CSV',
      description:
        'La misma tabla de `/portfolio/payroll`, sin paginar, como CSV, con una fila de total por moneda.',
      tags: PORTFOLIO_TAGS,
      auth: Permission.PORTFOLIO_READ,
      rateLimit: 'export',
      request: { query: portfolioTimesheetExportQuery },
      responses: {
        200: { description: 'Archivo CSV', contentType: 'text/csv' },
        404: PORTFOLIO_NOT_FOUND,
      },
      handler: async ({ actor, query }) => {
        const sheet = await deps.exportPortfolioPayroll.execute({ actor, ...query });
        return csv(
          portfolioPayrollCsv(sheet),
          `nomina-todas-las-empresas-${sheet.period.start}_${sheet.period.end}.csv`,
        );
      },
    }),
  ];
}
