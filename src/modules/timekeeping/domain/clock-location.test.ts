import { describe, expect, it } from 'vitest';
import { AppError } from '#shared/domain/errors.js';
import { ClockLocationRules, MAX_ACCURACY_METERS } from './clock-location.js';

const valid = { latitude: 40.7608, longitude: -111.891, accuracyMeters: 12 };

const codeOf = (location: Parameters<typeof ClockLocationRules.assertValid>[0]) => {
  try {
    ClockLocationRules.assertValid(location);
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return null;
};

describe('ClockLocationRules', () => {
  it('acepta una ubicacion valida y la devuelve igual', () => {
    expect(ClockLocationRules.assertValid(valid)).toEqual(valid);
  });

  it('acepta los extremos del mundo y una precision de cero', () => {
    expect(codeOf({ latitude: 90, longitude: 180, accuracyMeters: 0 })).toBeNull();
    expect(
      codeOf({ latitude: -90, longitude: -180, accuracyMeters: MAX_ACCURACY_METERS }),
    ).toBeNull();
  });

  it('una precision baja no se rechaza, solo se guarda', () => {
    expect(codeOf({ ...valid, accuracyMeters: 5000 })).toBeNull();
  });

  it('rechaza coordenadas fuera de rango o que no son numeros', () => {
    expect(codeOf({ ...valid, latitude: 90.0001 })).toBe('INVALID_LOCATION');
    expect(codeOf({ ...valid, latitude: -91 })).toBe('INVALID_LOCATION');
    expect(codeOf({ ...valid, longitude: 181 })).toBe('INVALID_LOCATION');
    expect(codeOf({ ...valid, latitude: Number.NaN })).toBe('INVALID_LOCATION');
    expect(codeOf({ ...valid, longitude: Number.POSITIVE_INFINITY })).toBe('INVALID_LOCATION');
  });

  it('rechaza una precision negativa o absurda', () => {
    expect(codeOf({ ...valid, accuracyMeters: -1 })).toBe('INVALID_LOCATION');
    expect(codeOf({ ...valid, accuracyMeters: MAX_ACCURACY_METERS + 1 })).toBe('INVALID_LOCATION');
  });
});
