import type { CompanyTimesheetResult } from '../application/company-timesheet.use-cases.js';
import { toCsv } from './csv.js';

export function companyTimesheetCsv(sheet: CompanyTimesheetResult): string {
  return toCsv([
    ['Código', 'Empleado', 'Estado', ...sheet.days.map((day) => day.date), 'Total'],
    ...sheet.rows.map((row) => [
      row.employee.employeeCode ?? '',
      `${row.employee.firstName} ${row.employee.lastName}`,
      row.employee.active ? 'Activo' : 'Inactivo',
      ...row.hours,
      row.totalHours,
    ]),
    ['', 'Total', '', ...sheet.totals.hours, sheet.totals.totalHours],
  ]);
}
