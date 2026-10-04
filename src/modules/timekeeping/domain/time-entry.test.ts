import { describe, expect, it } from 'vitest';
import { TimeEntry } from './time-entry.js';
import { assertValidWorkDateRange } from './work-date-range.js';

const at = (iso: string) => new Date(iso);

const start = (iso: string, timezone = 'America/Denver') =>
  TimeEntry.start({
    id: 'e1',
    companyId: 'c1',
    employeeId: 'emp1',
    at: at(iso),
    timezone,
    source: 'web',
  });

describe('TimeEntry.start', () => {
  it('el día laboral es la fecha LOCAL de la entrada', () => {
    expect(start('2026-06-02T02:00:00Z').workDate).toBe('2026-06-01');
    expect(start('2026-06-02T02:00:00Z', 'America/Mexico_City').workDate).toBe('2026-06-01');
    expect(start('2026-06-02T02:00:00Z', 'Europe/Madrid').workDate).toBe('2026-06-02');
  });

  it('empieza abierta y sin duración', () => {
    const entry = start('2026-06-01T14:00:00Z');
    expect(entry.isOpen).toBe(true);
    expect(entry.durationSeconds()).toBeNull();
  });
});

describe('TimeEntry.close', () => {
  it('calcula la duración en segundos completos', () => {
    const entry = start('2026-06-01T14:00:00Z');
    entry.close(at('2026-06-01T22:30:59Z'));
    expect(entry.durationSeconds()).toBe(510 * 60 + 59);
  });

  it('un turno nocturno sigue perteneciendo al día de entrada', () => {
    const entry = start('2026-06-02T04:00:00Z');
    entry.close(at('2026-06-02T12:00:00Z'));
    expect(entry.workDate).toBe('2026-06-01');
    expect(entry.durationSeconds()).toBe(480 * 60);
  });

  it('la noche del cambio de horario (8 mar 2026) un turno 22:00→06:00 dura 7 h', () => {
    const entry = start('2026-03-08T05:00:00Z');
    entry.close(at('2026-03-08T12:00:00Z'));
    expect(entry.workDate).toBe('2026-03-07');
    expect(entry.durationSeconds()).toBe(420 * 60);
  });

  it('no se puede cerrar dos veces', () => {
    const entry = start('2026-06-01T14:00:00Z');
    entry.close(at('2026-06-01T15:00:00Z'));
    expect(() => {
      entry.close(at('2026-06-01T16:00:00Z'));
    }).toThrow(expect.objectContaining({ code: 'NOT_CLOCKED_IN' }));
  });
});

describe('TimeEntry.correct', () => {
  const now = at('2026-06-02T12:00:00Z');

  it('devuelve los valores anteriores y recalcula el día laboral', () => {
    const entry = start('2026-06-01T14:00:00Z');
    const previous = entry.correct(
      { clockInAt: at('2026-06-01T05:00:00Z'), clockOutAt: at('2026-06-01T13:00:00Z') },
      now,
    );
    expect(previous).toEqual({ clockInAt: at('2026-06-01T14:00:00Z'), clockOutAt: null });
    expect(entry.workDate).toBe('2026-05-31');
    expect(entry.durationSeconds()).toBe(480 * 60);
  });

  it('rechaza salida antes de la entrada, horas futuras y correcciones vacías', () => {
    const entry = start('2026-06-01T14:00:00Z');
    expect(() => entry.correct({ clockOutAt: at('2026-06-01T13:00:00Z') }, now)).toThrow(
      expect.objectContaining({ code: 'INVALID_TIME_RANGE' }),
    );
    expect(() => entry.correct({ clockOutAt: at('2026-06-03T00:00:00Z') }, now)).toThrow(
      expect.objectContaining({ code: 'TIME_IN_FUTURE' }),
    );
    expect(() => entry.correct({ clockInAt: at('2026-06-01T14:00:00Z') }, now)).toThrow(
      expect.objectContaining({ code: 'NO_CHANGES' }),
    );
  });
});

describe('assertValidWorkDateRange', () => {
  it('acepta rangos válidos o abiertos', () => {
    expect(() => {
      assertValidWorkDateRange({ from: '2026-06-01', to: '2026-06-15' });
    }).not.toThrow();
    expect(() => {
      assertValidWorkDateRange({ from: '2026-06-01' });
    }).not.toThrow();
  });

  it('rechaza from > to y rangos demasiado largos', () => {
    expect(() => {
      assertValidWorkDateRange({ from: '2026-06-15', to: '2026-06-01' });
    }).toThrow(expect.objectContaining({ code: 'INVALID_DATE_RANGE' }));
    expect(() => {
      assertValidWorkDateRange({ from: '2024-01-01', to: '2026-01-01' });
    }).toThrow(expect.objectContaining({ code: 'INVALID_DATE_RANGE' }));
  });
});

describe('TimeEntry.createManual', () => {
  const now = at('2026-10-07T18:00:00Z');
  const manual = (clockInAt: string, clockOutAt: string) =>
    TimeEntry.createManual({
      id: 'm1',
      companyId: 'c1',
      employeeId: 'emp1',
      clockInAt: at(clockInAt),
      clockOutAt: at(clockOutAt),
      timezone: 'America/Denver',
      now,
      reason: 'Olvidó marcar',
    });

  it('nace cerrada, de origen admin y con el día local de la entrada', () => {
    const entry = manual('2026-10-07T03:00:00Z', '2026-10-07T11:30:00Z');
    expect(entry).toMatchObject({ source: 'admin', closeSource: 'admin', isOpen: false });
    expect(entry.workDate).toBe('2026-10-06');
    expect(entry.durationSeconds()).toBe(8.5 * 3600);
  });

  it('rechaza futuro, rangos invertidos o vacíos y fechas de más de 14 días', () => {
    expect(() => manual('2026-10-07T17:00:00Z', '2026-10-07T19:00:00Z')).toThrow(
      expect.objectContaining({ code: 'TIME_IN_FUTURE' }),
    );
    expect(() => manual('2026-10-06T16:00:00Z', '2026-10-06T16:00:00Z')).toThrow(
      expect.objectContaining({ code: 'INVALID_TIME_RANGE' }),
    );
    expect(() => manual('2026-09-22T14:00:00Z', '2026-09-22T22:00:00Z')).toThrow(
      expect.objectContaining({ code: 'MANUAL_ENTRY_TOO_OLD' }),
    );
    expect(manual('2026-09-23T14:00:00Z', '2026-09-23T22:00:00Z').workDate).toBe('2026-09-23');
  });
});
