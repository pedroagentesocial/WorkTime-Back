import { describe, expect, it } from 'vitest';
import { AppError } from '#shared/domain/errors.js';
import { MULTI_ADMIN_LIMITS, MultiAdminRules } from './multi-admin-rules.js';

const codeOf = (action: () => void): string | null => {
  try {
    action();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return null;
};

describe('MultiAdminRules', () => {
  it('el maximo de empresas va de 1 al tope', () => {
    expect(
      codeOf(() => {
        MultiAdminRules.assertMaxCompanies(1);
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        MultiAdminRules.assertMaxCompanies(MULTI_ADMIN_LIMITS.maxCompaniesUpperBound);
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        MultiAdminRules.assertMaxCompanies(0);
      }),
    ).toBe('INVALID_MAX_COMPANIES');
    expect(
      codeOf(() => {
        MultiAdminRules.assertMaxCompanies(2.5);
      }),
    ).toBe('INVALID_MAX_COMPANIES');
    expect(
      codeOf(() => {
        MultiAdminRules.assertMaxCompanies(MULTI_ADMIN_LIMITS.maxCompaniesUpperBound + 1);
      }),
    ).toBe('INVALID_MAX_COMPANIES');
  });

  it('el maximo de empleados por empresa va de 1 al tope', () => {
    expect(
      codeOf(() => {
        MultiAdminRules.assertMaxEmployeesPerCompany(25);
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        MultiAdminRules.assertMaxEmployeesPerCompany(0);
      }),
    ).toBe('INVALID_MAX_EMPLOYEES');
  });

  it('no deja agregar una empresa al llegar al maximo', () => {
    expect(
      codeOf(() => {
        MultiAdminRules.assertCanAddCompany(2, 3);
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        MultiAdminRules.assertCanAddCompany(3, 3);
      }),
    ).toBe('MAX_COMPANIES_REACHED');
  });

  it('el maximo no puede quedar por debajo de las empresas asignadas', () => {
    expect(
      codeOf(() => {
        MultiAdminRules.assertLimitCoversCompanies(3, 3);
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        MultiAdminRules.assertLimitCoversCompanies(2, 3);
      }),
    ).toBe('MAX_COMPANIES_BELOW_ASSIGNED');
  });
});
