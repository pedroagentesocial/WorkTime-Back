import { describe, expect, it } from 'vitest';
import {
  nextPayPeriodStart,
  payPeriodOf,
  previousPayPeriodStart,
  weekdayOf,
} from './pay-period.js';
import { buildTimesheet } from './timesheet.js';

describe('payPeriodOf', () => {
  it('sigue el patron de 14 dias que arranca el 21 de septiembre de 2026', () => {
    expect(payPeriodOf('2026-09-21')).toEqual({ start: '2026-09-21', end: '2026-10-04' });
    expect(payPeriodOf('2026-10-04')).toEqual({ start: '2026-09-21', end: '2026-10-04' });
    expect(payPeriodOf('2026-10-05')).toEqual({ start: '2026-10-05', end: '2026-10-18' });
    expect(payPeriodOf('2026-10-19')).toEqual({ start: '2026-10-19', end: '2026-11-01' });
  });

  it('funciona hacia atras y cruzando el año', () => {
    expect(payPeriodOf('2026-09-20')).toEqual({ start: '2026-09-07', end: '2026-09-20' });
    expect(payPeriodOf('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-10' });
  });

  it('calcula el periodo anterior y el siguiente', () => {
    const period = payPeriodOf('2026-10-10');
    expect(previousPayPeriodStart(period)).toBe('2026-09-21');
    expect(nextPayPeriodStart(period)).toBe('2026-10-19');
  });

  it('todos los periodos empiezan en lunes', () => {
    for (const date of ['2026-09-21', '2026-11-30', '2027-03-15', '2026-01-01']) {
      expect(weekdayOf(payPeriodOf(date).start)).toBe('monday');
    }
  });
});

describe('buildTimesheet', () => {
  const period = payPeriodOf('2026-10-05');

  it('devuelve los 14 dias, con 0 horas donde no hubo marcajes', () => {
    const sheet = buildTimesheet(period, [
      { workDate: '2026-10-05', entries: 2, openEntries: 0, centihours: 800, hasReport: true },
      { workDate: '2026-10-07', entries: 1, openEntries: 1, centihours: 0, hasReport: false },
    ]);
    expect(sheet.days).toHaveLength(14);
    expect(sheet.days[0]).toEqual({
      date: '2026-10-05',
      weekday: 'monday',
      entries: 2,
      openEntries: 0,
      hours: 8,
      hasReport: true,
    });
    expect(sheet.days[1]).toMatchObject({ date: '2026-10-06', entries: 0, hours: 0 });
    expect(sheet.days[2]).toMatchObject({ date: '2026-10-07', openEntries: 1, hours: 0 });
    expect(sheet.days[13]).toMatchObject({ date: '2026-10-18', weekday: 'sunday' });
    expect(sheet.totalHours).toBe(8);
  });

  it('el total suma las centesimas de cada dia', () => {
    const sheet = buildTimesheet(period, [
      { workDate: '2026-10-05', entries: 1, openEntries: 0, centihours: 317, hasReport: false },
      { workDate: '2026-10-06', entries: 1, openEntries: 0, centihours: 284, hasReport: false },
      { workDate: '2026-10-08', entries: 1, openEntries: 0, centihours: 151, hasReport: false },
    ]);
    expect(sheet.totalHours).toBe(7.52);
  });
});
