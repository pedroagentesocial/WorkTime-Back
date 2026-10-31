import type { CompanyTimesheetResult } from '../application/company-timesheet.use-cases.js';
import type { PortfolioTimesheetResult } from '../application/portfolio-timesheet.use-cases.js';
import type { EmployeePay } from '../domain/pay.js';
import { toCsv } from './csv.js';

const money = (cents: number) => (cents / 100).toFixed(2);

// Tipo, sueldo, dias con sueldo fijo y pago de una fila
function payCells(pay: EmployeePay | null): (string | number)[] {
  const rate = pay?.rate;
  return [
    rate ? (rate.kind === 'hourly' ? 'Por hora' : 'Sueldo fijo') : '',
    rate ? money(rate.amountCents) : '',
    pay?.salaryDays ? pay.salaryDays : '',
    pay?.amountCents != null ? money(pay.amountCents) : '',
  ];
}

export function companyPayrollCsv(sheet: CompanyTimesheetResult): string {
  const currency = sheet.pay?.currency;
  return toCsv([
    [
      'Código',
      'Empleado',
      'Estado',
      'Tipo',
      'Sueldo',
      'Horas',
      'Días con sueldo fijo',
      currency ? `Pago (${currency})` : 'Pago',
    ],
    ...sheet.rows.map((row) => {
      const [kind, rate, days, amount] = payCells(row.pay);
      return [
        row.employee.employeeCode ?? '',
        `${row.employee.firstName} ${row.employee.lastName}`,
        row.employee.active ? 'Activo' : 'Inactivo',
        kind ?? '',
        rate ?? '',
        row.totalHours,
        days ?? '',
        amount ?? '',
      ];
    }),
    [
      '',
      'Total',
      '',
      '',
      '',
      sheet.totals.totalHours,
      '',
      sheet.pay ? money(sheet.pay.totalCents) : '',
    ],
  ]);
}

export function portfolioPayrollCsv(sheet: PortfolioTimesheetResult): string {
  return toCsv([
    [
      'Empresa',
      'Código de empresa',
      'Código',
      'Empleado',
      'Estado',
      'Moneda',
      'Tipo',
      'Sueldo',
      'Horas',
      'Días con sueldo fijo',
      'Pago',
    ],
    ...sheet.rows.map((row) => {
      const [kind, rate, days, amount] = payCells(row.pay);
      return [
        row.company.name,
        row.company.code,
        row.employee.employeeCode ?? '',
        `${row.employee.firstName} ${row.employee.lastName}`,
        row.employee.active ? 'Activo' : 'Inactivo',
        row.currency ?? '',
        kind ?? '',
        rate ?? '',
        row.totalHours,
        days ?? '',
        amount ?? '',
      ];
    }),
    // Una fila por moneda: los montos de monedas distintas no se suman
    ...(sheet.payTotals ?? []).map((total) => [
      '',
      '',
      '',
      `Total ${total.currency}`,
      '',
      total.currency,
      '',
      '',
      '',
      '',
      money(total.totalCents),
    ]),
  ]);
}
