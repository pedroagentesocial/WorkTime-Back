import type { CompanyTimesheetResult } from '../application/company-timesheet.use-cases.js';

// Un texto que empieza con estos caracteres se interpreta como formula en Excel
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function cell(value: string | number): string {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  const safe = typeof value === 'string' && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const BOM = String.fromCharCode(0xfeff);

export function companyTimesheetCsv(sheet: CompanyTimesheetResult): string {
  const lines: (string | number)[][] = [
    ['Código', 'Empleado', 'Estado', ...sheet.days.map((day) => day.date), 'Total'],
    ...sheet.rows.map((row) => [
      row.employee.employeeCode ?? '',
      `${row.employee.firstName} ${row.employee.lastName}`,
      row.employee.active ? 'Activo' : 'Inactivo',
      ...row.hours,
      row.totalHours,
    ]),
    ['', 'Total', '', ...sheet.totals.hours, sheet.totals.totalHours],
  ];
  return `${BOM}${lines.map((line) => line.map(cell).join(',')).join('\r\n')}\r\n`;
}
