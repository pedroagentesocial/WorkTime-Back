import { daysOf, type PayPeriod, type Weekday, weekdayOf } from './pay-period.js';
import { centihoursToHours } from './work-hours.js';

export interface TimesheetEmployee {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly employeeCode: string | null;
  readonly active: boolean;
}

export interface EmployeeDayTotal {
  readonly employeeId: string;
  readonly workDate: string;
  readonly openEntries: number;
  readonly centihours: number;
}

export interface CompanyTimesheetRow {
  readonly employee: TimesheetEmployee;
  readonly hours: number[];
  readonly totalHours: number;
  readonly openEntries: number;
}

export interface CompanyTimesheet {
  readonly days: { readonly date: string; readonly weekday: Weekday }[];
  readonly rows: CompanyTimesheetRow[];
  readonly totals: { readonly hours: number[]; readonly totalHours: number };
}

export function buildCompanyTimesheet(
  period: PayPeriod,
  employees: readonly TimesheetEmployee[],
  totals: readonly EmployeeDayTotal[],
): CompanyTimesheet {
  const dates = daysOf(period);
  const columnOf = new Map(dates.map((date, index) => [date, index]));
  const byEmployee = new Map<string, EmployeeDayTotal[]>();
  for (const total of totals) {
    byEmployee.set(total.employeeId, [...(byEmployee.get(total.employeeId) ?? []), total]);
  }

  const columnTotals: number[] = dates.map(() => 0);
  const rows = employees.map((employee) => {
    const centihours: number[] = dates.map(() => 0);
    let openEntries = 0;
    for (const total of byEmployee.get(employee.id) ?? []) {
      const column = columnOf.get(total.workDate);
      if (column === undefined) continue;
      centihours[column] = (centihours[column] ?? 0) + total.centihours;
      columnTotals[column] = (columnTotals[column] ?? 0) + total.centihours;
      openEntries += total.openEntries;
    }
    return {
      employee,
      hours: centihours.map(centihoursToHours),
      totalHours: centihoursToHours(centihours.reduce((sum, value) => sum + value, 0)),
      openEntries,
    };
  });

  return {
    days: dates.map((date) => ({ date, weekday: weekdayOf(date) })),
    rows,
    totals: {
      hours: columnTotals.map(centihoursToHours),
      totalHours: centihoursToHours(columnTotals.reduce((sum, value) => sum + value, 0)),
    },
  };
}
