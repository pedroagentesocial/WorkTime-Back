import { ConflictError, ValidationError } from '#shared/domain/errors.js';
import { isValidTimezone } from '#shared/domain/timezone.js';

export type CompanyStatus = 'active' | 'suspended';

export const COMPANY_DEFAULTS = {
  timezone: 'America/Denver',
} as const;

export const COMPANY_LIMITS = {
  nameMinLength: 2,
  nameMaxLength: 150,
  maxEmployeesUpperBound: 100_000,
} as const;

export const CompanyRules = {
  normalizeName(name: string): string {
    const normalized = name.trim().replace(/\s+/g, ' ');
    if (
      normalized.length < COMPANY_LIMITS.nameMinLength ||
      normalized.length > COMPANY_LIMITS.nameMaxLength
    ) {
      throw new ValidationError(
        'INVALID_COMPANY_NAME',
        `El nombre debe tener entre ${COMPANY_LIMITS.nameMinLength} y ${COMPANY_LIMITS.nameMaxLength} caracteres`,
      );
    }
    return normalized;
  },

  assertTimezone(timezone: string): void {
    if (!isValidTimezone(timezone)) {
      throw new ValidationError(
        'INVALID_TIMEZONE',
        `"${timezone}" no es una zona horaria válida (usa el formato IANA, p. ej. America/Denver)`,
      );
    }
  },

  assertMaxEmployees(maxEmployees: number): void {
    if (
      !Number.isInteger(maxEmployees) ||
      maxEmployees < 1 ||
      maxEmployees > COMPANY_LIMITS.maxEmployeesUpperBound
    ) {
      throw new ValidationError(
        'INVALID_MAX_EMPLOYEES',
        `El límite de empleados debe ser un entero entre 1 y ${COMPANY_LIMITS.maxEmployeesUpperBound}`,
      );
    }
  },

  assertLimitCoversActiveEmployees(maxEmployees: number, activeEmployees: number): void {
    if (maxEmployees < activeEmployees) {
      throw new ConflictError(
        'MAX_EMPLOYEES_BELOW_ACTIVE',
        `La empresa tiene ${activeEmployees} empleados activos; el límite no puede ser menor`,
        { activeEmployees },
      );
    }
  },
};
