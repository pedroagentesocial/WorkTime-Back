import { describe, expect, it } from 'vitest';
import { EmployeeRules } from './employee-rules.js';

describe('EmployeeRules', () => {
  it('permite agregar mientras haya lugar y bloquea al llegar al límite', () => {
    expect(() => {
      EmployeeRules.assertCanAddActiveEmployee(4, 5);
    }).not.toThrow();
    expect(() => {
      EmployeeRules.assertCanAddActiveEmployee(5, 5);
    }).toThrow(
      expect.objectContaining({
        code: 'EMPLOYEE_LIMIT_REACHED',
        details: { maxEmployees: 5, activeEmployees: 5 },
      }),
    );
    // Una empresa excedida por bajar de plan tampoco da de alta ni reactiva
    expect(() => {
      EmployeeRules.assertCanAddActiveEmployee(7, 5);
    }).toThrow(expect.objectContaining({ code: 'EMPLOYEE_LIMIT_REACHED' }));
  });

  it('normaliza el teléfono: se recorta y vacío equivale a no tener', () => {
    expect(EmployeeRules.normalizePhone('  +52 (33) 1234-5678 ')).toBe('+52 (33) 1234-5678');
    expect(EmployeeRules.normalizePhone('   ')).toBeNull();
    expect(EmployeeRules.normalizePhone(null)).toBeNull();
    expect(EmployeeRules.normalizePhone(undefined)).toBeNull();
  });

  it.each(['llamar luego', '12345', '+++---...', '801-555-0199; DROP', 'x'.repeat(31)])(
    'rechaza el teléfono "%s"',
    (phone) => {
      expect(() => EmployeeRules.normalizePhone(phone)).toThrow(
        expect.objectContaining({ code: 'INVALID_PHONE' }),
      );
    },
  );

  it('la zona es opcional (null = hereda) pero, si viene, debe ser IANA válida', () => {
    expect(() => {
      EmployeeRules.assertTimezone(null);
    }).not.toThrow();
    expect(() => {
      EmployeeRules.assertTimezone('America/Mazatlan');
    }).not.toThrow();
    expect(() => {
      EmployeeRules.assertTimezone('Sinaloa');
    }).toThrow(expect.objectContaining({ code: 'INVALID_TIMEZONE' }));
  });
});
