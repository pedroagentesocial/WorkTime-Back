import { z } from '#shared/http/zod.js';
import type { CompanyTimesheetResult } from '../application/company-timesheet.use-cases.js';
import type { PortfolioTimesheetResult } from '../application/portfolio-timesheet.use-cases.js';
import { closureSchema, employeeSummarySchema, workDate } from './timekeeping.schemas.js';

const paySchema = z
  .object({
    amountCents: z.number().int().nullable().openapi({
      description:
        'Lo que se le paga en el periodo, en centavos; null si no tiene sueldo esos días',
    }),
    rate: z
      .object({
        kind: z.enum(['hourly', 'salary']),
        amountCents: z.number().int(),
        effectiveFrom: workDate,
      })
      .or(z.null())
      .openapi({ description: 'Sueldo vigente en su último día activo del periodo' }),
    salaryDays: z.number().int().openapi({
      description: 'Días pagados con sueldo fijo: los que tenía sueldo fijo y no estaba de baja',
    }),
  })
  .or(z.null())
  .openapi({
    description:
      'Por hora: horas × tarifa de cada día. Sueldo fijo: proporcional a los días activos. En un ' +
      'periodo cerrado es lo que se congeló al cerrar. null si el periodo se cerró antes de que hubiera sueldos.',
  });

const payrollEmployee = employeeSummarySchema.extend({ active: z.boolean() });

const periodMeta = {
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  period: z.object({ start: workDate, end: workDate }),
  previousPeriodStart: workDate,
  nextPeriodStart: workDate,
  totalHours: z.number().openapi({ description: 'Horas de las filas que coinciden con el filtro' }),
  employeeCount: z.number().int().openapi({
    description:
      'Empleados del filtro, con y sin sueldo; la tabla solo trae a los que tienen monto',
  }),
};

const breakdown = {
  totalCents: z.number().int().openapi({ description: 'Suma de lo que se paga en el filtro' }),
  hourlyCents: z.number().int().openapi({
    description:
      'Parte del total de quienes cobran por hora (según su sueldo en su último día del periodo)',
  }),
  salaryCents: z
    .number()
    .int()
    .openapi({ description: 'Parte del total de quienes tienen sueldo fijo' }),
};

export const companyPayrollRowSchema = z
  .object({
    employee: payrollEmployee,
    totalHours: z.number(),
    openEntries: z.number().int().openapi({
      description: 'Marcajes aún abiertos: no suman horas ni pago hasta que se cierren',
    }),
    pay: paySchema,
  })
  .openapi('PayrollRow');

export const companyPayrollMetaSchema = z.object({
  ...periodMeta,
  closed: closureSchema
    .or(z.null())
    .openapi({ description: 'Datos del cierre; null si sigue abierto' }),
  pay: z
    .object({ currency: z.string().openapi({ example: 'USD' }), ...breakdown })
    .or(z.null())
    .openapi({ description: 'null si el periodo se cerró antes de que hubiera sueldos' }),
  missingPay: z.array(payrollEmployee).openapi({
    description:
      'Empleados sin sueldo en el periodo: no suman al total y no van en la tabla. Se cargan desde su ficha.',
  }),
});

export const portfolioPayrollRowSchema = z
  .object({
    company: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
    employee: payrollEmployee,
    totalHours: z.number(),
    openEntries: z.number().int(),
    currency: z.string().nullable().openapi({
      example: 'USD',
      description: 'Moneda del pago: la de su empresa',
    }),
    pay: paySchema,
  })
  .openapi('PortfolioPayrollRow');

export const portfolioPayrollMetaSchema = z.object({
  ...periodMeta,
  missingPay: z
    .array(
      z.object({
        company: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
        employee: payrollEmployee,
      }),
    )
    .openapi({ description: 'Empleados sin sueldo en el periodo, con su empresa' }),
  payTotals: z
    .array(z.object({ currency: z.string().openapi({ example: 'USD' }), ...breakdown }))
    .openapi({
      description:
        'Total a pagar de cada moneda, de las filas del filtro: las empresas pueden pagar en monedas distintas y nunca se suman.',
    }),
});

export function companyPayrollRows(sheet: Pick<CompanyTimesheetResult, 'rows'>) {
  return sheet.rows.map(({ employee, totalHours, openEntries, pay }) => ({
    employee,
    totalHours,
    openEntries,
    pay,
  }));
}

export function portfolioPayrollRows(sheet: Pick<PortfolioTimesheetResult, 'rows'>) {
  return sheet.rows.map(({ company, employee, totalHours, openEntries, currency, pay }) => ({
    company,
    employee,
    totalHours,
    openEntries,
    currency,
    pay,
  }));
}
