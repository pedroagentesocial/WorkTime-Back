import { describe, expect, it } from 'vitest';
import { employeePay, periodPay, type PayRate } from './pay.js';

// Periodo del 19 oct al 1 nov de 2026
const period = { start: '2026-10-19', end: '2026-11-01' };
const hourly = (amountCents: number, effectiveFrom: string): PayRate => ({
  kind: 'hourly',
  amountCents,
  effectiveFrom,
});
const salary = (amountCents: number, effectiveFrom: string): PayRate => ({
  kind: 'salary',
  amountCents,
  effectiveFrom,
});
const days = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('employeePay: por hora', () => {
  it('multiplica las horas del periodo por la tarifa', () => {
    const pay = employeePay({
      period,
      rates: [hourly(1500, '2026-01-01')],
      centihoursByDay: days({ '2026-10-19': 800, '2026-10-20': 750 }),
      inactiveSpans: [],
    });
    expect(pay.amountCents).toBe(23_250); // 15.50 h x $15
    expect(pay.rate).toEqual(hourly(1500, '2026-01-01'));
  });

  it('un cambio a mitad del periodo rige desde su fecha', () => {
    const pay = employeePay({
      period,
      rates: [hourly(1800, '2026-10-26'), hourly(1500, '2026-01-01')],
      centihoursByDay: days({ '2026-10-25': 800, '2026-10-26': 800 }),
      inactiveSpans: [],
    });
    expect(pay.amountCents).toBe(8 * 1500 + 8 * 1800);
    expect(pay.rate?.amountCents).toBe(1800);
  });

  it('aplicado a todo el periodo, desde su primer dia, paga todo con la tarifa nueva', () => {
    const pay = employeePay({
      period,
      rates: [hourly(1500, '2026-01-01'), hourly(1800, period.start)],
      centihoursByDay: days({ '2026-10-20': 800, '2026-10-27': 800 }),
      inactiveSpans: [],
    });
    expect(pay.amountCents).toBe(16 * 1800);
  });

  it('redondea a centavos una sola vez, al final', () => {
    // 0.01 h x $10.01 = 10.01 centavos por dia; tres dias suman 30.03 y quedan 30
    const pay = employeePay({
      period,
      rates: [hourly(1001, '2026-01-01')],
      centihoursByDay: days({ '2026-10-19': 1, '2026-10-20': 1, '2026-10-21': 1 }),
      inactiveSpans: [],
    });
    expect(pay.amountCents).toBe(30);
  });

  it('sin horas paga cero; sin sueldo en el periodo no hay monto', () => {
    expect(
      employeePay({
        period,
        rates: [hourly(1500, '2026-01-01')],
        centihoursByDay: days({}),
        inactiveSpans: [],
      }).amountCents,
    ).toBe(0);
    const none = employeePay({
      period,
      rates: [hourly(1500, '2026-11-02')],
      centihoursByDay: days({ '2026-10-19': 800 }),
      inactiveSpans: [],
    });
    expect(none).toEqual({ amountCents: null, rate: null, salaryDays: 0 });
  });
});

describe('employeePay: sueldo fijo', () => {
  it('paga el sueldo completo si estuvo activo todo el periodo, trabaje las horas que trabaje', () => {
    const pay = employeePay({
      period,
      rates: [salary(140_000, '2026-01-01')],
      centihoursByDay: days({ '2026-10-19': 300 }),
      inactiveSpans: [],
    });
    expect(pay.amountCents).toBe(140_000);
  });

  it('si entra a mitad del periodo cobra solo los dias desde que rige', () => {
    const pay = employeePay({
      period,
      rates: [salary(140_000, '2026-10-26')],
      centihoursByDay: days({}),
      inactiveSpans: [],
    });
    expect(pay.amountCents).toBe(70_000); // 7 de 14 dias
  });

  it('si se da de baja a mitad del periodo cobra hasta su ultimo dia activo', () => {
    const pay = employeePay({
      period,
      rates: [salary(140_000, '2026-01-01')],
      centihoursByDay: days({}),
      inactiveSpans: [{ from: '2026-10-23', to: null }],
    });
    expect(pay.amountCents).toBe(40_000); // 4 de 14 dias
  });

  it('una baja y su reactivacion en el mismo periodo no pagan los dias de en medio', () => {
    const pay = employeePay({
      period,
      rates: [salary(140_000, '2026-01-01')],
      centihoursByDay: days({}),
      inactiveSpans: [{ from: '2026-10-23', to: '2026-10-27' }],
    });
    expect(pay.amountCents).toBe(90_000); // 14 dias menos 5 de baja
    expect(pay.salaryDays).toBe(9);
    expect(pay.rate?.amountCents).toBe(140_000);
  });

  it('dado de baja antes del periodo no cobra nada', () => {
    const pay = employeePay({
      period,
      rates: [salary(140_000, '2026-01-01')],
      centihoursByDay: days({}),
      inactiveSpans: [{ from: '2026-10-11', to: null }],
    });
    expect(pay.amountCents).toBe(null);
  });

  it('puede pasar de por hora a sueldo fijo dentro del mismo periodo', () => {
    const pay = employeePay({
      period,
      rates: [hourly(1000, '2026-01-01'), salary(140_000, '2026-10-26')],
      centihoursByDay: days({ '2026-10-19': 800, '2026-10-27': 800 }),
      inactiveSpans: [],
    });
    expect(pay.amountCents).toBe(8 * 1000 + 70_000);
    expect(pay.rate?.kind).toBe('salary');
  });
});

describe('periodPay', () => {
  it('suma las horas de varios marcajes del mismo dia y totaliza a todos los empleados', () => {
    const pay = periodPay(
      {
        currency: 'MXN',
        ratesByEmployee: new Map([
          ['ana', [hourly(1000, '2026-01-01')]],
          ['luis', [salary(140_000, '2026-01-01')]],
        ]),
        inactiveSpansByEmployee: new Map([['luis', [{ from: '2026-10-26', to: null }]]]),
      },
      period,
      [{ id: 'ana' }, { id: 'luis' }, { id: 'sin-sueldo' }],
      [
        { employeeId: 'ana', workDate: '2026-10-19', openEntries: 0, centihours: 400 },
        { employeeId: 'ana', workDate: '2026-10-19', openEntries: 0, centihours: 350 },
      ],
    );
    expect(pay.byEmployee.get('ana')?.amountCents).toBe(7500);
    expect(pay.byEmployee.get('luis')?.amountCents).toBe(70_000);
    expect(pay.byEmployee.get('sin-sueldo')?.amountCents).toBe(null);
    expect(pay).toMatchObject({ currency: 'MXN', totalCents: 77_500 });
  });
});
