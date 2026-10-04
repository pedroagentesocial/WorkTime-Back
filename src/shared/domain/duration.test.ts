import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.js';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['7d', 604_800_000],
  ])('convierte %s a %d ms', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '15', 'm', '15x', '-5m', '1.5h', '15 m'])('rechaza "%s"', (input) => {
    expect(() => parseDuration(input)).toThrow('Duración inválida');
  });
});
