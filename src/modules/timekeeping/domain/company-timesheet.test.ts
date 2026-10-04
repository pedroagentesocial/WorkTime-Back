import { describe, expect, it } from 'vitest';
import { buildCompanyTimesheet, type TimesheetEmployee } from './company-timesheet.js';

const period = { start: '2026-10-05', end: '2026-10-18' };
const ana: TimesheetEmployee = {
  id: 'a',
  firstName: 'Ana',
  lastName: 'Lopez',
  employeeCode: null,
  active: true,
};
const juan: TimesheetEmployee = { ...ana, id: 'j', firstName: 'Juan', active: false };

describe('buildCompanyTimesheet', () => {
  it('arma 14 columnas por empleado con ceros donde no hubo marcajes', () => {
    const sheet = buildCompanyTimesheet(period, [ana], []);
    expect(sheet.days).toHaveLength(14);
    expect(sheet.days[0]).toEqual({ date: '2026-10-05', weekday: 'monday' });
    expect(sheet.rows[0]?.hours).toEqual(Array(14).fill(0));
    expect(sheet.totals.totalHours).toBe(0);
  });

  it('suma por dia y por empleado y calcula los totales de la empresa', () => {
    const sheet = buildCompanyTimesheet(
      period,
      [ana, juan],
      [
        { employeeId: 'a', workDate: '2026-10-05', openEntries: 0, centihours: 800 },
        { employeeId: 'a', workDate: '2026-10-06', openEntries: 1, centihours: 317 },
        { employeeId: 'j', workDate: '2026-10-05', openEntries: 0, centihours: 250 },
      ],
    );
    expect(sheet.rows[0]).toMatchObject({ totalHours: 11.17, openEntries: 1 });
    expect(sheet.rows[0]?.hours.slice(0, 2)).toEqual([8, 3.17]);
    expect(sheet.rows[1]?.totalHours).toBe(2.5);
    expect(sheet.totals.hours.slice(0, 2)).toEqual([10.5, 3.17]);
    expect(sheet.totals.totalHours).toBe(13.67);
  });

  it('ignora dias fuera del periodo', () => {
    const sheet = buildCompanyTimesheet(
      period,
      [ana],
      [{ employeeId: 'a', workDate: '2026-10-19', openEntries: 0, centihours: 800 }],
    );
    expect(sheet.totals.totalHours).toBe(0);
  });
});
