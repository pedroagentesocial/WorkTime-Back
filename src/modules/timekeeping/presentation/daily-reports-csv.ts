import type { DailyReportView } from '../application/ports/daily-report.repository.js';
import { toCsv } from './csv.js';
import { markdownToPlainText } from './markdown-text.js';

export function dailyReportsCsv(reports: readonly DailyReportView[]): string {
  return toCsv([
    ['Código', 'Empleado', 'Fecha', 'Reporte', 'Creado (UTC)', 'Última edición (UTC)'],
    ...reports.map((report) => [
      report.employee.employeeCode ?? '',
      `${report.employee.firstName} ${report.employee.lastName}`,
      report.workDate,
      markdownToPlainText(report.content),
      report.createdAt.toISOString(),
      report.updatedAt.toISOString(),
    ]),
  ]);
}
