import { describe, expect, it } from 'vitest';
import {
  isValidTimezone,
  localDateOf,
  resolveTimezone,
  toLocalIsoString,
  utcOffsetMinutes,
} from './timezone.js';

const at = (iso: string) => new Date(iso);

describe('isValidTimezone', () => {
  it.each(['America/Denver', 'America/Mexico_City', 'America/Mazatlan', 'Europe/Madrid', 'UTC'])(
    'acepta %s',
    (tz) => {
      expect(isValidTimezone(tz)).toBe(true);
    },
  );

  it.each([
    '',
    'Mexico',
    'America/Inventada',
    '-06:00',
    '-06',
    '+0530',
    'UTC; DROP TABLE',
    'x'.repeat(65),
  ])('rechaza "%s"', (tz) => {
    expect(isValidTimezone(tz)).toBe(false);
  });
});

describe('resolveTimezone', () => {
  it('usa la del empleado si existe; si no, hereda la de la empresa', () => {
    expect(resolveTimezone('America/Mexico_City', 'America/Denver')).toBe('America/Mexico_City');
    expect(resolveTimezone(null, 'America/Denver')).toBe('America/Denver');
  });
});

describe('Utah (America/Denver) con horario de verano', () => {
  it('invierno: UTC-7 (MST)', () => {
    expect(utcOffsetMinutes(at('2026-01-15T15:00:00Z'), 'America/Denver')).toBe(-420);
    expect(toLocalIsoString(at('2026-01-15T15:00:00Z'), 'America/Denver')).toBe(
      '2026-01-15T08:00:00-07:00',
    );
  });

  it('verano: UTC-6 (MDT)', () => {
    expect(toLocalIsoString(at('2026-07-15T14:00:00Z'), 'America/Denver')).toBe(
      '2026-07-15T08:00:00-06:00',
    );
  });

  it('el día del cambio (8 mar 2026, 2:00 → 3:00) el desfase cambia a media noche local', () => {
    expect(utcOffsetMinutes(at('2026-03-08T08:59:00Z'), 'America/Denver')).toBe(-420);
    expect(utcOffsetMinutes(at('2026-03-08T09:00:00Z'), 'America/Denver')).toBe(-360);
  });

  it('un turno "de 22:00 a 06:00" esa noche dura 7 horas reales, no 8', () => {
    const start = at('2026-03-08T05:00:00Z');
    const end = at('2026-03-08T12:00:00Z');
    expect(toLocalIsoString(start, 'America/Denver')).toBe('2026-03-07T22:00:00-07:00');
    expect(toLocalIsoString(end, 'America/Denver')).toBe('2026-03-08T06:00:00-06:00');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(7);
  });
});

describe('México', () => {
  it('Guadalajara (America/Mexico_City): UTC-6 todo el año desde 2023', () => {
    expect(utcOffsetMinutes(at('2026-01-15T12:00:00Z'), 'America/Mexico_City')).toBe(-360);
    expect(utcOffsetMinutes(at('2026-07-15T12:00:00Z'), 'America/Mexico_City')).toBe(-360);
  });

  it('Sinaloa (America/Mazatlan): UTC-7 todo el año', () => {
    expect(toLocalIsoString(at('2026-07-15T15:00:00Z'), 'America/Mazatlan')).toBe(
      '2026-07-15T08:00:00-07:00',
    );
  });

  it('el mismo instante son horas distintas en Utah y en Guadalajara (en invierno)', () => {
    const instant = at('2026-01-15T15:00:00Z');
    expect(toLocalIsoString(instant, 'America/Denver')).toBe('2026-01-15T08:00:00-07:00');
    expect(toLocalIsoString(instant, 'America/Mexico_City')).toBe('2026-01-15T09:00:00-06:00');
  });
});

describe('localDateOf (día laboral)', () => {
  it('usa la fecha LOCAL, no la de UTC', () => {
    expect(localDateOf(at('2026-06-02T03:00:00Z'), 'America/Denver')).toBe('2026-06-01');
    expect(localDateOf(at('2026-06-02T03:00:00Z'), 'Europe/Madrid')).toBe('2026-06-02');
  });

  it('medianoche local exacta pertenece al día nuevo', () => {
    expect(localDateOf(at('2026-06-01T06:00:00Z'), 'America/Denver')).toBe('2026-06-01');
    expect(localDateOf(at('2026-06-01T05:59:59Z'), 'America/Denver')).toBe('2026-05-31');
  });

  it('zonas con desfase positivo y media hora', () => {
    expect(toLocalIsoString(at('2026-06-01T12:00:00Z'), 'Asia/Kolkata')).toBe(
      '2026-06-01T17:30:00+05:30',
    );
  });
});
