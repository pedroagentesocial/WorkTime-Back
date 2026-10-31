import { localDateOf } from '#shared/domain/timezone.js';
import { daysOf, weekdayOf, type PayPeriod } from './pay-period.js';
import type { CompanyTimesheet, CompanyTimesheetRow } from './company-timesheet.js';
import { centihoursToHours } from './work-hours.js';

export interface CompanyRef {
  readonly id: string;
  readonly name: string;
  readonly code: string;
}

export type PortfolioTimesheetRow<R extends CompanyTimesheetRow = CompanyTimesheetRow> = R & {
  readonly company: CompanyRef;
};

export interface PortfolioTimesheet<R extends CompanyTimesheetRow = CompanyTimesheetRow> {
  readonly days: CompanyTimesheet['days'];
  readonly rows: PortfolioTimesheetRow<R>[];
  readonly totals: CompanyTimesheet['totals'];
}

export interface CurrencyTotal {
  readonly currency: string;
  readonly totalCents: number;
}

// Montos de varias empresas: solo se suman los de la misma moneda
export function totalsByCurrency(totals: readonly (CurrencyTotal | null)[]): CurrencyTotal[] {
  const sums = new Map<string, number>();
  for (const total of totals) {
    if (total) sums.set(total.currency, (sums.get(total.currency) ?? 0) + total.totalCents);
  }
  return [...sums]
    .map(([currency, totalCents]) => ({ currency, totalCents }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

const toCentihours = (hours: number): number => Math.round(hours * 100);

// Suma de varias horas decimales sin errores de coma flotante: se hace en centesimas
export function sumHours(values: readonly number[]): number {
  return centihoursToHours(values.reduce((sum, value) => sum + toCentihours(value), 0));
}

// Une las hojas de varias empresas del mismo periodo: una fila por empleado con su empresa
export function mergeCompanyTimesheets<R extends CompanyTimesheetRow>(
  period: PayPeriod,
  sheets: readonly {
    readonly company: CompanyRef;
    readonly sheet: { readonly rows: readonly R[]; readonly totals: CompanyTimesheet['totals'] };
  }[],
): PortfolioTimesheet<R> {
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
