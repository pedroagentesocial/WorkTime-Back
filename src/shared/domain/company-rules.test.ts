import { describe, expect, it } from 'vitest';
import { CompanyRules } from './company-rules.js';

describe('CompanyRules', () => {
  it('normaliza el nombre (espacios) y valida su longitud', () => {
    expect(CompanyRules.normalizeName('  Taller   Pérez  ')).toBe('Taller Pérez');
    expect(() => CompanyRules.normalizeName(' A ')).toThrow(
      expect.objectContaining({ code: 'INVALID_COMPANY_NAME' }),
    );
    expect(() => CompanyRules.normalizeName('x'.repeat(151))).toThrow(
      expect.objectContaining({ code: 'INVALID_COMPANY_NAME' }),
    );
  });

  it.each(['America/Mexico_City', 'Europe/Madrid', 'UTC', 'America/Argentina/Buenos_Aires'])(
    'acepta la zona horaria %s',
    (tz) => {
      expect(() => {
        CompanyRules.assertTimezone(tz);
      }).not.toThrow();
    },
  );

  it.each(['Mexico', 'America/Ciudad_Inventada', '', 'UTC; DROP TABLE'])(
    'rechaza la zona horaria "%s"',
    (tz) => {
      expect(() => {
        CompanyRules.assertTimezone(tz);
      }).toThrow(expect.objectContaining({ code: 'INVALID_TIMEZONE' }));
    },
  );

  it('valida el rango del límite de empleados', () => {
    expect(() => {
      CompanyRules.assertMaxEmployees(0);
    }).toThrow(expect.objectContaining({ code: 'INVALID_MAX_EMPLOYEES' }));
    expect(() => {
      CompanyRules.assertMaxEmployees(2.5);
    }).toThrow(expect.objectContaining({ code: 'INVALID_MAX_EMPLOYEES' }));
    expect(() => {
      CompanyRules.assertMaxEmployees(50);
    }).not.toThrow();
  });
});
