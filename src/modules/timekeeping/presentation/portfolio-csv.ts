import type { PortfolioTimesheetResult } from '../application/portfolio-timesheet.use-cases.js';
import type { PortfolioDailyReportView } from '../application/ports/portfolio-daily-report.reader.js';
import { toCsv } from './csv.js';
import { markdownToPlainText } from './markdown-text.js';

// Igual que la hoja de una empresa, con la empresa de cada fila al inicio
export function portfolioTimesheetCsv(sheet: PortfolioTimesheetResult): string {
  return toCsv([
    [
      'Empresa',
      'Código de empresa',
      'Código',
      'Empleado',
      'Estado',
      ...sheet.days.map((day) => day.date),
      'Total',
    ],
    ...sheet.rows.map((row) => [
      row.company.name,
      row.company.code,
      row.employee.employeeCode ?? '',
      `${row.employee.firstName} ${row.employee.lastName}`,
      row.employee.active ? 'Activo' : 'Inactivo',
      ...row.hours,
      row.totalHours,
    ]),
    ['', '', '', 'Total', '', ...sheet.totals.hours, sheet.totals.totalHours],
  ]);
}

export function portfolioDailyReportsCsv(reports: readonly PortfolioDailyReportView[]): string {
  return toCsv([
    [
      'Empresa',
      'Código de empresa',
      'Código',
      'Empleado',
      'Fecha',
      'Reporte',
      'Creado (UTC)',
      'Última edición (UTC)',
    ],
    ...reports.map((report) => [
      report.company.name,
      report.company.code,
      report.employee.employeeCode ?? '',
      `${report.employee.firstName} ${report.employee.lastName}`,
      report.workDate,
      markdownToPlainText(report.content),
      report.createdAt.toISOString(),
      report.updatedAt.toISOString(),
    ]),
  ]);
}
