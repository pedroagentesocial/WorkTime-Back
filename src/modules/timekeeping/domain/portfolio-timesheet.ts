import { localDateOf } from '#shared/domain/timezone.js';
import { daysOf, weekdayOf, type PayPeriod } from './pay-period.js';
import type { CompanyTimesheet, CompanyTimesheetRow } from './company-timesheet.js';
import { centihoursToHours } from './work-hours.js';

export interface CompanyRef {
  readonly id: string;
  readonly name: string;
  readonly code: string;
}

export interface PortfolioTimesheetRow extends CompanyTimesheetRow {
  readonly company: CompanyRef;
}

export interface PortfolioTimesheet {
  readonly days: CompanyTimesheet['days'];
  readonly rows: PortfolioTimesheetRow[];
  readonly totals: CompanyTimesheet['totals'];
}

const toCentihours = (hours: number): number => Math.round(hours * 100);

// Suma de varias horas decimales sin errores de coma flotante: se hace en centesimas
export function sumHours(values: readonly number[]): number {
  return centihoursToHours(values.reduce((sum, value) => sum + toCentihours(value), 0));
}

// Une las hojas de varias empresas del mismo periodo: una fila por empleado con su empresa
export function mergeCompanyTimesheets(
  period: PayPeriod,
  sheets: readonly { readonly company: CompanyRef; readonly sheet: CompanyTimesheet }[],
): PortfolioTimesheet {
  const dates = daysOf(period);
  const rows = sheets.flatMap(({ company, sheet }) =>
    sheet.rows.map((row) => ({ ...row, company })),
  );
  const hours = dates.map((_, index) =>
    sumHours(sheets.map(({ sheet }) => sheet.totals.hours[index] ?? 0)),
  );
  return {
    days: dates.map((date) => ({ date, weekday: weekdayOf(date) })),
    rows,
    totals: { hours, totalHours: sumHours(hours) },
  };
}

// El periodo actual de varias empresas es el de la que va mas atrasada en el calendario, asi no
// salta al siguiente hasta que todas lo hayan terminado
export function portfolioPeriodDate(now: Date, timezones: readonly string[]): string {
  const dates = timezones.map((timezone) => localDateOf(now, timezone));
  return dates.length === 0 ? localDateOf(now, 'UTC') : dates.reduce((a, b) => (a < b ? a : b));
}
