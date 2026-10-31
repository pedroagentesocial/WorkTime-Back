import { describe, expect, it } from 'vitest';
import { addDays, planDeactivation, planReactivation } from './inactive-span-plan.js';

const limits = { today: '2026-10-31', lastClosedDay: '2026-10-18' };

describe('planDeactivation', () => {
  it('la baja empieza el dia siguiente al ultimo pagado', () => {
    expect(planDeactivation([], '2026-10-31', limits)).toEqual({ startFrom: '2026-11-01' });
    expect(planDeactivation([], '2026-10-25', limits)).toEqual({ startFrom: '2026-10-26' });
  });

  it('rechaza el futuro, los periodos cerrados y los dias antes de su ultima reactivacion', () => {
    expect(() => planDeactivation([], '2026-11-01', limits)).toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_DATE' }),
    );
    expect(() => planDeactivation([], '2026-10-18', limits)).toThrow(
      expect.objectContaining({ code: 'STATUS_DATE_IN_CLOSED_PERIOD' }),
    );
    const spans = [{ fromDay: '2026-10-20', toDay: '2026-10-24' }];
    expect(() => planDeactivation(spans, '2026-10-24', limits)).toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_DATE' }),
    );
    expect(planDeactivation(spans, '2026-10-25', limits).startFrom).toBe('2026-10-26');
  });
});

describe('planReactivation', () => {
  const open = [{ fromDay: '2026-10-26', toDay: null }];

  it('cierra la baja el dia anterior al que vuelve a cobrar', () => {
    expect(planReactivation(open, '2026-10-30', limits)).toEqual({
      action: 'end',
      fromDay: '2026-10-26',
      toDay: '2026-10-29',
    });
  });

  it('desde el mismo dia de la baja o el siguiente la borra: no hubo dias sin pago', () => {
    expect(planReactivation(open, '2026-10-25', limits)).toEqual({
      action: 'remove',
      fromDay: '2026-10-26',
    });
    expect(planReactivation(open, '2026-10-26', limits).action).toBe('remove');
  });

  it('rechaza dias antes de la baja, del futuro o de un periodo cerrado', () => {
    expect(() => planReactivation(open, '2026-10-24', limits)).toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_DATE' }),
    );
    expect(() => planReactivation(open, '2026-11-02', limits)).toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_DATE' }),
    );
    expect(() => planReactivation(open, '2026-10-10', limits)).toThrow(
      expect.objectContaining({ code: 'STATUS_DATE_IN_CLOSED_PERIOD' }),
    );
  });

  it('sin baja abierta no hay nada que cerrar', () => {
    expect(planReactivation([], '2026-10-30', limits)).toEqual({ action: 'none' });
  });

  it('addDays cruza meses', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });
});
