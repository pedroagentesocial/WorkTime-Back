import { describe, expect, it } from 'vitest';
import { IDENTIFIER_PATTERNS, Identifiers, type RandomInt } from './identifiers.js';

const sequence =
  (...values: number[]): RandomInt =>
  () =>
    values.shift() ?? 0;
const real: RandomInt = (max) => Math.floor(Math.random() * max);

describe('Identifiers', () => {
  it('el código de empresa tiene la forma XXXX-XXXX', () => {
    expect(Identifiers.companyCode(real)).toMatch(IDENTIFIER_PATTERNS.companyCode);
    expect(Identifiers.companyCode(sequence(0, 1, 2, 3, 4, 5, 6, 7))).toBe('ABCD-EFGH');
  });

  it('nunca usa caracteres que se confunden al dictarlos', () => {
    for (let i = 0; i < 2_000; i += 1) {
      expect(Identifiers.companyCode(real)).not.toMatch(/[ILOU01]/);
      expect(Identifiers.employeePrefix(real)).not.toMatch(/[ILOU]/);
    }
  });

  it('el prefijo de empleados son tres letras', () => {
    expect(Identifiers.employeePrefix(real)).toMatch(IDENTIFIER_PATTERNS.employeePrefix);
    expect(Identifiers.employeePrefix(sequence(0, 1, 2))).toBe('ABC');
  });

  it('el código de empleado es el prefijo más el consecutivo con 4 dígitos como mínimo', () => {
    expect(Identifiers.employeeCode('KCS', 1)).toBe('KCS-0001');
    expect(Identifiers.employeeCode('KCS', 42)).toBe('KCS-0042');
    expect(Identifiers.employeeCode('KCS', 9999)).toBe('KCS-9999');
    expect(Identifiers.employeeCode('KCS', 10000)).toBe('KCS-10000');
    expect(Identifiers.employeeCode('KCS', 1)).toMatch(IDENTIFIER_PATTERNS.employeeCode);
  });

  it('los códigos aleatorios casi nunca se repiten', () => {
    const codes = new Set(Array.from({ length: 5_000 }, () => Identifiers.companyCode(real)));
    expect(codes.size).toBeGreaterThan(4_990);
  });
});
