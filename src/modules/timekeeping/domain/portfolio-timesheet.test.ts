import { describe, expect, it } from 'vitest';
import type { CompanyTimesheet } from './company-timesheet.js';
import { payPeriodOf } from './pay-period.js';
import { mergeCompanyTimesheets, portfolioPeriodDate, sumHours } from './portfolio-timesheet.js';

const period = payPeriodOf('2026-10-05');
const zeros = (n: number) => Array.from({ length: n }, () => 0);

function sheet(rows: { code: string; hours: number[] }[]): CompanyTimesheet {
  const days = Array.from({ length: 14 }, (_, i) => i);
  const totals = days.map((i) => sumHours(rows.map((row) => row.hours[i] ?? 0)));
  return {
    days: [],
    rows: rows.map((row) => ({
      employee: {
        id: row.code,
        firstName: 'Ana',
        lastName: row.code,
        employeeCode: row.code,
        active: true,
      },
      hours: [...row.hours, ...zeros(14 - row.hours.length)],
      totalHours: sumHours(row.hours),
      openEntries: 0,
    })),
    totals: { hours: totals, totalHours: sumHours(totals) },
  };
}

describe('sumHours', () => {
  it('suma en centesimas, sin errores de coma flotante', () => {
    expect(sumHours([0.1, 0.2])).toBe(0.3);
    expect(sumHours([1.17, 2.83, 0.01])).toBe(4.01);
  });
});

describe('mergeCompanyTimesheets', () => {
  const a = { id: 'a', name: 'Alfa', code: 'AAAA-2222' };
  const b = { id: 'b', name: 'Beta', code: 'BBBB-3333' };

  it('une las filas con su empresa y suma los totales por dia', () => {
    const merged = mergeCompanyTimesheets(period, [
      { company: a, sheet: sheet([{ code: 'AAA-0001', hours: [8, 7.5] }]) },
      { company: b, sheet: sheet([{ code: 'BBB-0001', hours: [4.25, 0, 3] }]) },
    ]);

    expect(merged.rows.map((row) => [row.company.name, row.employee.employeeCode])).toEqual([
      ['Alfa', 'AAA-0001'],
      ['Beta', 'BBB-0001'],
    ]);
    expect(merged.totals.hours.slice(0, 3)).toEqual([12.25, 7.5, 3]);
    expect(merged.totals.totalHours).toBe(22.75);
    expect(merged.days).toHaveLength(14);
    expect(merged.days[0]).toEqual({ date: '2026-10-05', weekday: 'monday' });
  });

  it('sin empresas devuelve el periodo en ceros', () => {
    const merged = mergeCompanyTimesheets(period, []);
    expect(merged.rows).toEqual([]);
    expect(merged.totals).toEqual({ hours: zeros(14), totalHours: 0 });
  });
});

describe('portfolioPeriodDate', () => {
  it('toma el dia de la zona mas atrasada para no adelantar el periodo', () => {
    // Lunes 00:30 UTC es todavia domingo en Denver
    const now = new Date('2026-10-05T00:30:00Z');
    expect(portfolioPeriodDate(now, ['UTC', 'America/Denver'])).toBe('2026-10-04');
    expect(portfolioPeriodDate(now, ['UTC'])).toBe('2026-10-05');
  });

  it('sin zonas usa el dia UTC', () => {
    expect(portfolioPeriodDate(new Date('2026-10-05T12:00:00Z'), [])).toBe('2026-10-05');
  });
});
