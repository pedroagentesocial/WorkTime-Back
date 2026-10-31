import type { PayKind } from '#shared/domain/pay-rules.js';
import type { EmployeeDayTotal } from './company-timesheet.js';
import { daysOf, PAY_PERIOD_DAYS, type PayPeriod } from './pay-period.js';

export interface PayRate {
  readonly kind: PayKind;
  readonly amountCents: number;
  readonly effectiveFrom: string;
}

export interface EmployeePayInput {
  readonly period: PayPeriod;
  readonly rates: readonly PayRate[];
  // Centihoras de cada dia laboral del empleado en el periodo
  readonly centihoursByDay: ReadonlyMap<string, number>;
  // Bajas: dias sin sueldo fijo; to null mientras sigue inactivo
  readonly inactiveSpans: readonly InactiveSpan[];
}

export interface InactiveSpan {
  readonly from: string;
  readonly to: string | null;
}

const isInactive = (spans: readonly InactiveSpan[], date: string) =>
  spans.some((span) => span.from <= date && (span.to === null || date <= span.to));

export interface EmployeePay {
  // null si no tenia sueldo en ningun dia del periodo
  readonly amountCents: number | null;
  // El sueldo que regia el ultimo dia que trabajo en el periodo, para mostrarlo junto al monto
  readonly rate: PayRate | null;
  // Dias que se pagaron con sueldo fijo: los que tenia sueldo fijo y no estaba de baja
  readonly salaryDays: number;
}

// Lo que rige un dia es el ultimo cambio con fecha hasta ese dia
function rateOn(sorted: readonly PayRate[], date: string): PayRate | null {
  let current: PayRate | null = null;
  for (const rate of sorted) {
    if (rate.effectiveFrom > date) break;
    current = rate;
  }
  return current;
}

/*
  Por hora: horas de cada dia por la tarifa de ese dia. Sueldo fijo: monto / 14 por cada dia activo.
  Se suma exacto con enteros sobre un denominador comun de 1400, ya que las centihoras dividen
  entre 100 y los dias entre 14, y se redondea a centavos una sola vez al final.
*/
export function employeePay({
  period,
  rates,
  centihoursByDay,
  inactiveSpans,
}: EmployeePayInput): EmployeePay {
  const sorted = [...rates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const days = daysOf(period);
  const lastDay = days.findLast((date) => !isInactive(inactiveSpans, date)) ?? period.end;
  let numerator = 0n;
  let anyRate = false;
  let salaryDays = 0;

  for (const date of days) {
    const rate = rateOn(sorted, date);
    if (!rate) continue;
    if (rate.kind === 'hourly') {
      const centihours = centihoursByDay.get(date) ?? 0;
      numerator += BigInt(centihours) * BigInt(rate.amountCents) * BigInt(PAY_PERIOD_DAYS);
      anyRate = true;
    } else if (!isInactive(inactiveSpans, date)) {
      numerator += BigInt(rate.amountCents) * 100n;
      anyRate = true;
      salaryDays += 1;
    }
  }

  const denominator = 100n * BigInt(PAY_PERIOD_DAYS);
  return {
    amountCents: anyRate ? Number((numerator + denominator / 2n) / denominator) : null,
    rate: rateOn(sorted, lastDay),
    salaryDays,
  };
}

export interface CompanyPaySetup {
  readonly currency: string;
  readonly ratesByEmployee: ReadonlyMap<string, readonly PayRate[]>;
  // Solo los que tuvieron alguna baja
  readonly inactiveSpansByEmployee: ReadonlyMap<string, readonly InactiveSpan[]>;
}

export interface PeriodPay {
  readonly currency: string;
  readonly totalCents: number;
  readonly byEmployee: ReadonlyMap<string, EmployeePay>;
}

// Pago de cada empleado de la hoja con las horas de cada dia del periodo
export function periodPay(
  setup: CompanyPaySetup,
  period: PayPeriod,
  employees: readonly { readonly id: string }[],
  totals: readonly EmployeeDayTotal[],
): PeriodPay {
  const hours = new Map<string, Map<string, number>>();
  for (const total of totals) {
    const days = hours.get(total.employeeId) ?? new Map<string, number>();
    days.set(total.workDate, (days.get(total.workDate) ?? 0) + total.centihours);
    hours.set(total.employeeId, days);
  }

  const byEmployee = new Map<string, EmployeePay>();
  let totalCents = 0;
  for (const { id } of employees) {
    const pay = employeePay({
      period,
      rates: setup.ratesByEmployee.get(id) ?? [],
      centihoursByDay: hours.get(id) ?? new Map(),
      inactiveSpans: setup.inactiveSpansByEmployee.get(id) ?? [],
    });
    byEmployee.set(id, pay);
    totalCents += pay.amountCents ?? 0;
  }
  return { currency: setup.currency, totalCents, byEmployee };
}
