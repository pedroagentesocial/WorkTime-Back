import { describe, expect, it } from 'vitest';
import { centihoursToHours, durationSeconds, toCentihours, toDecimalHours } from './work-hours.js';

describe('durationSeconds', () => {
  it('cuenta segundos completos entre dos instantes', () => {
    const start = new Date('2026-06-01T14:00:00.000Z');
    expect(durationSeconds(start, new Date('2026-06-01T14:00:01.900Z'))).toBe(1);
    expect(durationSeconds(start, new Date('2026-06-01T22:30:59Z'))).toBe(8 * 3600 + 1800 + 59);
  });
});

describe('toDecimalHours', () => {
  it('convierte horas exactas y medias horas', () => {
    expect(toDecimalHours(0)).toBe(0);
    expect(toDecimalHours(8 * 3600)).toBe(8);
    expect(toDecimalHours(8 * 3600 + 1800)).toBe(8.5);
  });

  it('una centesima de hora son 36 segundos y redondea al mas cercano', () => {
    expect(toDecimalHours(17)).toBe(0);
    expect(toDecimalHours(18)).toBe(0.01);
    expect(toDecimalHours(54)).toBe(0.02);
    expect(toDecimalHours(8 * 3600 + 59 * 60 + 24)).toBe(8.99);
    expect(toDecimalHours(8 * 3600 + 59 * 60 + 41)).toBe(8.99);
    expect(toDecimalHours(8 * 3600 + 59 * 60 + 42)).toBe(9);
  });

  it('el total por marcaje es la suma de centesimas ya redondeadas', () => {
    const entries = [3 * 3600 + 10 * 60 + 20, 2 * 3600 + 50 * 60 + 20, 1 * 3600 + 30 * 60 + 20];
    expect(entries.map(toDecimalHours)).toEqual([3.17, 2.84, 1.51]);
    const centihours = entries.map(toCentihours).reduce((sum, value) => sum + value, 0);
    expect(centihoursToHours(centihours)).toBe(7.52);
  });
});
