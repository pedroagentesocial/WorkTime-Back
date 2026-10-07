import { ConflictError, ValidationError } from '#shared/domain/errors.js';
import { COMPANY_LIMITS } from '#shared/domain/company-rules.js';

export const MULTI_ADMIN_LIMITS = {
  maxCompaniesUpperBound: 1000,
  maxEmployeesPerCompanyUpperBound: COMPANY_LIMITS.maxEmployeesUpperBound,
} as const;

// Reglas del paquete de un admin multiempresa: cuantas empresas puede tener y con cuantos empleados nacen
export const MultiAdminRules = {
  assertMaxCompanies(maxCompanies: number): void {
    if (
      !Number.isInteger(maxCompanies) ||
      maxCompanies < 1 ||
      maxCompanies > MULTI_ADMIN_LIMITS.maxCompaniesUpperBound
    ) {
      throw new ValidationError(
        'INVALID_MAX_COMPANIES',
        `El máximo de empresas debe ser un entero entre 1 y ${MULTI_ADMIN_LIMITS.maxCompaniesUpperBound}`,
      );
    }
  },

  assertMaxEmployeesPerCompany(maxEmployees: number): void {
    if (
      !Number.isInteger(maxEmployees) ||
      maxEmployees < 1 ||
      maxEmployees > MULTI_ADMIN_LIMITS.maxEmployeesPerCompanyUpperBound
    ) {
      throw new ValidationError(
        'INVALID_MAX_EMPLOYEES',
        `El máximo de empleados por empresa debe ser un entero entre 1 y ${MULTI_ADMIN_LIMITS.maxEmployeesPerCompanyUpperBound}`,
      );
    }
  },

  assertCanAddCompany(currentCompanies: number, maxCompanies: number): void {
    if (currentCompanies >= maxCompanies) {
      throw new ConflictError(
        'MAX_COMPANIES_REACHED',
        `Ya tiene ${currentCompanies} de ${maxCompanies} empresas permitidas`,
        { companies: currentCompanies, maxCompanies },
      );
    }
  },

  assertLimitCoversCompanies(maxCompanies: number, currentCompanies: number): void {
    if (maxCompanies < currentCompanies) {
      throw new ConflictError(
        'MAX_COMPANIES_BELOW_ASSIGNED',
        `Tiene ${currentCompanies} empresas asignadas; el máximo no puede ser menor`,
        { companies: currentCompanies },
      );
    }
  },
};
